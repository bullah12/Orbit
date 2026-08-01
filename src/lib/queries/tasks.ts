import 'server-only';
import { asUser, type Tx } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';

/**
 * Smart lists.
 *
 * Derived from columns, never stored. Each one is a `where` fragment plus the
 * order that makes it readable. Adding a list means adding a row in
 * `src/lib/smartlists.ts`, a `clause()` here, and a count below.
 *
 * The list *metadata* moved to `src/lib/smartlists.ts` when the navigation
 * became a Client Component: this module imports `server-only`, so a browser
 * bundle cannot reach it. Re-exported here because a dozen callers already
 * import the names from this path, and the SQL below is still what defines
 * what each list actually contains.
 */
export {
  SMART_LISTS,
  isSmartListKey,
  type SmartListKey,
} from '@/lib/smartlists';

import { SMART_LISTS, isSmartListKey, type SmartListKey } from '@/lib/smartlists';

export type TaskRow = {
  id: string;
  title: string;
  bodyMd: string;
  status: string;
  priority: string;
  visibility: string;
  isLocked: boolean;
  /** The version an optimistic edit is made against. See src/lib/sync/. */
  updatedAt: string;
  dueOn: string | null;
  deferredUntil: string | null;
  completedAt: string | null;
  waitingOn: string | null;
  estimateMinutes: number | null;
  assigneeName: string | null;
  assigneeId: string | null;
  categoryId: string | null;
  isMine: boolean;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  checklistTotal: number;
  checklistDone: number;
  noteCount: number;
};

const OPEN = ['todo', 'doing', 'blocked'];

function clause(tx: Tx, list: SmartListKey, userId: string) {
  switch (list) {
    case 'mine':
      return tx`t.status in ('todo','doing','blocked') and t.assignee_id = ${userId}::uuid`;
    case 'today':
      return tx`t.status in ('todo','doing','blocked')
                and t.due_on is not null and t.due_on <= current_date`;
    case 'overdue':
      return tx`t.status in ('todo','doing','blocked')
                and t.due_on is not null and t.due_on < current_date`;
    case 'upcoming':
      return tx`t.status in ('todo','doing')
                and t.due_on is not null
                and t.due_on > current_date
                and t.due_on <= current_date + 14`;
    case 'inbox':
      return tx`t.status = 'todo' and t.due_on is null and t.deferred_until is null`;
    case 'waiting':
      return tx`t.status = 'blocked'`;
    case 'someday':
      return tx`t.status in ('todo','doing')
                and t.deferred_until is not null and t.deferred_until > now()`;
    case 'done':
      return tx`t.status = 'done' and t.completed_at > now() - interval '30 days'`;
    case 'all':
      return tx`t.status in ('todo','doing','blocked')`;
  }
}

function ordering(tx: Tx, list: SmartListKey) {
  if (list === 'done') return tx`t.completed_at desc`;
  if (list === 'someday') return tx`t.deferred_until asc`;
  if (list === 'inbox') return tx`t.created_at desc`;
  // Dated lists read best by date, then by how loud the task is claiming to be.
  return tx`t.due_on asc nulls last,
            case t.priority when 'urgent' then 0 when 'high' then 1
                            when 'normal' then 2 when 'low' then 3 else 4 end,
            t.title`;
}

export async function listTasks(
  userId: string,
  list: SmartListKey,
  opts: { spaceId?: string | null; limit?: number } = {},
): Promise<TaskRow[]> {
  const { spaceId = null, limit = 200 } = opts;

  return asUser(userId, async (tx) => {
    return tx<TaskRow[]>`
      select
        t.id,
        t.title,
        t.body_md            as "bodyMd",
        t.status::text       as status,
        t.priority::text     as priority,
        t.visibility::text   as visibility,
        t.is_locked          as "isLocked",
        t.due_on             as "dueOn",
        t.deferred_until     as "deferredUntil",
        t.completed_at       as "completedAt",
        t.waiting_on         as "waitingOn",
        t.estimate_minutes   as "estimateMinutes",
        a.display_name       as "assigneeName",
        t.assignee_id        as "assigneeId",
        t.category_id        as "categoryId",
        (t.assignee_id = ${userId}::uuid) as "isMine",
        jsonb_build_object(
          'id', s.id, 'name', s.name, 'shortLabel', s.short_label,
          'colour', s.colour, 'icon', s.icon
        ) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon)
        end as category,
        coalesce(ci.total, 0) as "checklistTotal",
        coalesce(ci.done, 0)  as "checklistDone",
        coalesce(nl.n, 0)     as "noteCount"
      from public.tasks t
      join public.spaces s on s.id = t.space_id
      left join public.categories c on c.id = t.category_id
      left join public.profiles a on a.id = t.assignee_id
      left join lateral (
        select count(*)::int as total, count(*) filter (where done)::int as done
        from public.task_checklist_items i where i.task_id = t.id
      ) ci on true
      left join lateral (
        select count(*)::int as n from public.note_links l
        where l.entity_kind = 'task' and l.entity_id = t.id
      ) nl on true
      where ${clause(tx, list, userId)}
        and t.parent_task_id is null
        ${spaceId ? tx`and t.space_id = ${spaceId}::uuid` : tx``}
      order by ${ordering(tx, list)}
      limit ${limit}
    `;
  });
}

/** Counts for the sidebar. One query, so the nav does not cost eight round trips. */
export async function smartListCounts(
  userId: string,
  spaceId?: string | null,
): Promise<Record<SmartListKey, number>> {
  const rows = await asUser(userId, async (tx) => {
    return tx<{ list: string; n: number }[]>`
      with t as (
        select * from public.tasks
        where parent_task_id is null
          ${spaceId ? tx`and space_id = ${spaceId}::uuid` : tx``}
      )
      select 'mine' as list, count(*)::int as n from t
        where status = any(${OPEN}::app.task_status[]) and assignee_id = ${userId}::uuid
      union all select 'today', count(*)::int from t
        where status = any(${OPEN}::app.task_status[]) and due_on is not null and due_on <= current_date
      union all select 'overdue', count(*)::int from t
        where status = any(${OPEN}::app.task_status[]) and due_on is not null and due_on < current_date
      union all select 'upcoming', count(*)::int from t
        where status in ('todo','doing') and due_on > current_date and due_on <= current_date + 14
      union all select 'inbox', count(*)::int from t
        where status = 'todo' and due_on is null and deferred_until is null
      union all select 'waiting', count(*)::int from t where status = 'blocked'
      union all select 'someday', count(*)::int from t
        where status in ('todo','doing') and deferred_until is not null and deferred_until > now()
      union all select 'done', count(*)::int from t
        where status = 'done' and completed_at > now() - interval '30 days'
      union all select 'all', count(*)::int from t
        where status = any(${OPEN}::app.task_status[])
    `;
  });

  const out = Object.fromEntries(
    Object.keys(SMART_LISTS).map((k) => [k, 0]),
  ) as Record<SmartListKey, number>;
  for (const r of rows) if (isSmartListKey(r.list)) out[r.list] = r.n;
  return out;
}

export async function getTask(userId: string, id: string): Promise<TaskRow | null> {
  const rows = await asUser(userId, async (tx) => {
    return tx<TaskRow[]>`
      select
        t.id, t.title, t.body_md as "bodyMd", t.status::text as status,
        t.updated_at as "updatedAt",
        t.priority::text as priority, t.visibility::text as visibility,
        t.is_locked as "isLocked", t.due_on as "dueOn",
        t.deferred_until as "deferredUntil", t.completed_at as "completedAt",
        t.waiting_on as "waitingOn", t.estimate_minutes as "estimateMinutes",
        a.display_name as "assigneeName",
        t.assignee_id as "assigneeId", t.category_id as "categoryId",
        (t.assignee_id = ${userId}::uuid) as "isMine",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category,
        0 as "checklistTotal", 0 as "checklistDone", 0 as "noteCount"
      from public.tasks t
      join public.spaces s on s.id = t.space_id
      left join public.categories c on c.id = t.category_id
      left join public.profiles a on a.id = t.assignee_id
      where t.id = ${id}::uuid
    `;
  });
  return rows[0] ?? null;
}

export type CategoryOption = { id: string; name: string; colour: string; icon: string };

export async function listCategories(
  userId: string,
  spaceId: string,
): Promise<CategoryOption[]> {
  return asUser(userId, async (tx) => {
    return tx<CategoryOption[]>`
      select id, name, colour, icon from public.categories
      where space_id = ${spaceId}::uuid
      order by sort_order, name
    `;
  });
}

/**
 * Every category the caller can see, grouped by space.
 *
 * The compose bar needs this in one round trip: it offers the categories of
 * whichever space is selected, and the selection changes without a navigation.
 * No `where space_id in (...)` — the policy on `categories` already restricts
 * this to spaces the caller is a member of.
 */
export async function categoriesBySpace(
  userId: string,
): Promise<Record<string, CategoryOption[]>> {
  const rows = await asUser(userId, async (tx) => {
    return tx<(CategoryOption & { spaceId: string })[]>`
      select id, space_id as "spaceId", name, colour, icon
      from public.categories
      order by sort_order, name
    `;
  });

  const out: Record<string, CategoryOption[]> = {};
  for (const r of rows) {
    (out[r.spaceId] ??= []).push({ id: r.id, name: r.name, colour: r.colour, icon: r.icon });
  }
  return out;
}
