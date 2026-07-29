import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import { aiProvider } from '@/lib/integrations';
import { decideAiRun, isAiFeature, type AiFeature, type AiSubject } from '@/lib/ai';

/**
 * AI — the database side.
 *
 * The decision about whether a run may happen is pure and lives in
 * `src/lib/ai.ts`. This module does the three things it cannot: read the
 * consent row, read the subject, and write the `ai_runs` row.
 *
 * **A row is written for every attempt, including every refusal.** That is the
 * same call Phase 4 made about `notification_deliveries`, for the same reason:
 * it is the only way to tell "nothing was sent" from "something was sent and
 * nobody looked". A refused run records the refusal and never the content.
 *
 * The subject is read through `asUser`, so a note in a space the caller cannot
 * see is not a refusal — it does not exist. `is_locked` is selected but the
 * title and body of a locked row are empty by constraint, so there is nothing
 * to leak even in the row we hold.
 */

export type ConsentRow = {
  id: string;
  feature: string;
  isEnabled: boolean;
  dataLeavesDevice: string;
  consentedAt: string | null;
  revokedAt: string | null;
  spaceId: string;
  space: SpaceRef;
};

/**
 * The caller's own consents.
 *
 * There is no `where owner_id =` here and there does not need to be: the policy
 * on `ai_feature_consents` is `owner_id = auth.uid() and can_read_space(...)`,
 * not the usual space-wide grant. Consent is personal by construction — being
 * in somebody's space does not show you what they agreed to send, let alone let
 * you agree on their behalf. That is a policy decision, and this module is not
 * allowed to soften or duplicate it.
 */
export async function listConsents(userId: string): Promise<ConsentRow[]> {
  return asUser(userId, async (tx) => {
    return tx<ConsentRow[]>`
      select
        c.id, c.feature,
        c.is_enabled          as "isEnabled",
        c.data_leaves_device  as "dataLeavesDevice",
        c.consented_at        as "consentedAt",
        c.revoked_at          as "revokedAt",
        c.space_id            as "spaceId",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.ai_feature_consents c
      join public.spaces s on s.id = c.space_id
      order by s.name, c.feature
    `;
  });
}

/**
 * Switch a feature on or off.
 *
 * `consented_at` is set when it goes on and never cleared — a revocation is a
 * `revoked_at`, not an erasure. "Was this ever consented to, and when" is a
 * question somebody is entitled to be able to answer later, and a column that
 * gets blanked cannot answer it.
 */
export async function setConsent(
  userId: string,
  consentId: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  // `owner_id = ` restates what the update policy already enforces. It is here
  // for the same reason the rules engine names the space again on every write:
  // the statement that consent is personal should be visible where the write
  // happens, not only in a migration.
  const changed = await asUser(userId, async (tx) => {
    const result = await tx`
      update public.ai_feature_consents
      set is_enabled   = ${enabled},
          consented_at = case when ${enabled} then coalesce(consented_at, now()) else consented_at end,
          revoked_at   = case when ${enabled} then null else now() end
      where id = ${consentId}::uuid and owner_id = ${userId}::uuid
    `;
    return result.count;
  });
  if (!changed) {
    return { error: 'That consent is not yours to change. Consent is per person, per feature, per space.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export type SubjectOption = {
  id: string;
  title: string;
  isLocked: boolean;
  spaceId: string;
  space: SpaceRef;
};

/**
 * The notes a run could be pointed at.
 *
 * Locked notes are **listed**, with no title, rather than hidden. A locked item
 * that vanishes from the picker looks like an item that does not exist; one
 * that is listed and refused is the feature working.
 */
export async function listNoteSubjects(userId: string, limit = 40): Promise<SubjectOption[]> {
  return asUser(userId, async (tx) => {
    return tx<SubjectOption[]>`
      select
        n.id,
        case when n.is_locked then '' else n.title end as title,
        n.is_locked as "isLocked",
        n.space_id  as "spaceId",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.notes n
      join public.spaces s on s.id = n.space_id
      where n.archived_at is null
      order by n.is_locked desc, n.updated_at desc
      limit ${limit}
    `;
  });
}

async function readNoteSubject(userId: string, noteId: string): Promise<AiSubject | null> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<
      { id: string; spaceId: string; isLocked: boolean; title: string; body: string }[]
    >`
      select n.id, n.space_id as "spaceId", n.is_locked as "isLocked",
             n.title, n.body_md as body
      from public.notes n
      where n.id = ${noteId}::uuid
    `;
    if (!row) return null;
    return { kind: 'note' as const, ...row };
  });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type AiRunResult = {
  ok: boolean;
  /** The exact text that was sent, or would have been. Empty on a refusal. */
  prompt: string;
  text: string;
  provider: string;
  model: string | null;
  reason: string | null;
};

/**
 * Run one AI feature against one note.
 *
 * Every path through this function writes an `ai_runs` row. The refusal paths
 * write one with `status = 'refused'` and no content, which is what makes
 * "nothing was sent" a fact in the database rather than an absence.
 */
export async function runAiFeature(
  userId: string,
  feature: string,
  noteId: string,
): Promise<AiRunResult> {
  const provider = aiProvider();

  if (!isAiFeature(feature)) {
    return {
      ok: false,
      prompt: '',
      text: '',
      provider: provider.name,
      model: null,
      reason: 'Orbit does not have a feature by that name.',
    };
  }

  const subject = await readNoteSubject(userId, noteId);
  if (!subject) {
    return {
      ok: false,
      prompt: '',
      text: '',
      provider: provider.name,
      model: null,
      reason: 'That note does not exist, or is not yours to read.',
    };
  }

  // Every row `listConsents` can return is already the caller's own — the
  // policy sees to that. What is chosen here is the one for this feature in
  // this space.
  const consents = await listConsents(userId);
  const consent = consents.find(
    (c) => c.feature === feature && c.spaceId === subject.spaceId,
  );

  const decision = decideAiRun(
    feature as AiFeature,
    subject,
    consent
      ? {
          feature: feature as AiFeature,
          spaceId: consent.spaceId,
          isEnabled: consent.isEnabled,
          consentedAt: consent.consentedAt,
        }
      : null,
  );

  if (!decision.allowed) {
    await recordRun(userId, subject.spaceId!, {
      feature,
      provider: provider.name,
      model: null,
      entityId: subject.id,
      status: 'refused',
      error: decision.reason,
      inputTokens: null,
      outputTokens: null,
    });
    return {
      ok: false,
      prompt: '',
      text: '',
      provider: provider.name,
      model: null,
      reason: decision.reason,
    };
  }

  try {
    const answer = await provider.complete({ feature, prompt: decision.prompt });
    await recordRun(userId, subject.spaceId!, {
      feature,
      provider: provider.name,
      model: answer.model,
      entityId: subject.id,
      status: 'ok',
      error: null,
      // Not measured: nothing here counts tokens, and a fabricated number in an
      // audit trail is worse than a null.
      inputTokens: null,
      outputTokens: null,
    });
    return {
      ok: true,
      prompt: decision.prompt,
      text: answer.text,
      provider: provider.name,
      model: answer.model,
      reason: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun(userId, subject.spaceId!, {
      feature,
      provider: provider.name,
      model: null,
      entityId: subject.id,
      status: 'error',
      error: message,
      inputTokens: null,
      outputTokens: null,
    });
    return {
      ok: false,
      prompt: decision.prompt,
      text: '',
      provider: provider.name,
      model: null,
      reason: message,
    };
  }
}

type RunRecord = {
  feature: string;
  provider: string;
  model: string | null;
  entityId: string | null;
  status: 'ok' | 'error' | 'refused';
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

async function recordRun(userId: string, spaceId: string, r: RunRecord): Promise<void> {
  await asUser(userId, async (tx) => {
    await tx`
      insert into public.ai_runs
        (space_id, owner_id, feature, provider, model, entity_kind, entity_id,
         input_tokens, output_tokens, status, error)
      values (${spaceId}::uuid, ${userId}::uuid, ${r.feature}, ${r.provider}, ${r.model},
              'note'::app.entity_kind, ${r.entityId}::uuid,
              ${r.inputTokens}, ${r.outputTokens}, ${r.status}, ${r.error})
    `;
  });
}

export type AiRunRow = {
  id: string;
  feature: string;
  provider: string;
  model: string | null;
  status: string;
  error: string | null;
  ranAt: string;
  space: SpaceRef;
};

export async function listAiRuns(userId: string, limit = 10): Promise<AiRunRow[]> {
  return asUser(userId, async (tx) => {
    return tx<AiRunRow[]>`
      select r.id, r.feature, r.provider, r.model, r.status, r.error,
             r.ran_at as "ranAt",
             jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                                'colour', s.colour, 'icon', s.icon) as space
      from public.ai_runs r
      join public.spaces s on s.id = r.space_id
      order by r.ran_at desc
      limit ${limit}
    `;
  });
}
