'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { asUser } from '@/lib/db';
import { listSelectableUsers, requireUser, usesDevAuth, USER_COOKIE } from '@/lib/auth';
import { addDaysISO, londonDayISO, londonInstant } from '@/lib/format';
import {
  calendarProvider,
  geocodingProvider,
  icsProvider,
  parseIcs,
  travelTimeProvider,
} from '@/lib/integrations';
import {
  departBy,
  estimateLegMinutes,
  haversineMetres,
  LEG_MODES,
  planLeg,
  providerModeFor,
  sessionFromEvent,
  sessionIsActive,
  type LegMode,
} from '@/lib/travel';
import { isTriggerKind, rawActionFrom, type Trigger } from '@/lib/rules';
import { occurrenceAt, parseRrule, rruleFromForm } from '@/lib/recurrence';
import { getEvent } from '@/lib/queries/events';
import {
  addAction,
  fireForTask,
  addCondition,
  createRule,
  deleteRule,
  removeAction,
  removeCondition,
  runRule,
  updateAction,
  updateCondition,
  setRuleEnabled,
  updateRuleParts,
} from '@/lib/queries/rules';
import { createFromCapture } from '@/lib/queries/capture';
import {
  advanceCursor,
  flushQueue,
  isSyncableField,
  readCurrent,
  resetCursors,
  resolveConflictWrite,
  setDeviceRevoked,
  setDeviceRevokedByLabel,
  SYNC_ENTITY_KINDS,
} from '@/lib/queries/sync';
import { isThemeChoice, parseWeekStart, resolveDefaultSpace } from '@/lib/prefs';
import { writeDefaultSpace, writeTheme, writeWeekStart } from '@/lib/prefs/cookies';
import {
  isSyncEntityKind,
  type Conflict,
  type ConflictChoice,
  type PendingWrite,
} from '@/lib/sync/conflict';
import { normaliseDeviceLabel, type FlushOutcome } from '@/lib/sync/outbox';
import { setThisDeviceLabel } from '@/lib/sync/device';
import { listSpaces } from '@/lib/queries/spaces';
import {
  acceptInvite,
  createInvite,
  declineInvite,
  removeMember,
  revokeInvite,
} from '@/lib/queries/invites';
import { expiryDaysFrom, expiresAtFrom, isInviteRole, newInviteToken } from '@/lib/invites';
import { runAiFeature, setConsent } from '@/lib/queries/ai';
import {
  connectProviderCalendar,
  pullCalendar,
  pushCalendar,
  upsertExternalEvent,
} from '@/lib/sync/calendar';

/**
 * Server actions.
 *
 * Every one of these runs through asUser(), so a forged id in a form field
 * fails on a policy rather than on a check written here. The `where` clauses
 * below are for correctness, not for security — if one were deleted, the
 * database would still refuse.
 */

/**
 * The dev user switcher.
 *
 * Impersonation is the whole point of it, so this is not a security control —
 * but it now refuses an id that is not a seeded profile, so a typo lands you
 * back on your own account rather than in the silent fallback. This build still
 * must not be exposed to a network you do not control.
 */
export async function switchUser(formData: FormData) {
  // Impersonation, and only ever under the dev provider. The sidebar stops
  // rendering the switcher the moment AUTH_PROVIDER is not `dev`, but a hidden
  // control is not a boundary — this is. The action returns without writing
  // anything rather than throwing: a POST to a route that no longer means
  // anything is not an error worth a stack trace.
  if (!usesDevAuth()) return;

  const id = String(formData.get('userId') ?? '');
  const known = await listSelectableUsers();
  if (!known.some((u) => u.id === id)) return;

  const jar = await cookies();
  jar.set(USER_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

export async function toggleTaskDone(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('taskId') ?? '');
  const done = String(formData.get('done') ?? '') === 'true';

  await asUser(user.id, async (tx) => {
    if (done) {
      await tx`
        update orbit.tasks
        set status = 'done', completed_at = now()
        where id = ${id}::uuid and status <> 'done'
      `;
    } else {
      await tx`
        update orbit.tasks
        set status = 'todo', completed_at = null
        where id = ${id}::uuid
      `;
    }
  });

  await fireForTask(user.id, done ? 'task.completed' : 'task.updated', id);

  revalidatePath('/', 'layout');
}

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const spaceId = String(formData.get('spaceId') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  const dueOn = String(formData.get('dueOn') ?? '') || null;

  if (!title || !spaceId) return;

  const created = await asUser(user.id, async (tx) => {
    // The category is resolved against the chosen space rather than trusted:
    // a stale form could otherwise carry a category from a space the task is
    // not going into.
    const [row] = await tx<{ id: string }[]>`
      insert into orbit.tasks (space_id, owner_id, category_id, title, due_on, assignee_id)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = ${spaceId}::uuid),
        ${title}, ${dueOn}::date, ${user.id}::uuid)
      returning id
    `;
    return row;
  });

  // Rules fire after the write, never inside it: a malformed rule somebody
  // wrote last month must not be able to lose the task they just typed.
  if (created) await fireForTask(user.id, 'task.created', created.id);

  revalidatePath('/', 'layout');
}

/**
 * Edit a task.
 *
 * Two references are resolved in SQL against the task's own space rather than
 * trusted from the form: a category from another space, or an assignee who is
 * not a member, resolves to NULL instead of being written. That is a
 * correctness rule, not a security one — the policies already stop a write to
 * a task you cannot reach — but it keeps a stale form from producing a row
 * that references across a space boundary.
 */
export async function updateTask(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('taskId') ?? '');
  if (!id) return;

  const title = String(formData.get('title') ?? '').trim();
  const bodyMd = String(formData.get('bodyMd') ?? '');
  const status = String(formData.get('status') ?? 'todo');
  const priority = String(formData.get('priority') ?? 'none');
  const dueOn = String(formData.get('dueOn') ?? '') || null;
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  const assigneeId = String(formData.get('assigneeId') ?? '') || null;
  const waitingOn = String(formData.get('waitingOn') ?? '').trim() || null;
  const estimateRaw = String(formData.get('estimateMinutes') ?? '').trim();
  const estimate = estimateRaw === '' ? null : Number(estimateRaw);
  const deferredUntil = String(formData.get('deferredUntil') ?? '') || null;

  if (!title) return;
  if (estimate != null && (!Number.isFinite(estimate) || estimate <= 0)) return;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.tasks t set
        title      = ${title},
        body_md    = ${bodyMd},
        status     = ${status}::app.task_status,
        priority   = ${priority}::app.priority,
        due_on     = ${dueOn}::date,
        waiting_on = ${waitingOn},
        estimate_minutes = ${estimate}::int,
        deferred_until   = ${deferredUntil}::timestamptz,
        -- 'done' carries a completion time by check constraint; keep the
        -- original one if the task was already done.
        completed_at = case
          when ${status} = 'done' then coalesce(t.completed_at, now())
          else null
        end,
        category_id = (
          select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = t.space_id
        ),
        assignee_id = (
          select m.user_id from orbit.space_members m
          where m.user_id = ${assigneeId}::uuid
            and m.space_id = t.space_id
            and m.status = 'active'
            and m.role in ('owner','admin','member')
        ),
        updated_at = now()
      where t.id = ${id}::uuid and not t.is_locked
    `;
  });

  await fireForTask(user.id, status === 'done' ? 'task.completed' : 'task.updated', id);

  revalidatePath('/', 'layout');
}

export async function deleteTask(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('taskId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.tasks where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/tasks/all');
}

export async function createNote(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const bodyMd = String(formData.get('bodyMd') ?? '');
  const spaceId = String(formData.get('spaceId') ?? '');

  if (!title || !spaceId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.notes (space_id, owner_id, title, body_md)
      values (${spaceId}::uuid, ${user.id}::uuid, ${title}, ${bodyMd})
    `;
  });

  revalidatePath('/', 'layout');
}

export async function updateNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const bodyMd = String(formData.get('bodyMd') ?? '');

  await asUser(user.id, async (tx) => {
    // Snapshot the previous body first — it is the only recovery path a user
    // has, and it costs one insert. `not n.is_locked` has to be on *this*
    // statement too, not only on the update below: without it, editing a
    // locked note writes a version row for a note whose contents the server has
    // never seen.
    await tx`
      insert into orbit.note_versions (space_id, owner_id, note_id, version, title, body_md)
      select n.space_id, ${user.id}::uuid, n.id,
             coalesce((select max(version) from orbit.note_versions v where v.note_id = n.id), 0) + 1,
             n.title, n.body_md
      from orbit.notes n
      where n.id = ${id}::uuid and not n.is_locked
    `;
    await tx`
      update orbit.notes set title = ${title}, body_md = ${bodyMd}, updated_at = now()
      where id = ${id}::uuid and not is_locked
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Archive, not delete, is the default. Archiving is reversible and a note is
 * often the only record of something; `deleteNote` exists for the case where
 * the user genuinely means it, and is only offered from the archive.
 */
export async function archiveNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update orbit.notes set archived_at = now() where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/notes');
}

export async function restoreNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update orbit.notes set archived_at = null where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

export async function deleteNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.notes where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/notes?archived=1');
}

/**
 * Link a note to something.
 *
 * `space_id` and `owner_id` come from the note, and the target is checked to be
 * in the same space in SQL — a link across a space boundary would be an item
 * visible from a space its policies do not govern.
 */
export async function addNoteLink(formData: FormData) {
  const user = await requireUser();
  const noteId = String(formData.get('noteId') ?? '');
  const target = String(formData.get('target') ?? ''); // "kind:uuid"
  const [kind, entityId] = target.split(':');
  if (!noteId || !kind || !entityId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.note_links (space_id, owner_id, note_id, entity_kind, entity_id)
      select n.space_id, ${user.id}::uuid, n.id, ${kind}::app.entity_kind, ${entityId}::uuid
      from orbit.notes n
      where n.id = ${noteId}::uuid
        and exists (
          select 1 from app.entity_space(${kind}::app.entity_kind, ${entityId}::uuid) es
          where es.space_id = n.space_id
        )
      on conflict do nothing
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removeNoteLink(formData: FormData) {
  const user = await requireUser();
  const noteId = String(formData.get('noteId') ?? '');
  const kind = String(formData.get('entityKind') ?? '');
  const entityId = String(formData.get('entityId') ?? '');
  if (!noteId || !kind || !entityId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      delete from orbit.note_links
      where note_id = ${noteId}::uuid
        and entity_kind = ${kind}::app.entity_kind
        and entity_id = ${entityId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Move an item to another space.
 *
 * The confirmation screen has already shown app.space_move_preview(); this is
 * the write that follows it. It re-runs the preview server-side so the move
 * cannot be submitted against a stale picture of who is in each space.
 */
export async function moveTaskToSpace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('taskId') ?? '');
  const targetSpaceId = String(formData.get('targetSpaceId') ?? '');
  if (!id || !targetSpaceId) return;

  await asUser(user.id, async (tx) => {
    // Throws if the caller cannot read the source or write the target.
    await tx`
      select 1 from app.space_move_preview('task'::app.entity_kind,
        ${id}::uuid, ${targetSpaceId}::uuid) limit 1
    `;
    // The category belongs to the old space, so it cannot come along.
    await tx`
      update orbit.tasks
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    await tx`
      insert into orbit.activity_log (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
      values (${targetSpaceId}::uuid, ${user.id}::uuid, ${user.id}::uuid, 'task', ${id}::uuid,
              'moved', 'Moved between spaces')
    `;
  });

  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// People
//
// Same-person linking is decision 4: two records, linked permanently, never
// collapsed and never auto-merged. Nothing below writes to both records; the
// link is its own row and unlinking leaves both people exactly as they were.
// ---------------------------------------------------------------------------

export async function createPerson(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  if (!spaceId || !displayName) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.people (space_id, owner_id, category_id, display_name)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = ${spaceId}::uuid),
        ${displayName})
    `;
  });

  revalidatePath('/', 'layout');
}

export async function updatePerson(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('personId') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  if (!id || !displayName) return;

  const nickname = String(formData.get('nickname') ?? '').trim() || null;
  const pronouns = String(formData.get('pronouns') ?? '').trim() || null;
  const notesMd = String(formData.get('notesMd') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '') || null;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.people p set
        display_name = ${displayName},
        nickname     = ${nickname},
        pronouns     = ${pronouns},
        notes_md     = ${notesMd},
        category_id  = (
          select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = p.space_id
        ),
        updated_at   = now()
      where p.id = ${id}::uuid and not p.is_locked
    `;
  });

  revalidatePath('/', 'layout');
}

export async function archivePerson(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('personId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update orbit.people set archived_at = now() where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/people');
}

export async function addPersonContact(formData: FormData) {
  const user = await requireUser();
  const personId = String(formData.get('personId') ?? '');
  const kind = String(formData.get('kind') ?? 'other');
  const label = String(formData.get('label') ?? '').trim() || kind;
  const value = String(formData.get('value') ?? '').trim();
  if (!personId || !value) return;

  await asUser(user.id, async (tx) => {
    // space_id and owner_id come from the person, never from the form.
    await tx`
      insert into orbit.person_contacts (space_id, owner_id, person_id, kind, label, value)
      select p.space_id, ${user.id}::uuid, p.id, ${kind}, ${label}, ${value}
      from orbit.people p where p.id = ${personId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePersonContact(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('contactId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.person_contacts where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

export async function addPersonDate(formData: FormData) {
  const user = await requireUser();
  const personId = String(formData.get('personId') ?? '');
  const kind = String(formData.get('kind') ?? 'birthday');
  const label = String(formData.get('label') ?? '').trim() || null;
  const onDate = String(formData.get('onDate') ?? '');
  const yearKnown = String(formData.get('yearKnown') ?? '') === 'on';
  if (!personId || !onDate) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.person_dates
        (space_id, owner_id, person_id, kind, label, on_date, year_known)
      select p.space_id, ${user.id}::uuid, p.id, ${kind}, ${label},
             ${onDate}::date, ${yearKnown}
      from orbit.people p where p.id = ${personId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePersonDate(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('dateId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.person_dates where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

/**
 * Link two records that are the same person.
 *
 * The row is stored once, in canonical id order — the table's check constraint
 * requires `person_a_id < person_b_id`, so which record you started from must
 * not change what gets written. Both spaces are read off the people rows rather
 * than the form, and the policy independently requires write access to both:
 * you cannot link somebody into a space you are only a visitor in.
 */
export async function linkPeople(formData: FormData) {
  const user = await requireUser();
  const personId = String(formData.get('personId') ?? '');
  const otherId = String(formData.get('otherId') ?? '');
  if (!personId || !otherId || personId === otherId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.person_links
        (space_id, owner_id, person_a_id, person_b_id, person_b_space)
      select
        case when a.id < b.id then a.space_id else b.space_id end,
        ${user.id}::uuid,
        least(a.id, b.id),
        greatest(a.id, b.id),
        case when a.id < b.id then b.space_id else a.space_id end
      from orbit.people a, orbit.people b
      where a.id = ${personId}::uuid and b.id = ${otherId}::uuid and a.id <> b.id
      on conflict do nothing
    `;
  });

  revalidatePath('/', 'layout');
}

export async function unlinkPeople(formData: FormData) {
  const user = await requireUser();
  const linkId = String(formData.get('linkId') ?? '');
  if (!linkId) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.person_links where id = ${linkId}::uuid`;
  });

  revalidatePath('/', 'layout');
}

/**
 * Move a person to another space.
 *
 * Same shape as moveTaskToSpace: the preview has already been shown, and it is
 * re-run server-side here so the move cannot be submitted against a stale
 * picture of who is in each space.
 */
export async function movePersonToSpace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('personId') ?? '');
  const targetSpaceId = String(formData.get('targetSpaceId') ?? '');
  if (!id || !targetSpaceId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      select 1 from app.space_move_preview('person'::app.entity_kind,
        ${id}::uuid, ${targetSpaceId}::uuid) limit 1
    `;
    // Categories, contacts and dates all belong to a space. The category cannot
    // follow; the contacts and dates are the person's own and move with them.
    await tx`
      update orbit.people
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    for (const table of ['person_contacts', 'person_dates']) {
      await tx.unsafe(
        `update orbit.${table} set space_id = $1 where person_id = $2`,
        [targetSpaceId, id],
      );
    }
    await tx`
      insert into orbit.activity_log
        (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
      values (${targetSpaceId}::uuid, ${user.id}::uuid, ${user.id}::uuid, 'person',
              ${id}::uuid, 'moved', 'Moved between spaces')
    `;
  });

  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// Calendar
//
// Times arrive from the form as a wall clock — a date and an HH:MM — and are
// turned into instants here, in London, by londonInstant(). The browser's
// timezone is never consulted: a user in another timezone editing a UK
// household calendar means 09:00 UK, not 09:00 wherever they are sitting.
// ---------------------------------------------------------------------------

/** A date and an optional time from a form, as a UTC instant. Refuses junk rather than guessing. */
function instantFromForm(onDate: string, time: string | null): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;
  if (time !== null && !/^\d{2}:\d{2}$/.test(time)) return null;
  return londonInstant(onDate, time ?? '00:00');
}

export async function createEvent(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const spaceId = String(formData.get('spaceId') ?? '');
  const onDate = String(formData.get('onDate') ?? '');
  const allDay = String(formData.get('allDay') ?? '') === 'true';
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  const calendarId = String(formData.get('calendarId') ?? '') || null;

  const startsAt = instantFromForm(onDate, allDay ? null : String(formData.get('startTime') ?? ''));
  if (!title || !spaceId || !startsAt) return;

  const endsAt = allDay
    ? londonInstant(addDaysISO(onDate, 1), '00:00')
    : (instantFromForm(onDate, String(formData.get('endTime') ?? '')) ?? startsAt);

  // An end before the start would fail the check constraint; treat it as an
  // event running into the next day, which is what the person meant.
  const finalEnd = endsAt < startsAt ? new Date(endsAt.getTime() + 86_400_000) : endsAt;

  // A repeat is one row plus an RRULE, never expanded copies. The rule is
  // built by the same pure module that reads one back, and a malformed one
  // stops the write rather than producing an event that repeats at the wrong
  // time forever.
  const repeatFreq = String(formData.get('repeatFreq') ?? '');
  let recurrenceRule: string | null = null;
  if (repeatFreq) {
    const built = rruleFromForm({
      freq: repeatFreq as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
      interval: Number(formData.get('repeatInterval') ?? 1),
      byDay: formData.getAll('repeatByDay').map(String) as never,
      endOn: String(formData.get('repeatUntil') ?? '') || null,
      startOn: onDate,
    });
    if ('error' in built) {
      redirect(`/calendar/week?error=${encodeURIComponent(built.error)}`);
    }
    recurrenceRule = built.rrule;
  }

  await asUser(user.id, async (tx) => {
    // The rule is written first so the event can point at it. Both carry the
    // space of the event, because a rule is as much content as the event is.
    let ruleId: string | null = null;
    if (recurrenceRule) {
      const [rule] = await tx<{ id: string }[]>`
        insert into orbit.recurrence_rules (space_id, owner_id, rrule, dtstart)
        values (${spaceId}::uuid, ${user.id}::uuid, ${recurrenceRule}, ${startsAt})
        returning id
      `;
      ruleId = rule?.id ?? null;
    }

    await tx`
      insert into orbit.events
        (space_id, owner_id, calendar_id, category_id, title, starts_at, ends_at, all_day,
         recurrence_rule_id)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        -- Both references are resolved against the chosen space rather than
        -- trusted from the form, so a stale picker cannot write across a space
        -- boundary. Falling back to the space's first calendar keeps the
        -- compose bar to one decision.
        coalesce(
          (select c.id from orbit.calendars c
            where c.id = ${calendarId}::uuid and c.space_id = ${spaceId}::uuid),
          (select c.id from orbit.calendars c
            where c.space_id = ${spaceId}::uuid and c.is_writable
            order by c.sort_order, c.name limit 1)
        ),
        (select k.id from orbit.categories k
          where k.id = ${categoryId}::uuid and k.space_id = ${spaceId}::uuid),
        ${title}, ${startsAt}, ${finalEnd}, ${allDay}, ${ruleId}::uuid
      )
    `;
  });

  revalidatePath('/', 'layout');
}

export async function updateEvent(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  if (!id) return;

  const title = String(formData.get('title') ?? '').trim();
  const bodyMd = String(formData.get('bodyMd') ?? '');
  const locationText = String(formData.get('locationText') ?? '').trim() || null;
  const status = String(formData.get('status') ?? 'confirmed');
  const allDay = String(formData.get('allDay') ?? '') === 'true';
  const onDate = String(formData.get('onDate') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '') || null;

  const startsAt = instantFromForm(onDate, allDay ? null : String(formData.get('startTime') ?? ''));
  if (!startsAt) return;
  const endsAt = allDay
    ? londonInstant(addDaysISO(onDate, 1), '00:00')
    : (instantFromForm(onDate, String(formData.get('endTime') ?? '')) ?? startsAt);
  const finalEnd = endsAt < startsAt ? new Date(endsAt.getTime() + 86_400_000) : endsAt;

  await asUser(user.id, async (tx) => {
    // The category is resolved against the event's *own* space, in SQL, so a
    // stale form cannot attach a category from somewhere else.
    await tx`
      update orbit.events e
      set title = ${title},
          body_md = ${bodyMd},
          location_text = ${locationText},
          starts_at = ${startsAt},
          ends_at = ${finalEnd},
          all_day = ${allDay},
          status = ${['confirmed', 'tentative', 'cancelled'].includes(status) ? status : 'confirmed'},
          category_id = (
            select k.id from orbit.categories k
            where k.id = ${categoryId}::uuid and k.space_id = e.space_id
          ),
          -- Locally edited, so a later push knows there is something to send.
          is_dirty = (e.external_id is not null)
      where e.id = ${id}::uuid and not e.is_locked
    `;
  });

  revalidatePath('/', 'layout');
}

function eventRedirect(id: string, error?: string, done?: string): never {
  const q = new URLSearchParams();
  if (error) q.set('error', error);
  if (done) q.set('done', done);
  const suffix = q.toString();
  redirect(suffix ? `/calendar/event/${id}?${suffix}` : `/calendar/event/${id}`);
}

/**
 * Add, change or remove an event's repeat.
 *
 * Rough edge since Phase 6: `rruleFromForm` could build a rule and nothing could
 * read one back, so a repeat could be created at compose time and then never
 * touched — no changing Tuesday to Wednesday, no moving the end date, and no way
 * to stop it repeating short of deleting the event.
 *
 * Still one row plus an RRULE. This writes the rule, changes the rule, or drops
 * it; it never writes expanded copies, and it never touches the event's own start
 * — the series' `DTSTART` is the event, so moving the series means editing the
 * event above, which is a different form and a different sentence.
 *
 * `exdates` survive a change to the rule on purpose. "Not that week" is a
 * statement about a date, not about the shape of the repeat, and somebody who
 * changes an end date has not withdrawn it. A skipped occurrence that the new
 * rule no longer generates is simply an exclusion that matches nothing, which is
 * what RFC 5545 says an EXDATE outside the series is.
 */
export async function setEventRepeat(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  if (!id) return;

  const event = await getEvent(user.id, id);
  if (!event) eventRedirect(id, 'That event does not exist, or is not yours to change.');
  if (event.isLocked) eventRedirect(id, 'A locked event cannot be given a repeat here.');

  const freq = String(formData.get('repeatFreq') ?? '');
  const startOn = londonDayISO(event.startsAt);

  // No frequency means "stop repeating". The rule row goes with it, but only if
  // no other event points at it — the same care `deleteEvent` takes.
  if (freq === '') {
    await asUser(user.id, async (tx) => {
      const [row] = await tx<{ ruleId: string | null }[]>`
        select recurrence_rule_id as "ruleId" from orbit.events
        where id = ${id}::uuid and not is_locked
      `;
      if (!row?.ruleId) return;
      await tx`
        update orbit.events set recurrence_rule_id = null,
                                 is_dirty = (external_id is not null)
        where id = ${id}::uuid and not is_locked
      `;
      await tx`
        delete from orbit.recurrence_rules r
        where r.id = ${row.ruleId}::uuid
          and not exists (select 1 from orbit.events e where e.recurrence_rule_id = r.id)
      `;
    });
    revalidatePath('/', 'layout');
    eventRedirect(id, undefined, 'norepeat');
  }

  const built = rruleFromForm({
    freq: freq as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
    interval: Number(String(formData.get('repeatInterval') ?? '1')),
    byDay: formData.getAll('repeatByDay').map(String) as never,
    endOn: String(formData.get('repeatUntil') ?? '') || null,
    startOn,
  });
  if ('error' in built) eventRedirect(id, built.error);

  const until = parseRrule(built.rrule).until;

  await asUser(user.id, async (tx) => {
    const [row] = await tx<{ ruleId: string | null }[]>`
      select recurrence_rule_id as "ruleId" from orbit.events
      where id = ${id}::uuid and not is_locked
    `;
    if (row?.ruleId) {
      // Updated in place, so the exdates on it survive.
      await tx`
        update orbit.recurrence_rules
        set rrule = ${built.rrule}, dtstart = ${event.startsAt}, until = ${until}
        where id = ${row.ruleId}::uuid
      `;
    } else {
      const [rule] = await tx<{ id: string }[]>`
        insert into orbit.recurrence_rules (space_id, owner_id, rrule, dtstart, until)
        values (${event.space.id}::uuid, ${user.id}::uuid, ${built.rrule},
                ${event.startsAt}, ${until})
        returning id
      `;
      if (!rule) return;
      await tx`
        update orbit.events set recurrence_rule_id = ${rule.id}::uuid,
                                 is_dirty = (external_id is not null)
        where id = ${id}::uuid and not is_locked
      `;
    }
  });

  revalidatePath('/', 'layout');
  eventRedirect(id, undefined, 'repeat');
}

/**
 * Skip one occurrence of a series, or put a skipped one back.
 *
 * The first use of `recurrence_rules.exdates` from the UI — migration 0010 added
 * the column in Phase 2 and only the ICS importer has ever written it. An
 * occurrence is named by its own start instant, which is RFC 5545's
 * RECURRENCE-ID and what the calendar block's key has carried since Phase 2.
 *
 * The instant arrives on a form, so it is a claim from the client and it is
 * checked against the expansion rather than trusted: `occurrenceAt` has to agree
 * that the series genuinely has an occurrence starting there. Without that,
 * "skip the occurrence on anything" would append whatever was submitted, and a
 * rule quietly carrying junk exclusions is a rule that eventually drops an
 * occurrence nobody excluded.
 *
 * Both directions are one array operation and both are reversible, which is why
 * neither needs a confirmation. Nothing is deleted: an occurrence is not a row.
 */
export async function skipOccurrence(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  const on = String(formData.get('on') ?? '');
  const put = String(formData.get('put') ?? 'back') === 'skip' ? 'skip' : 'back';
  if (!id || !on) return;

  const event = await getEvent(user.id, id);
  if (!event) eventRedirect(id, 'That event does not exist, or is not yours to change.');
  if (!event.rrule) eventRedirect(id, 'That event does not repeat, so it has no occurrences to skip.');

  const t = Date.parse(on);
  if (!Number.isFinite(t)) eventRedirect(id, 'That is not an occurrence of this event.');
  const instant = new Date(t).toISOString();

  if (put === 'skip') {
    // Checked against the series as it stands, exclusions included — an instant
    // already skipped is not an occurrence, so this cannot append it twice.
    const found = occurrenceAt(
      {
        rrule: event.rrule,
        dtstart: event.startsAt,
        dtend: event.endsAt,
        exdates: event.exdates,
      },
      instant,
    );
    if (!found) eventRedirect(id, 'That is not an occurrence of this event, or it is already skipped.');
  }

  await asUser(user.id, async (tx) => {
    if (put === 'skip') {
      await tx`
        update orbit.recurrence_rules r
        set exdates = r.exdates || ${instant}::timestamptz
        where r.id = (
          select e.recurrence_rule_id from orbit.events e
          where e.id = ${id}::uuid and not e.is_locked
        )
      `;
    } else {
      // Compared as instants rather than as text: the array holds timestamptz
      // and '2026-04-06T08:00:00.000Z' and '2026-04-06 09:00:00+01' are the same
      // moment written two ways.
      await tx`
        update orbit.recurrence_rules r
        set exdates = coalesce((
          select array_agg(x order by x) from unnest(r.exdates) as x
          where x <> ${instant}::timestamptz
        ), '{}'::timestamptz[])
        where r.id = (
          select e.recurrence_rule_id from orbit.events e
          where e.id = ${id}::uuid and not e.is_locked
        )
      `;
    }
  });

  revalidatePath('/', 'layout');
  eventRedirect(id, undefined, put === 'skip' ? 'skipped' : 'restored');
}

export async function deleteEvent(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    // A recurrence rule belongs to the event that carried it. The FK is
    // `on delete set null`, so deleting the event alone would leave the rule
    // behind as a row nothing points at — invisible, and still counted by the
    // structural checks. It goes too, but only if no other event uses it.
    const [row] = await tx<{ ruleId: string | null }[]>`
      select recurrence_rule_id as "ruleId" from orbit.events where id = ${id}::uuid
    `;
    await tx`delete from orbit.events where id = ${id}::uuid`;
    if (row?.ruleId) {
      await tx`
        delete from orbit.recurrence_rules r
        where r.id = ${row.ruleId}::uuid
          and not exists (select 1 from orbit.events e where e.recurrence_rule_id = r.id)
      `;
    }
  });

  redirect('/calendar/week');
}

/**
 * Move an event to another space.
 *
 * The space indicator requirement says every entity that can move does so
 * behind app.space_move_preview(). This is the event one: same contract as
 * tasks and people, with the extra consequence that the calendar cannot follow
 * — calendars belong to a space, so the event lands in the target space's
 * default calendar or in none at all.
 */
export async function moveEventToSpace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  const targetSpaceId = String(formData.get('targetSpaceId') ?? '');
  if (!id || !targetSpaceId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      select 1 from app.space_move_preview('event'::app.entity_kind,
        ${id}::uuid, ${targetSpaceId}::uuid) limit 1
    `;
    await tx`
      update orbit.events
      set space_id = ${targetSpaceId}::uuid,
          category_id = null,
          place_id = null,
          calendar_id = (
            select c.id from orbit.calendars c
            where c.space_id = ${targetSpaceId}::uuid and c.is_writable
            order by c.sort_order, c.name limit 1
          )
      where id = ${id}::uuid
    `;
    // Attendees belong to the event and travel with it.
    await tx`
      update orbit.event_attendees set space_id = ${targetSpaceId}::uuid
      where event_id = ${id}::uuid
    `;
    await tx`
      insert into orbit.activity_log
        (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
      values (${targetSpaceId}::uuid, ${user.id}::uuid, ${user.id}::uuid, 'event',
              ${id}::uuid, 'moved', 'Moved between spaces')
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Move a note to another space.
 *
 * The fourth entity to get a move confirmation, and the one with the most to
 * lose: a note's links point at tasks, people, events and places that are all
 * space-scoped, so a link that would cross the new boundary cannot survive the
 * move. They are dropped here rather than left dangling, and the confirmation
 * says how many will go before anything is written.
 */
export async function moveNoteToSpace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  const targetSpaceId = String(formData.get('targetSpaceId') ?? '');
  if (!id || !targetSpaceId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      select 1 from app.space_move_preview('note'::app.entity_kind,
        ${id}::uuid, ${targetSpaceId}::uuid) limit 1
    `;
    await tx`
      update orbit.notes set space_id = ${targetSpaceId}::uuid
      where id = ${id}::uuid
    `;
    // A link to something in the old space is now a link across a boundary.
    // app.entity_space() resolves under the caller's own privileges, so an
    // item they cannot read resolves to no rows and the link goes.
    await tx`
      delete from orbit.note_links l
      where l.note_id = ${id}::uuid
        and coalesce(
          (select space_id from app.entity_space(l.entity_kind, l.entity_id)),
          '00000000-0000-0000-0000-000000000000'::uuid
        ) <> ${targetSpaceId}::uuid
    `;
    // Version history is the note's own and travels with it.
    await tx`
      update orbit.note_versions set space_id = ${targetSpaceId}::uuid
      where note_id = ${id}::uuid
    `;
    await tx`
      insert into orbit.activity_log
        (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
      values (${targetSpaceId}::uuid, ${user.id}::uuid, ${user.id}::uuid, 'note',
              ${id}::uuid, 'moved', 'Moved between spaces')
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Import an .ics feed into a calendar.
 *
 * The provider only fetches bytes; parsing, recurrence and the write are all
 * ours, and the write is the same `upsertExternalEvent` a Google pull uses —
 * one implementation, so an ICS event and a pulled event cannot end up shaped
 * differently.
 *
 * Re-importing the same feed updates rather than duplicates: the unique
 * constraint on (space_id, calendar_id, external_id) is what makes that safe,
 * and the UID from the feed is the external id.
 */
export async function importIcs(formData: FormData) {
  const user = await requireUser();
  const calendarId = String(formData.get('calendarId') ?? '');
  const ref = String(formData.get('ref') ?? '').trim();
  if (!calendarId || !ref) return;

  const text = await icsProvider().fetchText({ ref });
  const parsed = parseIcs(text);

  const result = await asUser(user.id, async (tx) => {
    const target = await tx<{ id: string; spaceId: string }[]>`
      select id, space_id as "spaceId" from orbit.calendars
      where id = ${calendarId}::uuid and is_writable
    `;
    const calendar = target[0];
    // No row means the policy refused it, which is the correct answer to
    // "import into somebody else's calendar".
    if (!calendar) return { imported: 0, updated: 0, rules: 0 };

    let imported = 0;
    let updated = 0;
    let rules = 0;

    for (const event of parsed.events) {
      const res = await upsertExternalEvent(
        tx,
        { userId: user.id, spaceId: calendar.spaceId, calendarId: calendar.id },
        event,
      );
      if (res.inserted) imported += 1;
      else if (res.id) updated += 1;
      if (res.wroteRule) rules += 1;
    }

    await tx`
      update orbit.calendar_accounts set last_synced_at = now()
      where id = (select account_id from orbit.calendars where id = ${calendar.id}::uuid)
    `;

    return { imported, updated, rules };
  });

  revalidatePath('/', 'layout');
  redirect(
    `/calendar/import?imported=${result.imported}&updated=${result.updated}&rules=${result.rules}`,
  );
}

/**
 * Connect one of the calendar provider's calendars to a space, and pull it.
 *
 * With CALENDAR_PROVIDER=fake (the default) this runs end to end with no
 * credential — that is the whole point of the interface. With
 * CALENDAR_PROVIDER=google it runs the same code against an implementation
 * that has never been executed here.
 */
export async function connectCalendar(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const externalId = String(formData.get('externalId') ?? '');
  const name = String(formData.get('name') ?? '').trim() || externalId;
  const writable = String(formData.get('writable') ?? '') === 'true';
  if (!spaceId || !externalId) return;

  const providerName = calendarProvider().isFake ? 'local' : 'google';
  const calendarId = await connectProviderCalendar(
    user.id,
    spaceId,
    { externalId, name, writable },
    providerName,
  );
  if (!calendarId) return;

  const result = await pullCalendar(user.id, calendarId);
  revalidatePath('/', 'layout');
  // One template literal, not a concatenation: typed routes lose the literal
  // type through `+` and the build stops being able to check the path.
  redirect(
    `/calendar/import?added=${result.added}&changed=${result.updated}&removed=${result.removed}&full=${result.wasFullPull ? 1 : 0}`,
  );
}

/**
 * Push local edits back to the provider.
 *
 * The other half of a sync that had only ever had one. Until this existed,
 * `events.is_dirty` was set by every local edit and never cleared, and `'pull'`
 * was the only value ever written to `calendar_sync_state.direction`.
 */
export async function pushCalendarEdits(formData: FormData) {
  const user = await requireUser();
  const calendarId = String(formData.get('calendarId') ?? '');
  if (!calendarId) return;

  const result = await pushCalendar(user.id, calendarId);
  revalidatePath('/', 'layout');
  redirect(
    `/calendar/import?pushed=${result.created + result.updated}&created=${result.created}&locked=${result.skippedLocked}&failed=${result.failed.length}`,
  );
}

/** Pull an already-connected calendar again, incrementally if we hold a token. */
export async function syncCalendar(formData: FormData) {
  const user = await requireUser();
  const calendarId = String(formData.get('calendarId') ?? '');
  if (!calendarId) return;

  const result = await pullCalendar(user.id, calendarId);
  revalidatePath('/', 'layout');
  // One template literal, not a concatenation: typed routes lose the literal
  // type through `+` and the build stops being able to check the path.
  redirect(
    `/calendar/import?added=${result.added}&changed=${result.updated}&removed=${result.removed}&full=${result.wasFullPull ? 1 : 0}`,
  );
}

// ---------------------------------------------------------------------------
// Places
//
// A place is a row with an optional point. Nothing here reads a device
// location and nothing here asks for the permission — decision 5. Coordinates
// arrive one of two ways: typed in, or resolved by the GeocodingProvider when
// somebody presses the button.
// ---------------------------------------------------------------------------

export async function createPlace(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  const addressText = String(formData.get('addressText') ?? '').trim() || null;
  const postcode = String(formData.get('postcode') ?? '').trim().toUpperCase() || null;
  if (!spaceId || !name) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.places
        (space_id, owner_id, category_id, name, address_text, postcode)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = ${spaceId}::uuid),
        ${name}, ${addressText}, ${postcode})
      on conflict (space_id, name) do nothing
    `;
  });

  revalidatePath('/', 'layout');
}

export async function updatePlace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id || !name) return;

  const addressText = String(formData.get('addressText') ?? '').trim() || null;
  const postcode = String(formData.get('postcode') ?? '').trim().toUpperCase() || null;
  const city = String(formData.get('city') ?? '').trim() || null;
  const notesMd = String(formData.get('notesMd') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '') || null;

  // Typed-in coordinates are allowed and are not a geocode: the source stays
  // 'manual' so a later geocode does not claim to have produced them.
  const latRaw = String(formData.get('lat') ?? '').trim();
  const lonRaw = String(formData.get('lon') ?? '').trim();
  const lat = latRaw === '' ? null : Number(latRaw);
  const lon = lonRaw === '' ? null : Number(lonRaw);
  const hasPoint =
    lat !== null && lon !== null &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.places pl set
        name         = ${name},
        address_text = ${addressText},
        postcode     = ${postcode},
        city         = ${city},
        notes_md     = ${notesMd},
        category_id  = (
          select c.id from orbit.categories c
          where c.id = ${categoryId}::uuid and c.space_id = pl.space_id
        ),
        geom = ${
          hasPoint
            ? tx`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`
            : tx`null`
        },
        geocode_source = ${hasPoint ? tx`coalesce(pl.geocode_source, 'manual')` : tx`null`},
        geocoded_at    = ${hasPoint ? tx`pl.geocoded_at` : tx`null`},
        updated_at   = now()
      where pl.id = ${id}::uuid and not pl.is_locked
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Resolve coordinates through the GeocodingProvider.
 *
 * The provider is chosen by GEOCODING_PROVIDER and defaults to the fake, which
 * needs no network and no credential — so this button works in a cold
 * container. What gets written is the *source*, so a place always says where
 * its point came from.
 */
export async function geocodePlace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  const query = String(formData.get('query') ?? '').trim();
  if (!id || !query) return;

  const provider = geocodingProvider();
  let results: Awaited<ReturnType<typeof provider.geocode>> = [];
  let failure: string | null = null;
  try {
    results = await provider.geocode(query);
  } catch (err) {
    // A real provider without a credential fails here, not at construction.
    failure = err instanceof Error ? err.message : String(err);
  }

  const best = results[0];
  if (best) {
    await asUser(user.id, async (tx) => {
      await tx`
        update orbit.places set
          geom = ST_SetSRID(ST_MakePoint(${best.lon}, ${best.lat}), 4326)::geography,
          geocoded_at = now(),
          geocode_source = ${provider.name},
          city = coalesce(city, ${best.label.split(',').pop()?.trim() ?? null}),
          updated_at = now()
        where id = ${id}::uuid and not is_locked
      `;
    });
  }

  revalidatePath('/', 'layout');
  const outcome = failure ? 'error' : best ? 'ok' : 'none';
  redirect(`/places/${id}?geocoded=${outcome}`);
}

export async function archivePlace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update orbit.places set archived_at = now() where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/places');
}

export async function restorePlace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update orbit.places set archived_at = null where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

/**
 * Move a place to another space.
 *
 * The last entity type to get a move confirmation, which completes the hard
 * requirement. A place's consequences are its own: the category cannot follow,
 * and every event, visit and travel leg pointing at it either comes along (the
 * visits, which are the place's own history) or is cut loose (an event in the
 * old space, which would otherwise reference a place its readers cannot see).
 */
export async function movePlaceToSpace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  const targetSpaceId = String(formData.get('targetSpaceId') ?? '');
  if (!id || !targetSpaceId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      select 1 from app.space_move_preview('place'::app.entity_kind,
        ${id}::uuid, ${targetSpaceId}::uuid) limit 1
    `;
    await tx`
      update orbit.places
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    // Visits are the place's own history and move with it.
    await tx`
      update orbit.place_visits set space_id = ${targetSpaceId}::uuid
      where place_id = ${id}::uuid
    `;
    // Anything left behind in another space stops pointing at it, rather than
    // pointing at something its readers can no longer see.
    await tx`
      update orbit.events set place_id = null
      where place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      update orbit.travel_legs set from_place_id = null
      where from_place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      update orbit.travel_legs set to_place_id = null
      where to_place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      insert into orbit.activity_log
        (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
      values (${targetSpaceId}::uuid, ${user.id}::uuid, ${user.id}::uuid, 'place',
              ${id}::uuid, 'moved', 'Moved between spaces')
    `;
  });

  revalidatePath('/', 'layout');
}

/** Log a visit by hand. `source` is only ever 'manual' or 'calendar'; see 0005. */
export async function addPlaceVisit(formData: FormData) {
  const user = await requireUser();
  const placeId = String(formData.get('placeId') ?? '');
  const onDate = String(formData.get('onDate') ?? '');
  const arrivedTime = String(formData.get('arrivedTime') ?? '') || null;
  const departedTime = String(formData.get('departedTime') ?? '') || null;
  const notesMd = String(formData.get('notesMd') ?? '');
  if (!placeId || !onDate) return;

  const arrivedAt = instantFromForm(onDate, arrivedTime ?? '00:00');
  if (!arrivedAt) return;
  const departedAt = departedTime ? instantFromForm(onDate, departedTime) : null;
  if (departedAt && departedAt < arrivedAt) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.place_visits
        (space_id, owner_id, place_id, source, arrived_at, departed_at, notes_md)
      select pl.space_id, ${user.id}::uuid, pl.id, 'manual',
             ${arrivedAt}, ${departedAt}, ${notesMd}
      from orbit.places pl where pl.id = ${placeId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePlaceVisit(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('visitId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.place_visits where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

/** Attach an event to a place, or detach it. Both must be in the same space. */
export async function setEventPlace(formData: FormData) {
  const user = await requireUser();
  const eventId = String(formData.get('eventId') ?? '');
  const placeId = String(formData.get('placeId') ?? '') || null;
  if (!eventId) return;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.events e set
        place_id = (
          select pl.id from orbit.places pl
          where pl.id = ${placeId}::uuid and pl.space_id = e.space_id
        ),
        updated_at = now()
      where e.id = ${eventId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// Travel
//
// Decision 5, again and throughout: a journey is manual — you said so — or
// calendar-derived — two events with places imply a trip between them. There is
// no third source. Nothing below reads a position, and Orbit never asks for the
// permission.
//
// The maths lives in src/lib/travel.ts and is tested there. What is here is the
// writing.
// ---------------------------------------------------------------------------

/** A provider estimate for two places, or null when it cannot be had. */
async function estimateBetween(
  from: { lat: number | null; lon: number | null },
  to: { lat: number | null; lon: number | null },
  mode: LegMode,
): Promise<{ minutes: number; metres: number; source: 'provider' | 'none' }> {
  const providerMode = providerModeFor(mode);
  if (
    !providerMode ||
    from.lat === null || from.lon === null ||
    to.lat === null || to.lon === null
  ) {
    // A flight, or a place nobody has geocoded. Fall back to the crude table
    // rather than to a confident number from a routing engine that was never
    // asked — and say so in `estimate_source`.
    if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) {
      return { minutes: 0, metres: 0, source: 'none' };
    }
    const metres = haversineMetres(
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    );
    return { minutes: estimateLegMinutes(metres, mode), metres, source: 'none' };
  }

  try {
    const result = await travelTimeProvider().estimate(
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
      providerMode,
    );
    return { minutes: result.minutes, metres: result.metres, source: 'provider' };
  } catch {
    // A real provider without a credential, or one that refuses this mode. The
    // leg is still worth saving; it just carries no provider estimate.
    return { minutes: 0, metres: 0, source: 'none' };
  }
}

/** Both ends of a leg, read under the caller's own privileges. */
async function placeEnds(userId: string, fromId: string | null, toId: string | null) {
  return asUser(userId, async (tx) => {
    const rows = await tx<
      { id: string; spaceId: string; lat: number | null; lon: number | null }[]
    >`
      select id, space_id as "spaceId",
             ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lon
      from orbit.places
      where id in (${fromId ?? null}::uuid, ${toId ?? null}::uuid)
    `;
    return {
      from: rows.find((r) => r.id === fromId) ?? null,
      to: rows.find((r) => r.id === toId) ?? null,
    };
  });
}

export async function createTravelLeg(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const fromPlaceId = String(formData.get('fromPlaceId') ?? '') || null;
  const toPlaceId = String(formData.get('toPlaceId') ?? '') || null;
  const mode = String(formData.get('mode') ?? 'car') as LegMode;
  const onDate = String(formData.get('onDate') ?? '');
  const departTime = String(formData.get('departTime') ?? '') || null;
  const notesMd = String(formData.get('notesMd') ?? '');
  const eventId = String(formData.get('eventId') ?? '') || null;
  const sessionId = String(formData.get('sessionId') ?? '') || null;
  if (!spaceId || !LEG_MODES.includes(mode)) return;

  const ends = await placeEnds(user.id, fromPlaceId, toPlaceId);
  const estimate = await estimateBetween(
    ends.from ?? { lat: null, lon: null },
    ends.to ?? { lat: null, lon: null },
    mode,
  );
  const plan = planLeg(estimate.minutes, mode);

  // An explicit arrival wins over an estimate; otherwise depart + door-to-door.
  const departAt = onDate ? instantFromForm(onDate, departTime ?? '00:00') : null;
  const arriveTime = String(formData.get('arriveTime') ?? '') || null;
  const arriveAt =
    onDate && arriveTime
      ? instantFromForm(onDate, arriveTime)
      : departAt && plan.doorToDoorMinutes > 0
        ? new Date(departAt.getTime() + plan.doorToDoorMinutes * 60_000)
        : null;
  if (arriveAt && departAt && arriveAt < departAt) return;

  const minutes =
    arriveAt && departAt
      ? Math.round((arriveAt.getTime() - departAt.getTime()) / 60_000)
      : plan.doorToDoorMinutes || null;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.travel_legs
        (space_id, owner_id, session_id, from_place_id, to_place_id, event_id, mode,
         depart_at, arrive_at, duration_minutes, distance_metres, estimate_source,
         estimated_at, notes_md)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        -- Resolved against the chosen space rather than trusted: a stale form
        -- could otherwise file a journey under a trip in another space.
        (select t.id from orbit.travel_sessions t
          where t.id = ${sessionId}::uuid and t.space_id = ${spaceId}::uuid),
        ${fromPlaceId}::uuid, ${toPlaceId}::uuid, ${eventId}::uuid, ${mode},
        ${departAt}, ${arriveAt}, ${minutes}, ${estimate.metres || null},
        ${estimate.source}, ${estimate.source === 'none' ? null : new Date()},
        ${notesMd})
    `;
  });

  revalidatePath('/', 'layout');
}

export async function deleteTravelLeg(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('legId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from orbit.travel_legs where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

/** Re-ask the provider for a saved leg. The mode may have changed since. */
export async function reestimateTravelLeg(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('legId') ?? '');
  const mode = String(formData.get('mode') ?? '') as LegMode;
  if (!id || !LEG_MODES.includes(mode)) return;

  const leg = await asUser(user.id, async (tx) => {
    const rows = await tx<
      {
        fromLat: number | null; fromLon: number | null;
        toLat: number | null; toLon: number | null;
        departAt: string | null;
      }[]
    >`
      select ST_Y(fp.geom::geometry) as "fromLat", ST_X(fp.geom::geometry) as "fromLon",
             ST_Y(tp.geom::geometry) as "toLat",   ST_X(tp.geom::geometry) as "toLon",
             l.depart_at as "departAt"
      from orbit.travel_legs l
      left join orbit.places fp on fp.id = l.from_place_id
      left join orbit.places tp on tp.id = l.to_place_id
      where l.id = ${id}::uuid
    `;
    return rows[0] ?? null;
  });
  if (!leg) return;

  const estimate = await estimateBetween(
    { lat: leg.fromLat, lon: leg.fromLon },
    { lat: leg.toLat, lon: leg.toLon },
    mode,
  );
  const plan = planLeg(estimate.minutes, mode);
  const departAt = leg.departAt ? new Date(leg.departAt) : null;
  const arriveAt =
    departAt && plan.doorToDoorMinutes > 0
      ? new Date(departAt.getTime() + plan.doorToDoorMinutes * 60_000)
      : null;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.travel_legs set
        mode = ${mode},
        duration_minutes = ${plan.doorToDoorMinutes || null},
        distance_metres  = ${estimate.metres || null},
        arrive_at        = ${arriveAt},
        estimate_source  = ${estimate.source},
        estimated_at     = ${estimate.source === 'none' ? null : new Date()},
        updated_at       = now()
      where id = ${id}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Save a leg the calendar implied.
 *
 * The endpoints and times come from the derivation rather than from the form,
 * so what is written is what was shown. The form carries only the identifiers
 * and the mode — and the database is what decides whether the caller may write
 * into that space at all.
 */
export async function saveDerivedLeg(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const fromPlaceId = String(formData.get('fromPlaceId') ?? '') || null;
  const toPlaceId = String(formData.get('toPlaceId') ?? '') || null;
  const eventId = String(formData.get('eventId') ?? '') || null;
  const mode = String(formData.get('mode') ?? 'car') as LegMode;
  const arriveByIso = String(formData.get('arriveBy') ?? '');
  const day = String(formData.get('day') ?? '');
  if (!spaceId || !toPlaceId || !arriveByIso || !LEG_MODES.includes(mode)) return;

  const arriveBy = new Date(arriveByIso);
  if (Number.isNaN(arriveBy.getTime())) return;

  const ends = await placeEnds(user.id, fromPlaceId, toPlaceId);
  const estimate = await estimateBetween(
    ends.from ?? { lat: null, lon: null },
    ends.to ?? { lat: null, lon: null },
    mode,
  );
  const plan = planLeg(estimate.minutes, mode);
  const departAt = departBy(arriveBy, plan);

  await asUser(user.id, async (tx) => {
    // The page stops offering a journey it can see is already saved, but two
    // tabs or a double click get past that — and `travel_legs` has no unique
    // constraint that would refuse the second row. The insert therefore checks
    // for itself, in the same statement, rather than trusting the button.
    await tx`
      insert into orbit.travel_legs
        (space_id, owner_id, from_place_id, to_place_id, event_id, mode,
         depart_at, arrive_at, duration_minutes, distance_metres, estimate_source,
         estimated_at, notes_md)
      select
        ${spaceId}::uuid, ${user.id}::uuid, ${fromPlaceId}::uuid, ${toPlaceId}::uuid,
        ${eventId}::uuid, ${mode}, ${departAt}, ${arriveBy},
        ${plan.doorToDoorMinutes}, ${estimate.metres || null}, ${estimate.source},
        ${estimate.source === 'none' ? null : new Date()},
        'Derived from the calendar.'
      where not exists (
        select 1 from orbit.travel_legs l
        where l.to_place_id = ${toPlaceId}::uuid
          and l.arrive_at = ${arriveBy}
          and l.from_place_id is not distinct from ${fromPlaceId}::uuid
      )
    `;
  });

  revalidatePath('/', 'layout');
  if (day) redirect(`/travel?day=${day}`);
}

export async function createTravelSession(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const startDate = String(formData.get('startDate') ?? '');
  const endDate = String(formData.get('endDate') ?? '');
  const destinationPlaceId = String(formData.get('destinationPlaceId') ?? '') || null;
  const originPlaceId = String(formData.get('originPlaceId') ?? '') || null;
  if (!spaceId || !title || !startDate || !endDate) return;

  const startsAt = instantFromForm(startDate, '00:00');
  const endsAt = instantFromForm(endDate, '23:59');
  if (!startsAt || !endsAt || endsAt < startsAt) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.travel_sessions
        (space_id, owner_id, title, source, origin_place_id, destination_place_id,
         starts_at, ends_at, is_active)
      values (
        ${spaceId}::uuid, ${user.id}::uuid, ${title}, 'manual',
        ${originPlaceId}::uuid, ${destinationPlaceId}::uuid,
        ${startsAt}, ${endsAt},
        ${startsAt <= new Date() && endsAt >= new Date()})
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Create a session from a multi-day event.
 *
 * The other half of decision 5. `sessionFromEvent()` decides whether the event
 * is a trip at all — a gig that runs past midnight is a late night, not a trip
 * — and the answer is the same one the page showed before the button existed.
 */
export async function createSessionFromEvent(formData: FormData) {
  const user = await requireUser();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) return;

  const event = await asUser(user.id, async (tx) => {
    const rows = await tx<
      {
        id: string; title: string; spaceId: string; startsAt: string; endsAt: string;
        allDay: boolean; placeId: string | null;
      }[]
    >`
      select id, title, space_id as "spaceId", starts_at as "startsAt",
             ends_at as "endsAt", all_day as "allDay", place_id as "placeId"
      from orbit.events where id = ${eventId}::uuid and not is_locked
    `;
    return rows[0] ?? null;
  });
  if (!event) return;

  const draft = sessionFromEvent({
    ...event,
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: new Date(event.endsAt).toISOString(),
    placeName: null,
    placeLat: null,
    placeLon: null,
  });
  if (!draft) return;

  await asUser(user.id, async (tx) => {
    await tx`
      insert into orbit.travel_sessions
        (space_id, owner_id, title, source, destination_place_id, event_id,
         starts_at, ends_at, is_active)
      values (
        ${event.spaceId}::uuid, ${user.id}::uuid, ${draft.title}, 'calendar',
        ${draft.destinationPlaceId}::uuid, ${draft.eventId}::uuid,
        ${draft.startsAt}, ${draft.endsAt},
        ${sessionIsActive(draft)})
    `;
  });

  revalidatePath('/', 'layout');
}

/**
 * Edit a trip: its title, its dates, where it goes and its notes.
 *
 * Rough edge since Phase 4 — a trip could be created and deleted and nothing in
 * between, so a date typed wrong meant deleting the trip and its journeys with
 * it, because the FK cascades.
 *
 * `is_active` is written from the dates here, the same way both create paths
 * write it, which is the other half of that rough edge: the column was set once
 * at creation and never touched again. It still is not read anywhere — every
 * surface derives from the dates through `tripStanding`, because nothing sweeps
 * the column and Orbit has no scheduler by decision, so a stored "away" goes
 * stale the moment a trip ends. Keeping it correct at every write costs one
 * expression; trusting it would cost the truth.
 *
 * The space is deliberately not editable. Moving a trip would have to move its
 * journeys, and every journey's two places, and a place in another space is a
 * place the other member cannot see — so it needs `space_move_preview()` and a
 * confirmation, on the same terms as a task. Nothing here makes it movable.
 */
export async function updateTravelSession(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('sessionId') ?? '');
  if (!id) return;

  const title = String(formData.get('title') ?? '').trim();
  const startDate = String(formData.get('startDate') ?? '');
  const endDate = String(formData.get('endDate') ?? '');
  const notesMd = String(formData.get('notesMd') ?? '');
  const originPlaceId = String(formData.get('originPlaceId') ?? '') || null;
  const destinationPlaceId = String(formData.get('destinationPlaceId') ?? '') || null;

  if (!title) return tripRedirect(id, 'A trip needs a name.');
  const startsAt = instantFromForm(startDate, '00:00');
  const endsAt = instantFromForm(endDate, '23:59');
  if (!startsAt || !endsAt) return tripRedirect(id, 'A trip needs a start date and an end date.');
  // The database has the same check as a constraint; catching it here is what
  // turns a 500 into a sentence.
  if (endsAt < startsAt) return tripRedirect(id, 'A trip cannot end before it starts.');

  const updated = await asUser(user.id, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update orbit.travel_sessions set
        title                = ${title},
        starts_at            = ${startsAt},
        ends_at              = ${endsAt},
        notes_md             = ${notesMd},
        origin_place_id      = ${originPlaceId}::uuid,
        destination_place_id = ${destinationPlaceId}::uuid,
        is_active            = ${sessionIsActive({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        })}
      where id = ${id}::uuid
      returning id
    `;
    return rows.length > 0;
  });

  revalidatePath('/', 'layout');
  // A trip in a space you are not in updates nothing, and says so as a sentence
  // rather than pretending it saved.
  if (!updated) tripRedirect(id, 'That trip does not exist, or is not yours to change.');
  tripRedirect(id, undefined, '1');
}

function tripRedirect(id: string, error?: string, saved?: string): never {
  const q = new URLSearchParams();
  if (error) q.set('error', error);
  if (saved) q.set('saved', saved);
  const suffix = q.toString();
  redirect(suffix ? `/travel/trip/${id}?${suffix}` : `/travel/trip/${id}`);
}

export async function deleteTravelSession(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('sessionId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    // The FK cascades the legs; a leg with no session is not a leg anybody
    // asked for.
    await tx`delete from orbit.travel_sessions where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  // Deleted from its own page, there is no page left to stay on. The value is
  // compared against a literal rather than redirected to, so this can never
  // become somewhere a form field chose.
  if (String(formData.get('then') ?? '') === 'travel') redirect('/travel');
}

// ===========================================================================
// Rules — Phase 4
//
// Nothing here decides what a rule does; that is src/lib/rules.ts, which is
// pure and tested. These actions are the plumbing: read a form, ask the query
// module, redirect somewhere that shows the result.
//
// Every failure is carried in the URL rather than thrown, because a rule that
// refuses to enable has something to say and a stack trace is not it.
// ===========================================================================

function ruleRedirect(id: string, params: Record<string, string | undefined>): never {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const suffix = qs.toString();
  redirect(suffix ? `/rules/${id}?${suffix}` : `/rules/${id}`);
}

export async function createRuleAction(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const name = String(formData.get('name') ?? '');
  const description = String(formData.get('description') ?? '');
  const kind = String(formData.get('triggerKind') ?? 'task.created');
  const cron = String(formData.get('cron') ?? '0 7 * * *');

  if (!isTriggerKind(kind)) return;
  const trigger: Trigger = kind === 'schedule' ? { kind, cron } : { kind };

  const result = await createRule(user.id, { spaceId, name, description, trigger });
  revalidatePath('/', 'layout');
  if ('error' in result) redirect(`/rules?error=${encodeURIComponent(result.error)}`);
  ruleRedirect(result.id, { created: '1' });
}

export async function updateRuleAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const kind = String(formData.get('triggerKind') ?? '');
  const cron = String(formData.get('cron') ?? '0 7 * * *');
  const trigger: Trigger | undefined = !isTriggerKind(kind)
    ? undefined
    : kind === 'schedule'
      ? { kind, cron }
      : { kind };

  const result = await updateRuleParts(user.id, id, {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    trigger,
  });
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined, saved: '1' });
}

export async function addRuleConditionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const raw = {
    field: String(formData.get('field') ?? ''),
    op: String(formData.get('op') ?? ''),
    value: String(formData.get('value') ?? ''),
  };
  const result = await addCondition(user.id, id, raw);
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

/**
 * Edit one condition where it sits, rather than removing it and adding it back
 * at the end. Order is reading order, and a rule you have to re-read from the
 * bottom every time you change a threshold is a rule nobody edits.
 */
export async function editRuleConditionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const raw = {
    field: String(formData.get('field') ?? ''),
    op: String(formData.get('op') ?? ''),
    value: String(formData.get('value') ?? ''),
  };
  const result = await updateCondition(user.id, id, Number(formData.get('index')), raw);
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

export async function removeRuleConditionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const result = await removeCondition(user.id, id, Number(formData.get('index')));
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

export async function addRuleActionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  // One kind plus one string. `rawActionFrom` knows which key of the action
  // object the string belongs in — it is the same table the form renders itself
  // from, so the two halves cannot drift apart — and `parseActions`, one layer
  // down, is still the only thing that decides whether the result is valid.
  const raw = rawActionFrom(
    String(formData.get('kind') ?? ''),
    String(formData.get('value') ?? '').trim(),
  );

  const result = await addAction(user.id, id, raw);
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

/**
 * The same for an action: edited in place, keeping its position.
 *
 * Position matters more here than it does for a condition. Every condition has
 * to hold, so their order is only reading order; actions are *applied* in order,
 * so removing one and re-adding it at the end to change a value could change
 * what the rule does to a task. That is why this exists rather than "remove and
 * add again" being good enough.
 */
export async function editRuleActionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const raw = rawActionFrom(
    String(formData.get('kind') ?? ''),
    String(formData.get('value') ?? '').trim(),
  );

  const result = await updateAction(user.id, id, Number(formData.get('index')), raw);
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

export async function removeRuleActionAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const result = await removeAction(user.id, id, Number(formData.get('index')));
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

/**
 * Dry-run a rule.
 *
 * The result is not returned to the caller — it is written to `rule_runs` and
 * the page reads it back. That is deliberate: the preview somebody acts on is
 * the row in the audit trail, not a value that existed for one render.
 */
export async function dryRunRuleAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const result = await runRule(user.id, id, { dryRun: true });
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined, preview: '1' });
}

export async function runRuleNowAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const result = await runRule(user.id, id, { dryRun: false });
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined, ran: '1' });
}

export async function setRuleEnabledAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  const enabled = String(formData.get('enabled') ?? '') === '1';
  const result = await setRuleEnabled(user.id, id, enabled);
  revalidatePath('/', 'layout');
  ruleRedirect(id, { error: 'error' in result ? result.error : undefined });
}

export async function deleteRuleAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('ruleId') ?? '');
  if (!id) return;
  await deleteRule(user.id, id);
  revalidatePath('/', 'layout');
  redirect('/rules');
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Create whatever a captured line described.
 *
 * The **text** is what the form carries, not the parse. Re-parsing it here
 * costs nothing and means the thing that gets created is produced by the same
 * function that produced the preview somebody read — a form carrying a resolved
 * date would be a form somebody could edit into a date the preview never
 * showed.
 *
 * The parser is local-only by decision 8; nothing on this path sends the text
 * anywhere except into the row it creates.
 */
export async function captureCreate(formData: FormData) {
  const user = await requireUser();
  const text = String(formData.get('text') ?? '');
  const spaceId = String(formData.get('spaceId') ?? '');
  const rawKind = String(formData.get('kind') ?? '');
  const kind =
    rawKind === 'task' || rawKind === 'note' || rawKind === 'event' ? rawKind : undefined;

  const result = await createFromCapture(user.id, text, { spaceId, kind });

  if ('error' in result) {
    redirect(`/capture?text=${encodeURIComponent(text)}&error=${encodeURIComponent(result.error)}`);
  }

  // A capture that produced a task fires the task rules, exactly as the compose
  // bar does. A rule the user wrote should not care which surface typed it.
  if (result.kind === 'task') await fireForTask(user.id, 'task.created', result.id);

  revalidatePath('/', 'layout');
  redirect(result.href as never);
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

/**
 * Switch one AI feature on or off, in one space.
 *
 * There is no "AI on" switch and there is not going to be one. Consent is per
 * feature and per space because that is the granularity at which somebody can
 * actually answer the question "what did I agree to send".
 */
export async function setAiConsent(formData: FormData) {
  const user = await requireUser();
  const consentId = String(formData.get('consentId') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === '1';
  if (!consentId) return;

  const result = await setConsent(user.id, consentId, enabled);
  revalidatePath('/', 'layout');
  if ('error' in result) redirect(`/ai?error=${encodeURIComponent(result.error)}`);
  redirect('/ai');
}

/**
 * Run one AI feature against one note.
 *
 * The refusal and the answer are both carried back on the URL so the page can
 * show what was sent next to what came back — the same bargain the rules
 * engine's dry run makes. A refusal shows no prompt because there was none:
 * nothing was assembled and nothing was sent.
 */
/**
 * Run one AI feature against one subject, and come back to where you were.
 *
 * The same function behind all three surfaces: the AI page's note picker, the
 * "break it into steps" button on a task, and "review the week ahead" on
 * Today. What differs between them is the subject reader, which lives in
 * `readSubject` — not the gate, not the consent check and not the run row.
 *
 * `back` is checked against a list rather than trusted: a redirect target from
 * a form is an open redirect if it is not.
 */
export async function runAiFeatureFor(formData: FormData) {
  const user = await requireUser();
  const feature = String(formData.get('feature') ?? '');
  const subjectId = String(formData.get('subjectId') ?? '');
  const back = String(formData.get('back') ?? '');
  if (!feature || !subjectId) return;

  const result = await runAiFeature(user.id, feature, subjectId);
  revalidatePath('/', 'layout');

  const params = new URLSearchParams();
  if (result.ok) {
    params.set('sent', result.prompt);
    params.set('answer', result.text);
  } else {
    params.set('refused', result.reason ?? 'It did not run.');
  }

  if (back === 'today') redirect(`/?${params.toString()}`);
  if (back === 'task') redirect(`/tasks/item/${subjectId}?${params.toString()}`);
  redirect(`/ai?${params.toString()}`);
}

export async function runAiOnNote(formData: FormData) {
  const user = await requireUser();
  const feature = String(formData.get('feature') ?? '');
  const noteId = String(formData.get('noteId') ?? '');
  if (!feature || !noteId) return;

  const result = await runAiFeature(user.id, feature, noteId);
  revalidatePath('/', 'layout');

  const params = new URLSearchParams();
  if (result.ok) {
    params.set('sent', result.prompt);
    params.set('answer', result.text);
  } else {
    params.set('refused', result.reason ?? 'It did not run.');
  }
  redirect(`/ai?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Phase 6 — sync
// ---------------------------------------------------------------------------

/**
 * Send a device's queue.
 *
 * Called from the client with the queue as data rather than as a form, because
 * a queue is a list and a form is not. Everything it does still happens through
 * `asUser`: **a queued write is still a write**, and one made offline into a
 * space the account has since left is refused by the same policy that would
 * have refused it online. There is no elevated path for catching up.
 */
export async function sendQueue(writes: PendingWrite[]): Promise<{
  outcomes: FlushOutcome[];
  dropped: string[];
  serverNow: string;
}> {
  const user = await requireUser();

  // The kind and the fields are checked here rather than trusted from the
  // client, because this action is reachable with anything the client cares to
  // send. A write naming a column that is not syncable is a bug or an attack,
  // and either way it is refused before it reaches a query.
  for (const w of writes) {
    if (!isSyncEntityKind(w.entityKind)) throw new Error(`not a syncable kind: ${w.entityKind}`);
    for (const f of Object.keys(w.changes)) {
      if (!isSyncableField(w.entityKind, f)) {
        throw new Error(`${f} is not a syncable field on a ${w.entityKind}`);
      }
    }
  }

  const result = await flushQueue(user.id, writes);
  revalidatePath('/', 'layout');

  return {
    outcomes: result.results.map((r) => ({
      opId: r.opId,
      outcome: r.outcome,
      note: r.outcome === 'conflict' ? r.conflict.reason : r.note,
      conflict: r.outcome === 'conflict' ? r.conflict : null,
    })),
    dropped: result.droppedDuplicates,
    serverNow: result.serverNow,
  };
}

/**
 * Answer a conflict.
 *
 * The answer is an ordinary write with a fresh base, not a privileged one. If
 * the row moved again between reading the conflict and answering it, the answer
 * conflicts in its turn rather than landing on top of a third edit nobody has
 * seen.
 */
export async function answerConflict(
  conflict: Conflict,
  choice: ConflictChoice,
): Promise<{ ok: boolean; note: string; conflict: Conflict | null }> {
  const user = await requireUser();
  if (!isSyncEntityKind(conflict.entityKind)) throw new Error('not a syncable kind');
  for (const f of Object.keys(conflict.mergeable)) {
    if (!isSyncableField(conflict.entityKind, f)) throw new Error('not a syncable field');
  }
  for (const c of conflict.clashes) {
    if (!isSyncableField(conflict.entityKind, c.field)) throw new Error('not a syncable field');
  }

  const current = await readCurrent(user.id, conflict.entityKind, conflict.entityId);
  if (!current) {
    return {
      ok: false,
      note: 'That item is gone. Nothing has been written.',
      conflict: { ...conflict, kind: 'deleted_elsewhere', clashes: [], mergeable: {} },
    };
  }

  const outcome = await resolveConflictWrite(user.id, conflict, choice, current.updatedAt);
  revalidatePath('/', 'layout');

  if (outcome.outcome === 'conflict') {
    return { ok: false, note: outcome.conflict.reason, conflict: outcome.conflict };
  }
  return {
    ok: true,
    note:
      choice === 'mine'
        ? 'Your version was written. The other one is in the item’s history, not lost.'
        : 'The other version was kept. Everything nobody disagreed about was still applied.',
    conflict: null,
  };
}

/**
 * Say which device this browser is, and make sure the rows exist to say it with.
 *
 * Rough edge since Phase 6: the outbox is scoped to a browser profile and every
 * cursor belongs to a row in `devices`, and nothing connected the two — `/sync`
 * showed "this device's queue" above "how far Priya — laptop has caught up" with
 * no reason to believe they were the same device, and did not say so.
 *
 * A label, in a cookie, because `/sync` is a server component and a value only
 * the client can read cannot pick the right row. `devices` is keyed
 * `(space_id, owner_id, label)`, so one browser is one row per space — which is
 * what a space-scoped cursor requires, and which is why this claims a row in
 * every space the caller can write to rather than one row overall.
 *
 * `on conflict … do update` rather than an insert: claiming the same label twice
 * is somebody pressing the button again, not an error, and it is how the label is
 * *renamed* too — the old rows keep their cursors, so renaming a browser does not
 * make it forget how far it had caught up. Only the spaces the caller can write
 * to: registering a device in a space you can only read would be writing a row
 * into somebody else's space, which the policies refuse anyway.
 */
export async function nameThisDevice(formData: FormData) {
  const user = await requireUser();
  const label = normaliseDeviceLabel(String(formData.get('label') ?? ''));
  if (label === '') redirect('/sync?error=A+device+needs+a+name.');

  const spaces = await listSpaces(user.id);
  const writable = spaces.filter((s) => s.canWrite);

  await asUser(user.id, async (tx) => {
    for (const space of writable) {
      await tx`
        insert into orbit.devices (space_id, owner_id, label, platform, last_seen_at)
        values (${space.id}::uuid, ${user.id}::uuid, ${label}, 'web', now())
        on conflict (space_id, owner_id, label)
        do update set last_seen_at = now(), revoked_at = null
      `;
    }
  });

  await setThisDeviceLabel(label);
  revalidatePath('/', 'layout');
  redirect('/sync?named=1');
}

/** Mark a device as having caught up with a space, to the instant the page was read. */
export async function catchUpDevice(formData: FormData) {
  const user = await requireUser();
  const deviceId = String(formData.get('deviceId') ?? '');
  const spaceId = String(formData.get('spaceId') ?? '');
  const upTo = String(formData.get('upTo') ?? '');
  if (!deviceId || !spaceId || !upTo) return;

  for (const kind of SYNC_ENTITY_KINDS) {
    await advanceCursor(user.id, spaceId, deviceId, kind, upTo);
  }
  revalidatePath('/', 'layout');
  redirect(`/sync?device=${deviceId}`);
}

/** Wind a device's cursors back to the epoch, so the next sync re-reads everything. */
export async function rewindDevice(formData: FormData) {
  const user = await requireUser();
  const deviceId = String(formData.get('deviceId') ?? '');
  const spaceId = String(formData.get('spaceId') ?? '');
  if (!deviceId || !spaceId) return;

  await resetCursors(user.id, spaceId, deviceId);
  revalidatePath('/', 'layout');
  redirect(`/sync?device=${deviceId}`);
}

// ---------------------------------------------------------------------------
// Spaces: invitations and membership
//
// Creating, revoking and removing are ordinary policy-bound writes — an admin
// is an admin because `app.is_space_admin` says so, and nothing here re-decides
// that in TypeScript. Accepting is the one operation that cannot be, and it
// goes through `app.space_invite()`; see supabase/migrations/0012 for why.
// ---------------------------------------------------------------------------

/**
 * Create an invitation and show its link once.
 *
 * The raw token is generated here, hashed on the way into the database, and
 * handed back on the URL so the page that renders next can show it. That is the
 * only moment it exists: reload the page and it is gone, because there is
 * nowhere it could have been read from. It is on the URL for the same reason
 * the AI result is — an accepted rough edge, recorded rather than hidden: it
 * lands in this browser's history.
 */
export async function createSpaceInvite(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const role = String(formData.get('role') ?? '');
  const email = String(formData.get('invitedEmail') ?? '').trim();

  if (!spaceId) redirect('/spaces');
  if (!isInviteRole(role)) {
    redirect(`/spaces/${spaceId}?error=${encodeURIComponent('Pick a role for the invitation.')}`);
  }

  const days = expiryDaysFrom(String(formData.get('days') ?? ''));
  if (typeof days !== 'number') {
    redirect(`/spaces/${spaceId}?error=${encodeURIComponent(days.error)}`);
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect(
      `/spaces/${spaceId}?error=${encodeURIComponent(
        'That does not look like an email address. Leave it empty for a link anybody may use.',
      )}`,
    );
  }

  const token = newInviteToken();
  const result = await createInvite(
    user.id,
    spaceId,
    token,
    role,
    expiresAtFrom(days),
    email || null,
  );

  if ('error' in result) {
    redirect(`/spaces/${spaceId}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath('/', 'layout');
  redirect(`/spaces/${spaceId}?token=${encodeURIComponent(token)}`);
}

/** Revoke an unredeemed invitation by expiring it. Nothing is deleted. */
export async function revokeSpaceInvite(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const inviteId = String(formData.get('inviteId') ?? '');
  if (!spaceId || !inviteId) redirect('/spaces');

  const result = await revokeInvite(user.id, inviteId);
  revalidatePath('/', 'layout');
  if ('error' in result) {
    redirect(`/spaces/${spaceId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/spaces/${spaceId}?revoked=1`);
}

/** Remove somebody from a space: `status = 'left'`, never a delete. */
export async function removeSpaceMember(formData: FormData) {
  const user = await requireUser();
  const spaceId = String(formData.get('spaceId') ?? '');
  const memberId = String(formData.get('memberId') ?? '');
  if (!spaceId || !memberId) redirect('/spaces');

  const result = await removeMember(user.id, spaceId, memberId);
  revalidatePath('/', 'layout');
  if ('error' in result) {
    redirect(`/spaces/${spaceId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/spaces/${spaceId}?removed=1`);
}

/**
 * Accept an invitation.
 *
 * Every refusal comes back to the invitation screen as a status it can turn
 * into a sentence. None of them is a 403: being told an invitation is not for
 * you is an ordinary answer, and a permission error page would be both wrong
 * and unhelpful.
 */
export async function acceptSpaceInvite(formData: FormData) {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/');

  const result = await acceptInvite(user.id, token);
  revalidatePath('/', 'layout');

  if (result.status === 'accepted' && result.spaceId) {
    redirect(`/spaces/${result.spaceId}?joined=1`);
  }
  redirect(`/invite/${encodeURIComponent(token)}?outcome=${result.status}`);
}

/** Decline. Deliberately writes nothing — see migration 0012. */
export async function declineSpaceInvite(formData: FormData) {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/');

  const result = await declineInvite(user.id, token);
  redirect(`/invite/${encodeURIComponent(token)}?outcome=${result.status}`);
}

// ---------------------------------------------------------------------------
// Settings
//
// Three preferences in cookies and one write to `devices.revoked_at`. Nothing
// here is a permission: the preferences change what somebody's own browser
// renders, and revoking is scoped to the caller's own rows in the statement as
// well as by the policy behind it. See `src/lib/prefs/index.ts` for why these
// are cookies rather than a table, and what that costs.
// ---------------------------------------------------------------------------

/**
 * Set the theme, and land back on the page it was set from.
 *
 * `revalidatePath('/', 'layout')` is the point of the whole exercise: the
 * layout is what renders `<html data-theme>`, so re-rendering it is what makes
 * the new theme arrive already applied rather than being swapped in afterwards.
 */
export async function setTheme(formData: FormData) {
  await requireUser();
  const choice = String(formData.get('theme') ?? '');
  if (!isThemeChoice(choice)) redirect('/settings?error=Unknown+theme.');

  await writeTheme(choice);
  revalidatePath('/', 'layout');
  redirect('/settings?saved=theme');
}

/** Which day a calendar week begins on. Display only — see `weekDays`. */
export async function setWeekStart(formData: FormData) {
  await requireUser();
  await writeWeekStart(parseWeekStart(String(formData.get('weekStart') ?? '')));
  revalidatePath('/', 'layout');
  redirect('/settings?saved=week');
}

/**
 * Which space the compose bar starts in.
 *
 * Validated against the caller's writable spaces here as well as on every read.
 * Checking on the way in gives a plain refusal instead of a preference that
 * silently does nothing; checking on the way out is what still holds after
 * somebody is removed from a space.
 */
export async function setDefaultSpace(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get('spaceId') ?? '');

  if (raw !== '') {
    const spaces = await listSpaces(user.id);
    const writable = spaces.filter((s) => s.canWrite).map((s) => s.id);
    if (resolveDefaultSpace(raw, writable) === null) {
      redirect('/settings?error=That+is+not+a+space+you+can+write+to.');
    }
  }

  await writeDefaultSpace(raw);
  revalidatePath('/', 'layout');
  redirect('/settings?saved=space');
}

/**
 * Revoke a device, or restore one — edge 4.
 *
 * A device is revoked per row, but "this browser" is a row per space, so the
 * form offers both: one row, or every row carrying this browser's label. The
 * consequence is asserted rather than assumed — `advanceCursor` refuses to move
 * a revoked device's cursor, which is checked in the smoke run and is the
 * reason revoking is more than a label.
 */
export async function setDeviceRevocation(formData: FormData) {
  const user = await requireUser();
  const deviceId = String(formData.get('deviceId') ?? '');
  const label = String(formData.get('label') ?? '');
  const revoked = String(formData.get('revoked') ?? '') === '1';

  // By label — every row that is this browser — or by row.
  if (label !== '') {
    const n = await setDeviceRevokedByLabel(user.id, label, revoked);
    revalidatePath('/', 'layout');
    redirect(
      n === 0
        ? '/settings?error=No+device+of+yours+has+that+name.'
        : `/settings?saved=${revoked ? 'revoked' : 'restored'}`,
    );
  }

  if (!deviceId) redirect('/settings');

  const rows = await setDeviceRevoked(user.id, deviceId, revoked);
  revalidatePath('/', 'layout');
  redirect(
    rows.length === 0
      ? '/settings?error=That+device+is+not+yours+to+revoke.'
      : `/settings?saved=${revoked ? 'revoked' : 'restored'}`,
  );
}

/**
 * Set or clear one task's assignee — edge 32.
 *
 * Its own action rather than a trip through `updateTask`, because the row has
 * only this one field and `updateTask` would need every other value posted back
 * with it — a form on a list row that carried the title, the body and the
 * status would overwrite all three from whatever the page last rendered.
 *
 * The assignee is resolved in SQL against the task's own space, exactly as
 * `updateTask` resolves it: somebody who is not an active member with a role
 * that can hold a task becomes NULL rather than being written. The policies
 * already stop a write to a task you cannot reach; this stops a stale page from
 * producing a row that references across a space boundary.
 */
export async function setTaskAssignee(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('taskId') ?? '');
  if (!id) return;

  const assigneeId = String(formData.get('assigneeId') ?? '') || null;

  await asUser(user.id, async (tx) => {
    await tx`
      update orbit.tasks t set
        assignee_id = (
          select m.user_id from orbit.space_members m
          where m.user_id = ${assigneeId}::uuid
            and m.space_id = t.space_id
            and m.status = 'active'
            and m.role in ('owner','admin','member')
        ),
        updated_at = now()
      where t.id = ${id}::uuid and not t.is_locked
    `;
  });

  await fireForTask(user.id, 'task.updated', id);
  revalidatePath('/', 'layout');
}
