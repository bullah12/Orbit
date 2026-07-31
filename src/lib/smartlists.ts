/**
 * Smart-list membership, as pure functions.
 *
 * The SQL in src/lib/queries/tasks.ts is the source of truth for *listing* —
 * asking Postgres to filter 80,000 rows is not something we want to do in
 * JavaScript. But three things need the same rule without a round trip:
 *
 *   - the task detail page, which says which lists a task appears in
 *   - optimistic local writes (Phase 6): after you tick a box, the sidebar
 *     count has to change before the server answers
 *   - the test suite, because "is an overdue task also in Today?" is exactly
 *     the kind of question that gets answered differently in two places
 *
 * So the rules live here once, as data, and `tests/smartlists.test.ts` pins
 * them against the SQL's behaviour. If you change a `clause()` in queries/tasks.ts
 * you must change the matching predicate here, and the test names tell you so.
 */

import { todayISO, type DateOnly } from './format';

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'dropped';

/**
 * Smart lists.
 *
 * Derived from columns, never stored. Each one is a `where` fragment in
 * queries/tasks.ts plus the order that makes it readable; what lives here is
 * the name and the icon, which the nav needs and which must not drag a
 * server-only module into the client bundle to get.
 */
export const SMART_LISTS = {
  today:    { label: 'Today',    icon: 'check',  blurb: 'Due today, or overdue and still open' },
  overdue:  { label: 'Overdue',  icon: 'clock',  blurb: 'Past their date and still open' },
  upcoming: { label: 'Upcoming', icon: 'calendar', blurb: 'The next fortnight' },
  inbox:    { label: 'Inbox',    icon: 'inbox',  blurb: 'No date, no decision yet' },
  waiting:  { label: 'Waiting',  icon: 'pause',  blurb: 'Blocked on somebody else' },
  someday:  { label: 'Someday',  icon: 'moon',   blurb: 'Deliberately deferred' },
  done:     { label: 'Done',     icon: 'check',  blurb: 'Completed recently' },
  all:      { label: 'All open', icon: 'circle', blurb: 'Everything still open' },
} as const;

export type SmartListKey = keyof typeof SMART_LISTS;

export function isSmartListKey(v: string): v is SmartListKey {
  return Object.prototype.hasOwnProperty.call(SMART_LISTS, v);
}

/** The subset of a task the smart lists actually read. */
export type SmartListTask = {
  status: TaskStatus;
  dueOn: DateOnly | null;
  deferredUntil: string | null;
  completedAt: string | null;
  parentTaskId?: string | null;
};

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked'];

export function isOpen(status: TaskStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export type Clock = { today: DateOnly; now: Date };

export function clockNow(now: Date = new Date()): Clock {
  return { today: todayISO(now), now };
}

type Predicate = (t: SmartListTask, c: Clock) => boolean;

/**
 * One predicate per smart list, mirroring `clause()` in queries/tasks.ts.
 * Deliberately verbose: each line should be readable next to its SQL.
 */
export const SMART_LIST_PREDICATES: Record<string, Predicate> = {
  // status in (todo,doing,blocked) and due_on is not null and due_on <= current_date
  today: (t, c) => isOpen(t.status) && t.dueOn != null && t.dueOn <= c.today,

  // ...and due_on < current_date
  overdue: (t, c) => isOpen(t.status) && t.dueOn != null && t.dueOn < c.today,

  // status in (todo,doing) and due_on > current_date and due_on <= current_date + 14
  upcoming: (t, c) =>
    (t.status === 'todo' || t.status === 'doing') &&
    t.dueOn != null &&
    t.dueOn > c.today &&
    t.dueOn <= addDays(c.today, 14),

  // status = todo and due_on is null and deferred_until is null
  inbox: (t) => t.status === 'todo' && t.dueOn == null && t.deferredUntil == null,

  // status = blocked
  waiting: (t) => t.status === 'blocked',

  // status in (todo,doing) and deferred_until is not null and deferred_until > now()
  someday: (t, c) =>
    (t.status === 'todo' || t.status === 'doing') &&
    t.deferredUntil != null &&
    new Date(t.deferredUntil).getTime() > c.now.getTime(),

  // status = done and completed_at > now() - interval '30 days'
  done: (t, c) =>
    t.status === 'done' &&
    t.completedAt != null &&
    new Date(t.completedAt).getTime() > c.now.getTime() - 30 * 86_400_000,

  // status in (todo,doing,blocked)
  all: (t) => isOpen(t.status),
};

function addDays(iso: DateOnly, days: number): DateOnly {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inSmartList(list: string, task: SmartListTask, clock: Clock): boolean {
  const p = SMART_LIST_PREDICATES[list];
  if (!p) return false;
  // Sub-tasks never appear in a list of their own; they belong to their parent.
  if (task.parentTaskId) return false;
  return p(task, clock);
}

/** Every list this task currently belongs to, in a stable order. */
export function smartListsFor(task: SmartListTask, clock: Clock = clockNow()): string[] {
  return Object.keys(SMART_LIST_PREDICATES).filter((k) => inSmartList(k, task, clock));
}

/**
 * Counts derived locally. Used for the optimistic path only — the server's
 * counts always win when they arrive.
 */
export function countByList(
  tasks: SmartListTask[],
  clock: Clock = clockNow(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(SMART_LIST_PREDICATES)) out[key] = 0;
  for (const t of tasks) {
    for (const key of Object.keys(SMART_LIST_PREDICATES)) {
      if (inSmartList(key, t, clock)) out[key] += 1;
    }
  }
  return out;
}
