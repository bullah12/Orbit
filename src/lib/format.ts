/**
 * UK conventions live here and only here.
 *
 * DD/MM/YYYY, 24-hour clock, Monday-first weeks, Europe/London. If a date is
 * being formatted anywhere else in the codebase, that is the bug.
 */

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

function londonTimeHHMM(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/** Monday-first, UK convention. Returns the ISO date of that week's Monday. */
export function startOfWeekISO(iso: DateOnly): DateOnly {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // Monday = 0
  return addDaysISO(iso, -back);
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
