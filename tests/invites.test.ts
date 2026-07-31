import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  INVITE_ROLES,
  INVITE_STATUSES,
  NON_OFFERABLE_ROLES,
  ROLE_LABEL,
  ROLE_MEANING,
  expiresAtFrom,
  expiresInWords,
  expiryDaysFrom,
  hashInviteToken,
  invitePath,
  inviteSentence,
  isInviteRole,
  isInviteStatus,
  isOpen,
  newInviteToken,
} from '@/lib/invites';

/**
 * Space invites — the half that is not a policy.
 *
 * What a policy decides is asserted in pgTAP and nowhere else: who may create
 * an invite, who may redeem one, and what a redeemed one grants. What lives
 * here is the token itself, the vocabulary the form offers, and the sentence
 * every outcome turns into — because "never a 500, always a sentence" is only
 * true if every status has one.
 */

describe('the token', () => {
  it('is 256 bits from the OS, URL-safe, and never the same twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  it('survives being a path segment unchanged, which is what makes the link work', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newInviteToken();
      expect(invitePath(token)).toBe(`/invite/${token}`);
      expect(decodeURIComponent(invitePath(token).slice('/invite/'.length))).toBe(token);
    }
  });

  it('hashes to hex sha256 — the only form that is ever stored', () => {
    expect(hashInviteToken('open-token')).toBe(
      createHash('sha256').update('open-token').digest('hex'),
    );
    expect(hashInviteToken('open-token')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken('open-token')).not.toBe(hashInviteToken('open-token '));
  });

  it('hashes the same way migration 0012 does, or no link would ever be recognised', () => {
    // The SQL is `encode(digest(token, 'sha256'), 'hex')`. If the two ever
    // disagree, every invitation created by the app is "unknown" when opened —
    // which is a bug that looks like a policy problem and is not one.
    const sql = readFileSync(
      fileURLToPath(new URL('../supabase/migrations/0012_auth_user_profiles.sql', import.meta.url)),
      'utf8',
    );
    expect(sql).toContain("encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')");
  });
});

describe('the roles an invitation may offer', () => {
  it('offers free_busy, which already works end to end', () => {
    expect(INVITE_ROLES).toContain('free_busy');
  });

  it('does not offer owner, and says so as a value rather than by omission', () => {
    expect(INVITE_ROLES as readonly string[]).not.toContain('owner');
    expect(NON_OFFERABLE_ROLES).toContain('owner');
  });

  it('gives every offerable role a label and an explanation the invitee can read', () => {
    for (const role of INVITE_ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_MEANING[role].length).toBeGreaterThan(20);
    }
  });

  it('says plainly that free/busy sees no content at all', () => {
    expect(ROLE_MEANING.free_busy).toMatch(/no titles/i);
    expect(ROLE_MEANING.free_busy).toMatch(/tasks, notes, people or places/i);
  });

  it('recognises exactly the roles it offers', () => {
    expect(isInviteRole('member')).toBe(true);
    expect(isInviteRole('free_busy')).toBe(true);
    expect(isInviteRole('owner')).toBe(false);
    expect(isInviteRole('')).toBe(false);
    expect(isInviteRole('admin ')).toBe(false);
  });

  it('names every role app.member_role has, one way or the other', () => {
    // The enum is owner, admin, member, viewer, free_busy. Anything missing
    // from both lists is a role nobody decided about.
    const known = [...INVITE_ROLES, ...NON_OFFERABLE_ROLES].sort();
    expect(known).toEqual(['admin', 'free_busy', 'member', 'owner', 'viewer']);
  });
});

describe('how long an invitation lasts', () => {
  it('defaults to a fortnight, which is one of the offered choices', () => {
    expect(EXPIRY_CHOICES).toContain(DEFAULT_EXPIRY_DAYS);
  });

  it('accepts a whole number of days between 1 and 90', () => {
    expect(expiryDaysFrom('1')).toBe(1);
    expect(expiryDaysFrom('90')).toBe(90);
    for (const d of EXPIRY_CHOICES) expect(expiryDaysFrom(String(d))).toBe(d);
  });

  it('refuses everything else by name rather than reading it as zero', () => {
    for (const bad of ['', '0', '-1', '91', '1.5', 'soon', 'NaN']) {
      expect(expiryDaysFrom(bad)).toEqual({ error: expect.stringMatching(/1 and 90 days/) });
    }
  });

  it('measures from now, in whole days', () => {
    const now = new Date('2026-07-31T09:00:00Z');
    expect(expiresAtFrom(14, now).toISOString()).toBe('2026-08-14T09:00:00.000Z');
    expect(expiresAtFrom(1, now).toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });
});

describe('how long is left, in words', () => {
  const now = new Date('2026-07-31T12:00:00Z');

  it('counts hours up to two days and days after that', () => {
    expect(expiresInWords('2026-07-31T13:30:00Z', now)).toBe('in 1 hour');
    expect(expiresInWords('2026-08-01T12:00:00Z', now)).toBe('in 24 hours');
    expect(expiresInWords('2026-08-14T12:00:00Z', now)).toBe('in 14 days');
  });

  it('says under an hour rather than "in 0 hours"', () => {
    expect(expiresInWords('2026-07-31T12:30:00Z', now)).toBe('in under an hour');
  });

  it('says expired for anything in the past, including exactly now', () => {
    expect(expiresInWords('2026-07-31T12:00:00Z', now)).toBe('expired');
    expect(expiresInWords('2026-07-30T12:00:00Z', now)).toBe('expired');
  });

  it('does not invent a number for a date it cannot read', () => {
    expect(expiresInWords('not a date', now)).toBe('at an unknown time');
  });
});

describe('every outcome has a sentence', () => {
  it('covers every status app.space_invite can return', () => {
    for (const status of INVITE_STATUSES) {
      const sentence = inviteSentence(status, { spaceName: 'Home' });
      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence).toMatch(/[.!]$/);
      // Never a status code, never a stack trace, never "error".
      expect(sentence).not.toMatch(/\b(403|404|500|error)\b/i);
    }
  });

  it('names the space when there is one, and does not say "null" when there is not', () => {
    expect(inviteSentence('ok', { spaceName: 'Home' })).toContain('Home');
    expect(inviteSentence('ok', {})).toContain('that space');
    expect(inviteSentence('already_member', { spaceName: null })).not.toMatch(/null/);
  });

  it('tells the wrong person which address the invitation was for', () => {
    expect(inviteSentence('wrong_person', { invitedEmail: 'danny@orbit.test' })).toContain(
      'danny@orbit.test',
    );
  });

  it('falls back to a sentence with no address rather than one with a blank in it', () => {
    expect(inviteSentence('wrong_person', {})).toBe('This invitation was sent to somebody else.');
  });

  it('says what declining does and does not do, because it writes nothing', () => {
    const declined = inviteSentence('declined');
    expect(declined).toMatch(/nothing was changed/i);
    expect(declined).toMatch(/still|later/i);
  });

  it('tells somebody who is not signed in what to do about it', () => {
    expect(inviteSentence('not_signed_in')).toMatch(/sign in/i);
  });

  it('only calls an invitation open when it is genuinely acceptable', () => {
    expect(isOpen('ok')).toBe(true);
    for (const status of INVITE_STATUSES.filter((s) => s !== 'ok')) {
      expect(isOpen(status)).toBe(false);
    }
  });

  it('refuses to recognise a status that is not one of ours', () => {
    expect(isInviteStatus('ok')).toBe(true);
    expect(isInviteStatus('fine')).toBe(false);
    expect(isInviteStatus('')).toBe(false);
  });
});
