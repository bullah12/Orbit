import 'server-only';
import { listCalendarItems } from './events';
import { listSpaces, type SpaceSummary } from './spaces';
import { categoriesBySpace, type CategoryOption } from './tasks';
import { yesterdaySummary } from './notes';
import { upcomingDates, type UpcomingDate } from './people';
import { listConsents, type ConsentRow } from './ai';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import {
  addDaysISO,
  londonMidnight,
  startOfWeekISO,
  todayISO,
  type DateOnly,
} from '@/lib/format';

/**
 * Now's one query.
 *
 * The whole point of this module is that it is *one* call. The summary strip
 * and the lists beneath it are rendered from a single payload, so the number
 * and the thing it counts cannot disagree — which is the failure mode a
 * per-widget fetch produces the moment one of them is a request behind.
 *
 * The three ranges are the same question at three grains, so they are the same
 * query with a different window. Nothing about the shape of the answer changes.
 */

export const RANGES = ['today', 'week', 'month'] as const;
export type Range = (typeof RANGES)[number];

export function isRange(v: string | undefined): v is Range {
  return v != null && (RANGES as readonly string[]).includes(v);
}

/** A range from the query string is user input; anything else is `today`. */
export function normaliseRange(v: string | undefined): Range {
  return isRange(v) ? v : 'today';
}

export type SummaryEvent = {
  id: string;
  key: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  title: string;
  categoryColour: string;
  categoryName: string | null;
  space: SpaceRef;
  spaceName: string | null;
  note: string | null;
  anonymous: boolean;
};

export type SummaryDue = {
  id: string;
  title: string;
  done: boolean;
  state: 'due' | 'overdue';
  categoryColour: string;
  categoryName: string;
  space: SpaceRef;
  locked: boolean;
  /** Set by the optimistic layer on the client, never by this query. */
  pending: boolean;
};

export type Summary = {
  range: Range;
  /** The window actually queried, so the header can name it without recomputing. */
  from: DateOnly;
  to: DateOnly;
  counts: { events: number; tasks: number; overdue: number };
  perPerson: { personId: string; name: string; colour: string; count: number }[];
  events: SummaryEvent[];
  due: SummaryDue[];

  /*
   * Everything else Now draws, in the same payload.
   *
   * The rule is one fetch per page rather than one per widget, and the reason
   * is that a count and the list under it must not be able to disagree. That
   * argument does not stop at the summary strip: the compose bar's spaces, the
   * birthdays and the review offer are all part of the same page and all
   * resolved here, so Now still awaits exactly once.
   */
  spaces: SpaceSummary[];
  categories: Record<string, CategoryOption[]>;
  upcoming: UpcomingDate[];
  yesterday: { eventCount: number; noteCount: number };
  reviews: ConsentRow[];
};

/** The window a range covers, inclusive of `from`, exclusive of the day after `to`. */
export function rangeWindow(range: Range, today: DateOnly = todayISO()): {
  from: DateOnly;
  to: DateOnly;
} {
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') {
    const from = startOfWeekISO(today);
    return { from, to: addDaysISO(from, 6) };
  }
  // A month grain means the calendar month the day sits in, not 30 days from
  // now: "what does this month look like" is a question about the month.
  const first = `${today.slice(0, 7)}-01`;
  const nextMonth = new Date(`${first}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const to = addDaysISO(nextMonth.toISOString().slice(0, 10) as DateOnly, -1);
  return { from: first, to };
}

export async function summary(userId: string, range: Range): Promise<Summary> {
  const today = todayISO();
  const { from, to } = rangeWindow(range, today);

  // The window is half-open in instants: midnight on `from` up to midnight on
  // the day after `to`, so an event at 23:59 on the last day is inside it.
  const fromInstant = londonMidnight(from);
  const toInstant = londonMidnight(addDaysISO(to, 1));

  const [items, due, spaces, categories, upcoming, yesterday, consents] = await Promise.all([
    listCalendarItems(userId, fromInstant, toInstant),
    dueInWindow(userId, from, to, today),
    listSpaces(userId),
    categoriesBySpace(userId),
    upcomingDates(userId, 21),
    yesterdaySummary(userId),
    listConsents(userId),
  ]);

  const events: SummaryEvent[] = items.map((item) =>
    item.isBusy
      ? {
          id: item.key,
          key: item.key,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.allDay,
          // A busy block has no title by construction, and inventing one here
          // would be this layer leaking what the policy withheld.
          title: 'Busy',
          categoryColour: 'slate',
          categoryName: null,
          space: item.space,
          spaceName: item.space.name,
          note: null,
          anonymous: true,
        }
      : {
          id: item.id,
          key: item.key,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.allDay,
          title: item.title || 'Untitled',
          categoryColour: item.category?.colour ?? item.space.colour,
          categoryName: item.category?.name ?? null,
          space: item.space,
          spaceName: item.space.name,
          note: item.placeName ?? item.locationText,
          anonymous: false,
        },
  );

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    range,
    from,
    to,
    counts: {
      events: events.length,
      tasks: due.length,
      overdue: due.filter((d) => d.state === 'overdue').length,
    },
    perPerson: perPerson(events),
    events,
    due,
    spaces,
    categories,
    upcoming,
    yesterday,
    // Consent is per feature *and* per space, so a weekly review is offered
    // once per space rather than once.
    reviews: consents.filter((c) => c.feature === 'weekly_review'),
  };
}

/**
 * Open tasks due inside the window, plus anything already overdue.
 *
 * Overdue work does not belong to a range — a task that was due on Tuesday is
 * still the answer to "what do I need to do today" on Thursday. It is carried
 * into every range and marked, rather than filtered out by a date test that
 * would quietly make the overdue count zero on a month view.
 */
async function dueInWindow(
  userId: string,
  from: DateOnly,
  to: DateOnly,
  today: DateOnly,
): Promise<SummaryDue[]> {
  const rows = await asUser(userId, async (tx) => {
    return tx<
      {
        id: string;
        title: string;
        status: string;
        dueOn: string | null;
        isLocked: boolean;
        space: SpaceRef;
        category: { name: string; colour: string } | null;
      }[]
    >`
      select
        t.id,
        t.title,
        t.status::text as status,
        t.due_on       as "dueOn",
        t.is_locked    as "isLocked",
        jsonb_build_object(
          'id', s.id, 'name', s.name, 'shortLabel', s.short_label,
          'colour', s.colour, 'icon', s.icon
        ) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour)
        end as category
      from public.tasks t
      join public.spaces s on s.id = t.space_id
      left join public.categories c on c.id = t.category_id
      where t.status in ('todo','doing','blocked')
        and t.parent_task_id is null
        and t.due_on is not null
        and (t.due_on <= ${to}::date)
        and (t.due_on >= ${from}::date or t.due_on < ${today}::date)
      order by t.due_on asc, t.priority desc, t.title asc
      limit 200
    `;
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    done: false,
    state: r.dueOn != null && r.dueOn < today ? 'overdue' : 'due',
    categoryColour: r.category?.colour ?? r.space.colour,
    categoryName: r.category?.name ?? r.space.name,
    space: r.space,
    locked: r.isLocked,
    pending: false,
  }));
}

/**
 * Who the range belongs to, by space.
 *
 * Colour in Orbit means "which person / which space", so the aside that says
 * "Priya has 2" is counted off the same events the agenda draws — not a second
 * query that could return a different two.
 */
function perPerson(events: SummaryEvent[]): Summary['perPerson'] {
  const byId = new Map<string, { personId: string; name: string; colour: string; count: number }>();
  for (const e of events) {
    const existing = byId.get(e.space.id);
    if (existing) existing.count += 1;
    else
      byId.set(e.space.id, {
        personId: e.space.id,
        name: e.space.shortLabel || e.space.name,
        colour: e.space.colour,
        count: 1,
      });
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
