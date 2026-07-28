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

function londonToday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00Z`);
}

export function todayISO(): DateOnly {
  return londonToday().toISOString().slice(0, 10);
}

export function addDaysISO(iso: DateOnly, days: number): DateOnly {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today. Negative means the past. */
export function daysFromToday(iso: DateOnly): number {
  const a = new Date(`${todayISO()}T00:00:00Z`).getTime();
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
export function formatDueDate(iso: DateOnly | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const delta = daysFromToday(iso);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return dayName.format(d);
  if (delta < -1 && delta > -7) return `${dayShort.format(d)} — ${Math.abs(delta)} days ago`;
  const sameYear = d.getUTCFullYear() === new Date(`${todayISO()}T00:00:00Z`).getUTCFullYear();
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
