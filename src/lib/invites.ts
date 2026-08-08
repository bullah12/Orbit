import { createHash, randomBytes } from 'node:crypto';

/**
 * Space invites — the decisions, none of the I/O.
 *
 * `orbit.space_invites` has existed since session 1 and held no rows: session 5
 * recorded that an invite needs an auth system that can invite a stranger, and
 * a cookie naming a seeded profile is not one. That is now settled, so the table
 * is being filled in rather than changed — every column this needs was already
 * there.
 *
 * The rule that shapes everything here: **the raw token is never stored.** It is
 * generated once, shown once as a link, and from then on only its SHA-256 hash
 * exists — in `token_hash`, and recomputed in `orbit.space_invite()` when somebody
 * presents a link. A database dump therefore contains no working invitation.
 */

/** What an invite may offer. */
export const INVITE_ROLES = ['admin', 'member', 'viewer', 'free_busy'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/**
 * `owner` is in `orbit.member_role` and is deliberately not offerable.
 *
 * A space's owner is the person named in `spaces.owner_id`, which is a
 * different fact from the membership row and is not changed by joining.
 * Transferring a space by emailing somebody a link is a different operation
 * with different consequences, and it is not this one.
 */
export const NON_OFFERABLE_ROLES = ['owner'] as const;

export const ROLE_LABEL: Record<InviteRole, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  free_busy: 'Free/busy only',
};

/** What each role actually means, in the words the invitee needs. */
export const ROLE_MEANING: Record<InviteRole, string> = {
  admin: 'Can read and change everything in the space, and can invite and remove people.',
  member: 'Can read and change everything in the space. Cannot invite or remove people.',
  viewer: 'Can read everything in the space, and change nothing.',
  free_busy:
    'Sees only when the space is busy in the calendar — anonymous blocks with no titles, and no tasks, notes, people or places at all.',
};

export function isInviteRole(value: string): value is InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(value);
}

/** How long an invitation may be good for. */
export const EXPIRY_CHOICES = [1, 7, 14, 30] as const;
export const DEFAULT_EXPIRY_DAYS = 14;

export function expiryDaysFrom(value: string): number | { error: string } {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { error: 'An invitation lasts between 1 and 90 days.' };
  }
  return days;
}

export function expiresAtFrom(days: number, now = new Date()): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * A new invitation token.
 *
 * 32 bytes from the OS, in base64url so the whole thing survives being a path
 * segment, an email, and somebody's clipboard. Not a UUID: a UUID is 122 bits
 * and is meant to be unique rather than unguessable, and this is the only thing
 * standing between a stranger and somebody's household.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The hash that is stored. Must stay identical to the SQL in migration 0012:
 * `encode(sha256(convert_to(token, 'utf8')), 'hex')`.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Where an invitation link points. Relative — the page shows an absolute one. */
export function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Every answer `orbit.space_invite()` can give. */
export const INVITE_STATUSES = [
  'ok',
  'accepted',
  'declined',
  'expired',
  'unknown',
  'already_accepted',
  'accepted_by_you',
  'already_member',
  'wrong_person',
  'not_signed_in',
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export function isInviteStatus(value: string): value is InviteStatus {
  return (INVITE_STATUSES as readonly string[]).includes(value);
}

/** Can this invitation still be accepted by the person looking at it? */
export function isOpen(status: InviteStatus): boolean {
  return status === 'ok';
}

/**
 * A sentence for every outcome.
 *
 * Every one of these is a refusal a person can act on: which space, whose
 * address, what to do next. None of them is a status code, and none of them is
 * a 403 — being refused an invitation is an ordinary thing to happen, not an
 * error page.
 */
export function inviteSentence(
  status: InviteStatus,
  ctx: { spaceName?: string | null; invitedEmail?: string | null; role?: string | null } = {},
): string {
  const space = ctx.spaceName ?? 'that space';
  switch (status) {
    case 'ok':
      return `You have been invited to ${space}.`;
    case 'accepted':
      return `You have joined ${space}.`;
    case 'declined':
      return 'Declined. Nothing was changed — and the link stays live until it expires or whoever sent it revokes it, so you can still accept later.';
    case 'expired':
      return 'That invitation has expired, or it has been revoked. Ask whoever sent it for a new link.';
    case 'unknown':
      return 'That invitation link is not recognised. It may have been copied incompletely, or it may never have existed.';
    case 'already_accepted':
      return 'That invitation has already been used, by somebody else. Ask for a new link.';
    case 'accepted_by_you':
      return `You accepted this invitation already — ${space} is in your sidebar.`;
    case 'already_member':
      return `You are already in ${space}, so there is nothing to accept.`;
    case 'wrong_person':
      return ctx.invitedEmail
        ? `This invitation was sent to ${ctx.invitedEmail}. Sign in as that person to accept it.`
        : 'This invitation was sent to somebody else.';
    case 'not_signed_in':
      return 'Sign in first, then open this link again.';
  }
}

/** How long is left, in the words a person would use. */
export function expiresInWords(expiresAt: Date | string, now = new Date()): string {
  const at = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const ms = at.getTime() - now.getTime();
  if (Number.isNaN(ms)) return 'at an unknown time';
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'in under an hour';
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.floor(hours / 24)} days`;
}
