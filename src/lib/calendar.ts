/**
 * Calendar geometry. Pure, no database, no React — so the awkward parts are
 * testable without rendering anything.
 *
 * Two things here are easy to get wrong and are therefore done once:
 *
 *  1. **A day is not always 1440 minutes.** Positions are fractions of
 *     `londonDayMinutes(day)`, so a block on 25 October sits where it belongs
 *     in a 25-hour day rather than an hour off.
 *  2. **An event belongs to every day it touches.** A 23:00–01:00 event is on
 *     both days, clipped to each. Filtering by start date alone loses the
 *     second half, which is the bug that makes a Monday morning look empty.
 *
 * Everything takes and returns London calendar dates ('YYYY-MM-DD') and ISO
 * instants. Nothing here constructs a Date from local parts.
 */

import {
  addDaysISO,
  londonDayISO,
  londonDayMinutes,
  londonMidnight,
  minutesIntoLondonDay,
  startOfWeekISO,
  type DateOnly,
} from '@/lib/format';

export const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function isCalendarView(v: string): v is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(v);
}

/** The minimum an event must occupy so a 15-minute block is still clickable. */
export const MIN_BLOCK_MINUTES = 20;

export type TimedItem = {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/** Monday-first, UK convention (decision: UK conventions throughout). */
export function weekDays(anchor: DateOnly): DateOnly[] {
  const monday = startOfWeekISO(anchor);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
}

/**
 * Six Monday-first weeks covering the anchor's month.
 *
 * Always six rows, never five: a grid that changes height as you page through
 * the year makes the whole view jump, and a dense interface should sit still.
 */
export function monthGrid(anchor: DateOnly): DateOnly[][] {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = startOfWeekISO(first);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDaysISO(start, w * 7 + d)),
  );
}

export function monthOf(iso: DateOnly): string {
  return iso.slice(0, 7);
}

/** The instants a view covers, as [from, to). What the query asks Postgres for. */
export function viewRange(view: CalendarView, anchor: DateOnly): { from: Date; to: Date } {
  if (view === 'day') {
    return { from: londonMidnight(anchor), to: londonMidnight(addDaysISO(anchor, 1)) };
  }
  if (view === 'week') {
    const days = weekDays(anchor);
    return { from: londonMidnight(days[0]!), to: londonMidnight(addDaysISO(days[6]!, 1)) };
  }
  const grid = monthGrid(anchor);
  return {
    from: londonMidnight(grid[0]![0]!),
    to: londonMidnight(addDaysISO(grid[5]![6]!, 1)),
  };
}

/** Where the previous/next controls go. Month steps by calendar month, not by 28 days. */
export function stepAnchor(view: CalendarView, anchor: DateOnly, direction: -1 | 1): DateOnly {
  if (view === 'day') return addDaysISO(anchor, direction);
  if (view === 'week') return addDaysISO(anchor, 7 * direction);
  const [y, m] = anchor.slice(0, 7).split('-').map(Number);
  const total = y! * 12 + (m! - 1) + direction;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  // The 1st always exists, so a month step never lands on a date that does not.
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

// ---------------------------------------------------------------------------
// Placing an item on a day
// ---------------------------------------------------------------------------

export type DaySpan = {
  /** Minutes from London midnight on this day, clipped to the day. */
  startMinute: number;
  endMinute: number;
  /** True when the item began before this day started. */
  continuesFrom: boolean;
  /** True when it runs past the end of this day. */
  continuesTo: boolean;
};

/**
 * How much of `item` falls on `day`, or null if none of it does.
 *
 * A zero-length event still occupies a moment, so it is kept; an event that
 * merely *touches* the end of a day (ends exactly at midnight) is not, because
 * it would otherwise draw a sliver at the top of the next day.
 */
export function daySpan(item: TimedItem, day: DateOnly): DaySpan | null {
  const dayStart = londonMidnight(day).getTime();
  const dayEnd = londonMidnight(addDaysISO(day, 1)).getTime();
  const start = Date.parse(item.startsAt);
  const end = Math.max(start, Date.parse(item.endsAt));

  if (start >= dayEnd) return null;
  if (end < dayStart) return null;
  // Ending exactly as the day begins means it belongs to yesterday — unless it
  // is a zero-length moment *at* midnight, which belongs to today.
  if (end === dayStart && start !== dayStart) return null;

  const clippedStart = Math.max(start, dayStart);
  const clippedEnd = Math.min(end, dayEnd);
  return {
    startMinute: Math.round((clippedStart - dayStart) / 60_000),
    endMinute: Math.round((clippedEnd - dayStart) / 60_000),
    continuesFrom: start < dayStart,
    continuesTo: end > dayEnd,
  };
}

/** Does this item occupy the whole of `day`, one way or another? */
export function isAllDayOn(item: TimedItem, day: DateOnly): boolean {
  if (item.allDay) return true;
  const span = daySpan(item, day);
  if (!span) return false;
  return span.startMinute === 0 && span.endMinute >= londonDayMinutes(day);
}

// ---------------------------------------------------------------------------
// Column packing
// ---------------------------------------------------------------------------

export type Placed<T> = {
  item: T;
  span: DaySpan;
  /** Fractions of the day, 0–1, ready to become CSS percentages. */
  top: number;
  height: number;
  /** Which of `columns` side-by-side lanes this block sits in. */
  column: number;
  columns: number;
};

/**
 * Lay out one day's timed items into side-by-side lanes.
 *
 * Overlapping events form a cluster and share the width; two events that do not
 * overlap each other sit in the same lane even if a third overlaps both. The
 * lane count is per cluster rather than per day, so one busy morning does not
 * squeeze the whole day into slivers.
 *
 * A very short event is drawn at MIN_BLOCK_MINUTES so it stays clickable, but
 * the *overlap* maths uses its true end — otherwise two adjacent 15-minute
 * events would be pushed into separate lanes purely by their minimum height.
 */
export function layoutDay<T extends TimedItem>(items: T[], day: DateOnly): Placed<T>[] {
  const dayLength = londonDayMinutes(day);

  const spans = items
    .map((item) => ({ item, span: daySpan(item, day) }))
    .filter((x): x is { item: T; span: DaySpan } => x.span !== null)
    .sort(
      (a, b) =>
        a.span.startMinute - b.span.startMinute ||
        b.span.endMinute - a.span.endMinute ||
        a.item.startsAt.localeCompare(b.item.startsAt),
    );

  const out: Placed<T>[] = [];

  // Walk in order, breaking into clusters wherever nothing is still running.
  let cluster: { item: T; span: DaySpan }[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const lanes: number[] = []; // lane index → minute it becomes free
    const assigned = cluster.map(({ item, span }) => {
      let lane = lanes.findIndex((freeAt) => freeAt <= span.startMinute);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(span.endMinute);
      } else {
        lanes[lane] = span.endMinute;
      }
      return { item, span, lane };
    });
    for (const { item, span, lane } of assigned) {
      const drawnEnd = Math.max(span.endMinute, span.startMinute + MIN_BLOCK_MINUTES);
      out.push({
        item,
        span,
        top: span.startMinute / dayLength,
        height: Math.min(1 - span.startMinute / dayLength, (drawnEnd - span.startMinute) / dayLength),
        column: lane,
        columns: lanes.length,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of spans) {
    if (cluster.length > 0 && entry.span.startMinute >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.span.endMinute);
  }
  flush();

  return out;
}

/**
 * Split a day's items into the all-day banner and the timed grid.
 *
 * All-day and midnight-to-midnight items are not drawn in the grid: an event
 * that fills the column tells you nothing and hides everything behind it.
 */
export function splitDay<T extends TimedItem>(items: T[], day: DateOnly): { allDay: T[]; timed: T[] } {
  const allDay: T[] = [];
  const timed: T[] = [];
  for (const item of items) {
    if (daySpan(item, day) === null) continue;
    (isAllDayOn(item, day) ? allDay : timed).push(item);
  }
  return { allDay, timed };
}

/** Group items by the London day they touch, for the month grid. */
export function byDay<T extends TimedItem>(items: T[], days: DateOnly[]): Map<DateOnly, T[]> {
  const map = new Map<DateOnly, T[]>(days.map((d) => [d, []]));
  for (const item of items) {
    for (const day of days) {
      if (daySpan(item, day) !== null) map.get(day)!.push(item);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
  }
  return map;
}

/** Hour lines for the grid. Labelled 24-hour, UK convention. */
export function hourLines(day: DateOnly): { label: string; top: number }[] {
  const dayLength = londonDayMinutes(day);
  const start = londonMidnight(day).getTime();
  const out: { label: string; top: number }[] = [];
  for (let m = 60; m < dayLength; m += 60) {
    const at = new Date(start + m * 60_000);
    // Read the label back off the instant, so the repeated hour on the 25-hour
    // day is labelled 01:00 twice rather than counted as 25 hours.
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at);
    out.push({ label, top: m / dayLength });
  }
  return out;
}

/**
 * The minute a view should open at: 07:00, or the first event if earlier, or
 * **now** when the day being shown is today.
 *
 * Now wins because it is what somebody opening a calendar at two in the
 * afternoon is looking for. Without it the grid opened at 00:00 and roughly
 * seven empty night hours filled the viewport before the first real event —
 * on a phone, the entire screen.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the behaviour on
 * either side of a clock change is a test rather than a thing you have to wait
 * until October to find out about.
 */
export function scrollToMinute(
  items: TimedItem[],
  day: DateOnly,
  now?: Date | null,
): number {
  if (now && londonDayISO(now) === day) {
    return Math.max(0, minutesIntoLondonDay(now) - 30);
  }

  let earliest = 7 * 60;
  for (const item of items) {
    const span = daySpan(item, day);
    if (span && !isAllDayOn(item, day)) earliest = Math.min(earliest, span.startMinute);
  }
  return Math.max(0, earliest - 30);
}

/** Today, as the calendar means it. */
export function todayFor(now: Date = new Date()): DateOnly {
  return londonDayISO(now);
}
