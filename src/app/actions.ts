'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { asUser } from '@/lib/db';
import { listSelectableUsers, requireUser, USER_COOKIE } from '@/lib/auth';
import { addDaysISO, londonInstant } from '@/lib/format';
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
import { isTriggerKind, type Trigger } from '@/lib/rules';
import {
  addAction,
  fireForTask,
  addCondition,
  createRule,
  deleteRule,
  removeAction,
  removeCondition,
  runRule,
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
  SYNC_ENTITY_KINDS,
} from '@/lib/queries/sync';
import {
  isSyncEntityKind,
  type Conflict,
  type ConflictChoice,
  type PendingWrite,
} from '@/lib/sync/conflict';
import type { FlushOutcome } from '@/lib/sync/outbox';
import { runAiFeature, setConsent } from '@/lib/queries/ai';
import {
  connectProviderCalendar,
  pullCalendar,
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
        update public.tasks
        set status = 'done', completed_at = now()
        where id = ${id}::uuid and status <> 'done'
      `;
    } else {
      await tx`
        update public.tasks
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
      insert into public.tasks (space_id, owner_id, category_id, title, due_on, assignee_id)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from public.categories c
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
      update public.tasks t set
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
          select c.id from public.categories c
          where c.id = ${categoryId}::uuid and c.space_id = t.space_id
        ),
        assignee_id = (
          select m.user_id from public.space_members m
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
    await tx`delete from public.tasks where id = ${id}::uuid`;
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
      insert into public.notes (space_id, owner_id, title, body_md)
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
      insert into public.note_versions (space_id, owner_id, note_id, version, title, body_md)
      select n.space_id, ${user.id}::uuid, n.id,
             coalesce((select max(version) from public.note_versions v where v.note_id = n.id), 0) + 1,
             n.title, n.body_md
      from public.notes n
      where n.id = ${id}::uuid and not n.is_locked
    `;
    await tx`
      update public.notes set title = ${title}, body_md = ${bodyMd}, updated_at = now()
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
    await tx`update public.notes set archived_at = now() where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/notes');
}

export async function restoreNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update public.notes set archived_at = null where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
}

export async function deleteNote(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('noteId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from public.notes where id = ${id}::uuid`;
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
      insert into public.note_links (space_id, owner_id, note_id, entity_kind, entity_id)
      select n.space_id, ${user.id}::uuid, n.id, ${kind}::app.entity_kind, ${entityId}::uuid
      from public.notes n
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
      delete from public.note_links
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
      update public.tasks
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    await tx`
      insert into public.activity_log (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
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
      insert into public.people (space_id, owner_id, category_id, display_name)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from public.categories c
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
      update public.people p set
        display_name = ${displayName},
        nickname     = ${nickname},
        pronouns     = ${pronouns},
        notes_md     = ${notesMd},
        category_id  = (
          select c.id from public.categories c
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
    await tx`update public.people set archived_at = now() where id = ${id}::uuid`;
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
      insert into public.person_contacts (space_id, owner_id, person_id, kind, label, value)
      select p.space_id, ${user.id}::uuid, p.id, ${kind}, ${label}, ${value}
      from public.people p where p.id = ${personId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePersonContact(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('contactId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from public.person_contacts where id = ${id}::uuid`;
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
      insert into public.person_dates
        (space_id, owner_id, person_id, kind, label, on_date, year_known)
      select p.space_id, ${user.id}::uuid, p.id, ${kind}, ${label},
             ${onDate}::date, ${yearKnown}
      from public.people p where p.id = ${personId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePersonDate(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('dateId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from public.person_dates where id = ${id}::uuid`;
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
      insert into public.person_links
        (space_id, owner_id, person_a_id, person_b_id, person_b_space)
      select
        case when a.id < b.id then a.space_id else b.space_id end,
        ${user.id}::uuid,
        least(a.id, b.id),
        greatest(a.id, b.id),
        case when a.id < b.id then b.space_id else a.space_id end
      from public.people a, public.people b
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
    await tx`delete from public.person_links where id = ${linkId}::uuid`;
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
      update public.people
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    for (const table of ['person_contacts', 'person_dates']) {
      await tx.unsafe(
        `update public.${table} set space_id = $1 where person_id = $2`,
        [targetSpaceId, id],
      );
    }
    await tx`
      insert into public.activity_log
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

  await asUser(user.id, async (tx) => {
    await tx`
      insert into public.events
        (space_id, owner_id, calendar_id, category_id, title, starts_at, ends_at, all_day)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        -- Both references are resolved against the chosen space rather than
        -- trusted from the form, so a stale picker cannot write across a space
        -- boundary. Falling back to the space's first calendar keeps the
        -- compose bar to one decision.
        coalesce(
          (select c.id from public.calendars c
            where c.id = ${calendarId}::uuid and c.space_id = ${spaceId}::uuid),
          (select c.id from public.calendars c
            where c.space_id = ${spaceId}::uuid and c.is_writable
            order by c.sort_order, c.name limit 1)
        ),
        (select k.id from public.categories k
          where k.id = ${categoryId}::uuid and k.space_id = ${spaceId}::uuid),
        ${title}, ${startsAt}, ${finalEnd}, ${allDay}
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
      update public.events e
      set title = ${title},
          body_md = ${bodyMd},
          location_text = ${locationText},
          starts_at = ${startsAt},
          ends_at = ${finalEnd},
          all_day = ${allDay},
          status = ${['confirmed', 'tentative', 'cancelled'].includes(status) ? status : 'confirmed'},
          category_id = (
            select k.id from public.categories k
            where k.id = ${categoryId}::uuid and k.space_id = e.space_id
          ),
          -- Locally edited, so a later push knows there is something to send.
          is_dirty = (e.external_id is not null)
      where e.id = ${id}::uuid and not e.is_locked
    `;
  });

  revalidatePath('/', 'layout');
}

export async function deleteEvent(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('eventId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from public.events where id = ${id}::uuid`;
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
      update public.events
      set space_id = ${targetSpaceId}::uuid,
          category_id = null,
          place_id = null,
          calendar_id = (
            select c.id from public.calendars c
            where c.space_id = ${targetSpaceId}::uuid and c.is_writable
            order by c.sort_order, c.name limit 1
          )
      where id = ${id}::uuid
    `;
    // Attendees belong to the event and travel with it.
    await tx`
      update public.event_attendees set space_id = ${targetSpaceId}::uuid
      where event_id = ${id}::uuid
    `;
    await tx`
      insert into public.activity_log
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
      update public.notes set space_id = ${targetSpaceId}::uuid
      where id = ${id}::uuid
    `;
    // A link to something in the old space is now a link across a boundary.
    // app.entity_space() resolves under the caller's own privileges, so an
    // item they cannot read resolves to no rows and the link goes.
    await tx`
      delete from public.note_links l
      where l.note_id = ${id}::uuid
        and coalesce(
          (select space_id from app.entity_space(l.entity_kind, l.entity_id)),
          '00000000-0000-0000-0000-000000000000'::uuid
        ) <> ${targetSpaceId}::uuid
    `;
    // Version history is the note's own and travels with it.
    await tx`
      update public.note_versions set space_id = ${targetSpaceId}::uuid
      where note_id = ${id}::uuid
    `;
    await tx`
      insert into public.activity_log
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
      select id, space_id as "spaceId" from public.calendars
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
      update public.calendar_accounts set last_synced_at = now()
      where id = (select account_id from public.calendars where id = ${calendar.id}::uuid)
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
      insert into public.places
        (space_id, owner_id, category_id, name, address_text, postcode)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from public.categories c
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
      update public.places pl set
        name         = ${name},
        address_text = ${addressText},
        postcode     = ${postcode},
        city         = ${city},
        notes_md     = ${notesMd},
        category_id  = (
          select c.id from public.categories c
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
        update public.places set
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
    await tx`update public.places set archived_at = now() where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
  redirect('/places');
}

export async function restorePlace(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('placeId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`update public.places set archived_at = null where id = ${id}::uuid`;
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
      update public.places
      set space_id = ${targetSpaceId}::uuid, category_id = null
      where id = ${id}::uuid
    `;
    // Visits are the place's own history and move with it.
    await tx`
      update public.place_visits set space_id = ${targetSpaceId}::uuid
      where place_id = ${id}::uuid
    `;
    // Anything left behind in another space stops pointing at it, rather than
    // pointing at something its readers can no longer see.
    await tx`
      update public.events set place_id = null
      where place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      update public.travel_legs set from_place_id = null
      where from_place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      update public.travel_legs set to_place_id = null
      where to_place_id = ${id}::uuid and space_id <> ${targetSpaceId}::uuid
    `;
    await tx`
      insert into public.activity_log
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
      insert into public.place_visits
        (space_id, owner_id, place_id, source, arrived_at, departed_at, notes_md)
      select pl.space_id, ${user.id}::uuid, pl.id, 'manual',
             ${arrivedAt}, ${departedAt}, ${notesMd}
      from public.places pl where pl.id = ${placeId}::uuid
    `;
  });

  revalidatePath('/', 'layout');
}

export async function removePlaceVisit(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('visitId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    await tx`delete from public.place_visits where id = ${id}::uuid`;
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
      update public.events e set
        place_id = (
          select pl.id from public.places pl
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
      from public.places
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
      insert into public.travel_legs
        (space_id, owner_id, session_id, from_place_id, to_place_id, event_id, mode,
         depart_at, arrive_at, duration_minutes, distance_metres, estimate_source,
         estimated_at, notes_md)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        -- Resolved against the chosen space rather than trusted: a stale form
        -- could otherwise file a journey under a trip in another space.
        (select t.id from public.travel_sessions t
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
    await tx`delete from public.travel_legs where id = ${id}::uuid`;
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
      from public.travel_legs l
      left join public.places fp on fp.id = l.from_place_id
      left join public.places tp on tp.id = l.to_place_id
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
      update public.travel_legs set
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
      insert into public.travel_legs
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
        select 1 from public.travel_legs l
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
      insert into public.travel_sessions
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
      from public.events where id = ${eventId}::uuid and not is_locked
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
      insert into public.travel_sessions
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

export async function deleteTravelSession(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('sessionId') ?? '');
  if (!id) return;

  await asUser(user.id, async (tx) => {
    // The FK cascades the legs; a leg with no session is not a leg anybody
    // asked for.
    await tx`delete from public.travel_sessions where id = ${id}::uuid`;
  });

  revalidatePath('/', 'layout');
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
  const kind = String(formData.get('kind') ?? '');
  const value = String(formData.get('value') ?? '').trim();

  // Each action kind names its parameter differently; one select plus one
  // free-text box is the whole form, so this is where the two meet.
  const raw: Record<string, unknown> = { kind };
  if (kind === 'task.set_priority') raw.priority = value;
  else if (kind === 'task.set_status') raw.status = value;
  else if (kind === 'task.assign') raw.to = value;
  else if (kind === 'task.defer_days' || kind === 'task.due_in_days') raw.days = Number(value || '0');
  else if (kind === 'notify') raw.message = value;

  const result = await addAction(user.id, id, raw);
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
