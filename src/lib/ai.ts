/**
 * AI — the pure half: what is allowed to happen, and what would be sent.
 *
 * AI is off by default and opted into per feature (decision 8). The three
 * things that decide whether a run may happen at all are here, in one function,
 * with no database and no network in sight — the same shape as the rules
 * engine's evaluator, and for the same reason: a refusal that lives in a page
 * is a refusal that the next page forgets.
 *
 * The order of the checks is deliberate and is asserted in the tests. **Locked
 * is refused first**, before consent is even looked at, because a locked item
 * must produce the same answer whether or not somebody has switched the
 * feature on — "you consented, so we read it" is exactly the sentence this
 * whole design exists to make unsayable. There is no code path that decrypts
 * anything to send it, and a locked row has no plaintext on the server to send.
 */

export const AI_FEATURES = ['note_summary', 'task_breakdown', 'weekly_review'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  note_summary: 'Summarise a note',
  task_breakdown: 'Break a task into steps',
  weekly_review: 'Review the week ahead',
};

export function isAiFeature(v: unknown): v is AiFeature {
  return typeof v === 'string' && (AI_FEATURES as readonly string[]).includes(v);
}

/** What a run needs to know about the thing it was asked to act on. */
export type AiSubject = {
  kind: 'note' | 'task' | 'week';
  id: string | null;
  spaceId: string | null;
  isLocked: boolean;
  title: string;
  body: string;
};

/** What a run needs to know about the permission it was given. */
export type AiConsent = {
  feature: AiFeature;
  spaceId: string;
  isEnabled: boolean;
  consentedAt: string | null;
};

export type AiRefusal =
  | 'locked'
  | 'no_consent'
  | 'not_enabled'
  | 'cross_space'
  | 'nothing_to_send';

export const REFUSAL_SENTENCE: Record<AiRefusal, string> = {
  locked:
    'That item is locked. Locked items are end-to-end encrypted, have no plaintext on this server, and never reach an AI feature — switching anything on does not change that.',
  no_consent:
    'That feature has not been consented to in this space. Nothing has been sent.',
  not_enabled:
    'That feature is switched off. Nothing has been sent.',
  cross_space:
    'The consent you gave was for a different space. Consent is per space, so nothing has been sent.',
  nothing_to_send:
    'There is nothing here to send — no title and no body.',
};

export type AiDecision =
  | { allowed: true; prompt: string; feature: AiFeature }
  | { allowed: false; refusal: AiRefusal; reason: string };

/**
 * May this run happen, and if so what would be sent?
 *
 * Returns the prompt rather than sending it, so a caller can show it before
 * anything leaves — the same bargain as a rule's dry run, and the reason the
 * settings screen can say what leaves the device without the sentence being a
 * separate claim from the code.
 */
export function decideAiRun(
  feature: AiFeature,
  subject: AiSubject,
  consent: AiConsent | null,
): AiDecision {
  // Locked first, unconditionally. See the module comment.
  if (subject.isLocked) {
    return { allowed: false, refusal: 'locked', reason: REFUSAL_SENTENCE.locked };
  }
  if (!consent) {
    return { allowed: false, refusal: 'no_consent', reason: REFUSAL_SENTENCE.no_consent };
  }
  if (consent.feature !== feature) {
    return { allowed: false, refusal: 'no_consent', reason: REFUSAL_SENTENCE.no_consent };
  }
  if (subject.spaceId !== null && consent.spaceId !== subject.spaceId) {
    return { allowed: false, refusal: 'cross_space', reason: REFUSAL_SENTENCE.cross_space };
  }
  if (!consent.isEnabled || !consent.consentedAt) {
    return { allowed: false, refusal: 'not_enabled', reason: REFUSAL_SENTENCE.not_enabled };
  }

  // Emptiness is decided on the *subject*, not on the assembled prompt: every
  // prompt carries an instruction, so a prompt is never empty even when there
  // is nothing at all to say. Sending an instruction with a blank note attached
  // is a request that costs money and can only produce an invention.
  if (!subject.title.trim() && !subject.body.trim()) {
    return { allowed: false, refusal: 'nothing_to_send', reason: REFUSAL_SENTENCE.nothing_to_send };
  }
  return { allowed: true, prompt: buildPrompt(feature, subject), feature };
}

/**
 * Exactly what would be sent, for one feature.
 *
 * This is the *only* place a prompt is assembled, so the disclosure a person
 * reads in settings can be checked against one function rather than against a
 * habit. A feature that says "no note bodies" must not have a body in here.
 */
export function buildPrompt(feature: AiFeature, subject: AiSubject): string {
  switch (feature) {
    case 'note_summary':
      return [
        'Summarise this note in two or three sentences.',
        `Title: ${subject.title}`,
        '',
        subject.body,
      ]
        .join('\n')
        .trim();

    case 'task_breakdown':
      return [
        'Break this task into a short list of concrete steps. No preamble.',
        `Task: ${subject.title}`,
        subject.body ? `Notes: ${subject.body}` : '',
      ]
        .filter(Boolean)
        .join('\n')
        .trim();

    case 'weekly_review':
      // Titles and dates only — the disclosure says no note bodies, and this is
      // where that promise is either kept or broken.
      return [
        'Here is a week. Say in three sentences what it looks like, and name anything that looks tight.',
        subject.title,
      ]
        .join('\n')
        .trim();
  }
}

/** One line for the run log: what happened, in words, without the content. */
export function describeAiRun(run: {
  feature: string;
  status: string;
  provider: string;
  error: string | null;
}): string {
  const label = isAiFeature(run.feature) ? AI_FEATURE_LABEL[run.feature] : run.feature;
  if (run.status === 'refused') return `${label} — refused, nothing sent. ${run.error ?? ''}`.trim();
  if (run.status === 'error') return `${label} — failed via ${run.provider}. ${run.error ?? ''}`.trim();
  return `${label} — answered by ${run.provider}`;
}
