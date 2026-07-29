import { describe, expect, it } from 'vitest';
import {
  AI_FEATURES,
  buildPrompt,
  decideAiRun,
  describeAiRun,
  isAiFeature,
  type AiConsent,
  type AiSubject,
} from '@/lib/ai';

/**
 * The AI gate.
 *
 * These tests exist because of one sentence in the brief: a locked item must
 * never reach an AI path. That is asserted here from several directions — a
 * locked item with consent, a locked item without, a locked item whose feature
 * would not have applied anyway — and the order of the checks is asserted too,
 * because "you consented, so we read it" is the sentence this design exists to
 * make unsayable.
 */

const SPACE = '00000000-0000-4000-8000-000000000004';
const OTHER_SPACE = '00000000-0000-4000-8000-000000000005';

function subject(over: Partial<AiSubject> = {}): AiSubject {
  return {
    kind: 'note',
    id: 'n1',
    spaceId: SPACE,
    isLocked: false,
    title: 'Boiler service',
    body: 'The boiler is 12 years old and the service is due in October.',
    ...over,
  };
}

function consent(over: Partial<AiConsent> = {}): AiConsent {
  return {
    feature: 'note_summary',
    spaceId: SPACE,
    isEnabled: true,
    consentedAt: '2026-07-01T09:00:00Z',
    ...over,
  };
}

describe('the locked refusal', () => {
  it('refuses a locked item even with consent switched on', () => {
    const d = decideAiRun('note_summary', subject({ isLocked: true }), consent());
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.refusal).toBe('locked');
  });

  it('refuses a locked item before it looks at consent at all', () => {
    // With no consent row, an unlocked item is refused for `no_consent`. A
    // locked one must still be refused for `locked` — the order matters,
    // because the reason shown to somebody is the thing they will act on.
    const d = decideAiRun('note_summary', subject({ isLocked: true }), null);
    expect(d.allowed === false && d.refusal).toBe('locked');
  });

  it('refuses a locked item in another space for being locked, not for the space', () => {
    const d = decideAiRun(
      'note_summary',
      subject({ isLocked: true, spaceId: OTHER_SPACE }),
      consent(),
    );
    expect(d.allowed === false && d.refusal).toBe('locked');
  });

  it('says why in a sentence somebody can act on', () => {
    const d = decideAiRun('note_summary', subject({ isLocked: true }), consent());
    expect(d.allowed === false && d.reason).toContain('never reach an AI feature');
  });

  it('builds no prompt for a locked item', () => {
    const d = decideAiRun('note_summary', subject({ isLocked: true }), consent());
    expect('prompt' in d).toBe(false);
  });
});

describe('consent', () => {
  it('refuses with no consent row', () => {
    expect(decideAiRun('note_summary', subject(), null)).toMatchObject({
      allowed: false,
      refusal: 'no_consent',
    });
  });

  it('refuses when the row is for another feature', () => {
    const d = decideAiRun('note_summary', subject(), consent({ feature: 'task_breakdown' }));
    expect(d.allowed === false && d.refusal).toBe('no_consent');
  });

  it('refuses when the feature is switched off', () => {
    const d = decideAiRun('note_summary', subject(), consent({ isEnabled: false }));
    expect(d.allowed === false && d.refusal).toBe('not_enabled');
  });

  it('refuses an enabled row that was never actually consented to', () => {
    // The table constrains this away, but the constraint is one layer down and
    // this is the layer that decides.
    const d = decideAiRun('note_summary', subject(), consent({ consentedAt: null }));
    expect(d.allowed === false && d.refusal).toBe('not_enabled');
  });

  it('refuses consent given for a different space', () => {
    const d = decideAiRun('note_summary', subject(), consent({ spaceId: OTHER_SPACE }));
    expect(d.allowed === false && d.refusal).toBe('cross_space');
  });

  it('allows a consented feature on its own space', () => {
    expect(decideAiRun('note_summary', subject(), consent()).allowed).toBe(true);
  });

  it('refuses an item with nothing in it', () => {
    const d = decideAiRun('note_summary', subject({ title: '', body: '' }), consent());
    expect(d.allowed === false && d.refusal).toBe('nothing_to_send');
  });
});

describe('what would be sent', () => {
  it('is returned rather than sent, so it can be shown first', () => {
    const d = decideAiRun('note_summary', subject(), consent());
    expect(d.allowed === true && d.prompt).toContain('Boiler service');
    expect(d.allowed === true && d.prompt).toContain('12 years old');
  });

  it('a task breakdown sends the title and the body', () => {
    const p = buildPrompt('task_breakdown', subject({ kind: 'task', title: 'Rewire the shed', body: 'Ask Danny' }));
    expect(p).toContain('Rewire the shed');
    expect(p).toContain('Ask Danny');
  });

  it('a task breakdown with no body does not send an empty Notes line', () => {
    const p = buildPrompt('task_breakdown', subject({ kind: 'task', body: '' }));
    expect(p).not.toContain('Notes:');
  });

  it('a weekly review sends no bodies — the disclosure says so', () => {
    const p = buildPrompt(
      'weekly_review',
      subject({ kind: 'week', title: 'Mon 03/08: Dentist 09:00', body: 'a private note body' }),
    );
    expect(p).toContain('Dentist');
    expect(p).not.toContain('private note body');
  });

  it('is stable — building it twice gives the same string', () => {
    expect(buildPrompt('note_summary', subject())).toBe(buildPrompt('note_summary', subject()));
  });
});

describe('describeAiRun', () => {
  it('names the provider that answered', () => {
    expect(
      describeAiRun({ feature: 'note_summary', status: 'ok', provider: 'ai:fake', error: null }),
    ).toBe('Summarise a note — answered by ai:fake');
  });

  it('says nothing was sent on a refusal', () => {
    const line = describeAiRun({
      feature: 'note_summary',
      status: 'refused',
      provider: 'ai:fake',
      error: 'that item is locked',
    });
    expect(line).toContain('nothing sent');
    expect(line).toContain('that item is locked');
  });

  it('names the provider on a failure', () => {
    expect(
      describeAiRun({ feature: 'task_breakdown', status: 'error', provider: 'ai:anthropic', error: 'timed out' }),
    ).toContain('failed via ai:anthropic');
  });

  it('falls back to the raw feature name for one it does not know', () => {
    expect(
      describeAiRun({ feature: 'something_new', status: 'ok', provider: 'ai:fake', error: null }),
    ).toContain('something_new');
  });
});

describe('isAiFeature', () => {
  it('accepts the three seeded features', () => {
    for (const f of AI_FEATURES) expect(isAiFeature(f)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAiFeature('note_summaries')).toBe(false);
    expect(isAiFeature('')).toBe(false);
    expect(isAiFeature(null)).toBe(false);
  });
});
