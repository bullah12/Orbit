import type { Event } from '../data/types';

export type EventOccurrence = Event & { occurrenceStart: string; occurrenceEnd: string };

function parts(rrule: string): Record<string, string> {
  return Object.fromEntries(rrule.split(';').map((part) => part.split('=', 2) as [string, string]));
}

export function expandEvents(events: Event[], from: Date, to: Date): EventOccurrence[] {
  const output: EventOccurrence[] = [];
  for (const event of events) {
    const rule = event.recurrence_rules;
    if (!rule) {
      if (new Date(event.starts_at) < to && new Date(event.ends_at) > from) output.push({ ...event, occurrenceStart: event.starts_at, occurrenceEnd: event.ends_at });
      continue;
    }
    const config = parts(rule.rrule); const interval = Math.max(1, Number(config.INTERVAL ?? 1)); const count = config.COUNT ? Number(config.COUNT) : 400;
    const until = rule.until ? new Date(rule.until) : to; const excluded = new Set((rule.exdates ?? []).map((value) => new Date(value).toISOString()));
    let start = new Date(event.starts_at); const duration = new Date(event.ends_at).getTime() - start.getTime();
    for (let index = 0; index < count && index < 400 && start < to && start <= until; index += 1) {
      const iso = start.toISOString();
      if (start >= from && !excluded.has(iso)) output.push({ ...event, occurrenceStart: iso, occurrenceEnd: new Date(start.getTime() + duration).toISOString() });
      const next = new Date(start);
      if (config.FREQ === 'DAILY') next.setDate(next.getDate() + interval);
      else if (config.FREQ === 'WEEKLY') next.setDate(next.getDate() + (7 * interval));
      else if (config.FREQ === 'MONTHLY') next.setMonth(next.getMonth() + interval);
      else if (config.FREQ === 'YEARLY') next.setFullYear(next.getFullYear() + interval);
      else break;
      start = next;
    }
  }
  return output.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
}
