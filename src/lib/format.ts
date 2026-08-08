/**
 * UK conventions live here and only here.
 *
 * DD/MM/YYYY, 24-hour clock, Monday-first weeks, Europe/London. If a date is
 * being formatted anywhere else in the codebase, that is the bug.
 */

import { DEFAULT_WEEK_START, weekStartOffset, type WeekStart } from '@/lib/prefs';

export const TZ = 'Europe/London';
export const LOCALE = 'en-GB';

/** Postgres `date` columns arrive as 'YYYY-MM-DD' strings; keep them that way. */
export type DateOnly = string;

const isoDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * The London calendar date an instant falls on.
 *
 * This is the only correct way to ask "which day is this?" in Orbit. Doing it
 * with getDate() would answer in the container's timezone, which is UTC — so a
 * 23:30 BST event would be filed under tomorrow for half the year.
 */
export function londonDayISO(instant: Date | string | number = new Date()): DateOnly {
  const d =
    instant instanceof Date ? instant
    : typeof instant === 'number' ? new Date(instant)
    : new Date(instant);
  return isoDayFmt.format(d);
}

export function todayISO(now: Date = new Date()): DateOnly {
  return londonDayISO(now);
}

/**
 * Midnight London on a given calendar date, as a UTC instant.
 *
 * Used for range queries and week grids. In BST this is 23:00 the previous day
 * in UTC; getting it wrong shifts a whole day view by an hour.
 */
export function londonMidnight(iso: DateOnly): Date {
  const day = iso.slice(0, 10);
  // Both candidate offsets are tried and the one that round-trips is correct.
  // This avoids hard-coding BST's start and end dates, which move.
  for (const offset of ['+01:00', '+00:00']) {
    const candidate = new Date(`${day}T00:00:00${offset}`);
    if (londonDayISO(candidate) === day && londonTimeHHMM(candidate) === '00:00') {
      return candidate;
    }
  }
  // The clocks-forward gap: 01:00 on the last Sunday in March does not exist,
  // so midnight is fine, but a defensive fallback keeps this total.
  return new Date(`${day}T00:00:00Z`);
}

export function londonTimeHHMM(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** What the wall clock in `tz` reads at this instant, minus UTC, in milliseconds. */
function zoneOffsetMs(tz: string, at: Date): number {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some engines render midnight as hour 24; % 24 makes that the same instant.
  const asIfUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return asIfUtc - at.getTime();
}

/**
 * A wall-clock time in a named zone, as a UTC instant.
 *
 * This is what recurrence expansion and ICS import need: "09:00 every Monday"
 * means 09:00 *London*, which is 08:00Z in summer and 09:00Z in winter. Getting
 * this wrong shifts half the year's events by an hour — the single most likely
 * bug in the calendar.
 *
 * Edges, both deliberate:
 *  - The spring gap (01:00–01:59 on the last Sunday in March does not exist)
 *    resolves forward, so 01:30 becomes 02:30 BST.
 *  - The autumn repeat (01:00–01:59 on the last Sunday in October happens
 *    twice) resolves to the *second*, GMT, occurrence.
 */
export function zonedInstant(
  iso: DateOnly,
  hhmmss: string,
  timeZone: string = TZ,
): Date {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
  const [h, mi, s] = `${hhmmss}:00:00`.split(':').map(Number);
  const naive = Date.UTC(y!, mo! - 1, d!, h!, mi ?? 0, s ?? 0);
  // Solve t + offset(t) = naive. One refinement is enough: offsets change by at
  // most an hour and never twice within an hour.
  let guess = naive - zoneOffsetMs(timeZone, new Date(naive));
  guess = naive - zoneOffsetMs(timeZone, new Date(guess));
  return new Date(guess);
}

/**
 * The wall clock a named zone shows at this instant, split into date and time.
 *
 * The inverse of `zonedInstant`. Recurrence expansion needs both directions:
 * it reads the start's local time once, then rebuilds an instant per
 * occurrence, which is what keeps "09:00 every Monday" at 09:00 all year.
 */
export function zonedWallClock(
  instant: Date | string,
  timeZone: string = TZ,
): { date: DateOnly; time: string } {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(d);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hh = String(Number(v('hour')) % 24).padStart(2, '0');
  return {
    date: `${v('year')}-${v('month')}-${v('day')}`,
    time: `${hh}:${v('minute')}:${v('second')}`,
  };
}

/** `zonedInstant` fixed to Europe/London, which is what Orbit means by "09:00". */
export function londonInstant(iso: DateOnly, hhmm: string): Date {
  return zonedInstant(iso, hhmm, TZ);
}

/** Minutes from London midnight on the day this instant falls in. Handles 23- and 25-hour days. */
export function minutesIntoLondonDay(instant: Date | string): number {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const midnight = londonMidnight(londonDayISO(d));
  return Math.round((d.getTime() - midnight.getTime()) / 60_000);
}

/**
 * How long a London calendar day is, in minutes.
 *
 * 1440 on 363 days a year, 1380 on the last Sunday in March and 1500 on the
 * last Sunday in October. The week grid divides by this, so a hard-coded 1440
 * would put every block on those two days in slightly the wrong place.
 */
export function londonDayMinutes(iso: DateOnly): number {
  const start = londonMidnight(iso);
  const end = londonMidnight(addDaysISO(iso, 1));
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

/**
 * Day of the week of a calendar date. 0 = Sunday, UK-irrelevant but JS-native.
 *
 * Anchored at UTC midnight of the *date*, never at an instant, so it cannot
 * drift by one across a BST boundary. `getDay()` would answer in the
 * container's timezone and is never correct here.
 */
export function weekdayOf(iso: DateOnly): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/**
 * The ISO date that week began on.
 *
 * Monday-first by default — UK convention, and every existing caller relies on
 * that, including the natural-language "next Monday" in capture, where the word
 * means Monday whatever anybody's calendar preference says. Only the calendar's
 * two grid functions pass anything else.
 */
export function startOfWeekISO(iso: DateOnly, start: WeekStart = DEFAULT_WEEK_START): DateOnly {
  return addDaysISO(iso, -weekStartOffset(weekdayOf(iso), start));
}

export function addDaysISO(iso: DateOnly, days: number): DateOnly {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Whole days from today. Negative means the past.
 *
 * Both sides are anchored at UTC midnight of a *calendar date*, never at an
 * instant, so the answer cannot drift by one across a BST boundary.
 */
export function daysFromToday(iso: DateOnly, today: DateOnly = todayISO()): number {
  const a = new Date(`${today.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

const dayName = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'long' });
const dayShort = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'short' });
const dmy = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
});
const dMon = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short' });

/** "Today", "Tomorrow", "Friday", "12 Aug", falling back to 12/08/2026. */
export function formatDueDate(iso: DateOnly | null, today: DateOnly = todayISO()): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const delta = daysFromToday(iso, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return dayName.format(d);
  if (delta < -1 && delta > -7) return `${dayShort.format(d)} — ${Math.abs(delta)} days ago`;
  const sameYear = d.getUTCFullYear() === Number(today.slice(0, 4));
  return sameYear ? dMon.format(d) : dmy.format(d);
}

export function formatDate(iso: DateOnly | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : iso;
  return dmy.format(d);
}

const longDateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
});

/**
 * "Saturday 1 August" — a date to be read rather than scanned.
 *
 * Page titles and agenda headings use this; anything in a column keeps
 * `formatDate`, which is DD/MM/YYYY and tabular. Spelling the month out is also
 * the one reliable way past the DD/MM–MM/DD ambiguity, which `formatDate`
 * cannot escape and which matters most at the top of a page.
 *
 * No year: every caller is showing a date within a few weeks of today, and a
 * year on "Saturday 1 August" reads as a document rather than as a day.
 */
export function formatLongDate(iso: DateOnly | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : iso;
  return longDateFmt.format(d);
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 24-hour, London. Always. */
export function formatTime(value: string | Date): string {
  return timeFmt.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ, day: 'numeric', month: 'short',
  }).format(d)}, ${formatTime(d)}`;
}

/** "2 hours ago", "3 days ago". Used for note timestamps, nothing else. */
export function formatRelative(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return formatDate(d);
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** "3 events", "1 event" — the small stuff that makes an interface feel written. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
