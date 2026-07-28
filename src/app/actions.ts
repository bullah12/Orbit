'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { asUser } from '@/lib/db';
import { listSelectableUsers, requireUser, USER_COOKIE } from '@/lib/auth';

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

  revalidatePath('/', 'layout');
}

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const spaceId = String(formData.get('spaceId') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '') || null;
  const dueOn = String(formData.get('dueOn') ?? '') || null;

  if (!title || !spaceId) return;

  await asUser(user.id, async (tx) => {
    // The category is resolved against the chosen space rather than trusted:
    // a stale form could otherwise carry a category from a space the task is
    // not going into.
    await tx`
      insert into public.tasks (space_id, owner_id, category_id, title, due_on, assignee_id)
      values (
        ${spaceId}::uuid, ${user.id}::uuid,
        (select c.id from public.categories c
          where c.id = ${categoryId}::uuid and c.space_id = ${spaceId}::uuid),
        ${title}, ${dueOn}::date, ${user.id}::uuid)
    `;
  });

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
