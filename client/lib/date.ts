export const locale = 'en-GB';
export const timeZone = 'Europe/London';

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date: Date, startsOn = 1): Date {
  const result = startOfDay(date);
  const delta = (result.getDay() - startsOn + 7) % 7;
  result.setDate(result.getDate() - delta);
  return result;
}

export function formatLongDate(value: Date | string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone,
  }).format(new Date(value));
}

export function formatShortDate(value: Date | string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(value));
}

export function formatTime(value: Date | string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value));
}
