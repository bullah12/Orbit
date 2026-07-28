/**
 * iCalendar (RFC 5545) parsing. Local, deterministic, no network.
 *
 * Both `IcsProvider` implementations return raw text and hand it here, so the
 * fixture-backed fake and the real HTTP fetcher cannot disagree about what an
 * .ics file means. That matters because the parser is the only half of ICS
 * import this container can actually execute.
 *
 * Deliberately a subset: VEVENT only. VTODO, VJOURNAL, VALARM and VTIMEZONE
 * bodies are skipped rather than half-understood. A VTIMEZONE definition is
 * ignored in favour of the IANA zone named by TZID — Orbit trusts the platform
 * tz database over whatever a publisher inlined years ago.
 */

import { TZ, zonedInstant } from '@/lib/format';
import { IntegrationError, type ExternalAttendee, type ExternalEvent } from '../types';

type Prop = { name: string; params: Record<string, string>; value: string };

/** RFC 5545 §3.1: a line may be folded, continuation lines begin with a space or tab. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      out.push(raw);
    }
  }
  return out;
}

function parseLine(line: string): Prop | null {
  // Split on the first colon that is not inside a quoted parameter value.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (name ?? '').toUpperCase(), params, value };
}

/** RFC 5545 §3.3.11 text escaping, in reverse. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export type IcsDate = {
  /** ISO instant. */
  instant: string;
  isDate: boolean;
  /** The zone the value was written in, for round-tripping. */
  timezone: string;
};

/**
 * A DTSTART/DTEND/EXDATE value.
 *
 * Four forms, and getting the third wrong is the classic ICS bug:
 *   VALUE=DATE:20260329                  → an all-day date, London midnight
 *   20260329T090000Z                     → an instant, already UTC
 *   TZID=Europe/London:20260329T090000   → wall clock in a named zone
 *   20260329T090000                      → floating; Orbit reads it as London
 */
export function parseIcsDate(prop: Prop, defaultTz: string): IcsDate {
  const v = prop.value.trim();
  const tz = prop.params.TZID ?? defaultTz;

  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return { instant: zonedInstant(iso, '00:00:00', TZ).toISOString(), isDate: true, timezone: TZ };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) {
    throw new IntegrationError('ics', 'malformed', `unparseable date-time "${v}"`);
  }
  const [, y, mo, d, h, mi, s, z] = m;
  const iso = `${y}-${mo}-${d}`;
  const hhmmss = `${h}:${mi}:${s}`;
  if (z === 'Z') {
    return { instant: new Date(`${iso}T${hhmmss}Z`).toISOString(), isDate: false, timezone: 'UTC' };
  }
  return { instant: zonedInstant(iso, hhmmss, tz).toISOString(), isDate: false, timezone: tz };
}

/** RFC 5545 §3.3.6 duration, e.g. PT1H30M, P1D, P1DT2H. Weeks included; months are not legal here. */
export function parseIcsDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) throw new IntegrationError('ics', 'malformed', `unparseable duration "${value}"`);
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    (Number(w ?? 0) * 604800 + Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 +
      Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseAttendee(prop: Prop, isOrganiser: boolean): ExternalAttendee {
  const partstat = (prop.params.PARTSTAT ?? 'NEEDS-ACTION').toUpperCase();
  const response =
    partstat === 'ACCEPTED' ? 'accepted'
    : partstat === 'DECLINED' ? 'declined'
    : partstat === 'TENTATIVE' ? 'tentative'
    : 'needs_action';
  const mailto = /^mailto:(.+)$/i.exec(prop.value.trim());
  return {
    email: mailto ? mailto[1]!.toLowerCase() : null,
    displayName: prop.params.CN ? unescapeText(prop.params.CN) : null,
    response,
    isOrganiser,
  };
}

export type ParsedCalendar = {
  name: string | null;
  timezone: string;
  events: ExternalEvent[];
};

export function parseIcs(text: string): ParsedCalendar {
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l))) {
    throw new IntegrationError('ics', 'malformed', 'no VCALENDAR component');
  }

  let name: string | null = null;
  let calTz = TZ;
  const events: ExternalEvent[] = [];

  // Two-pass: X-WR-TIMEZONE can appear after the first VEVENT in the wild, and
  // it decides how floating times are read, so it is settled before parsing any.
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'X-WR-CALNAME') name = unescapeText(p.value);
    if (p.name === 'X-WR-TIMEZONE' && p.value.trim()) calTz = p.value.trim();
  }

  let current: Prop[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;

    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      current = [];
      depth = 0;
      continue;
    }
    if (current === null) continue;
    // Skip nested components (VALARM) wholesale rather than misreading their
    // TRIGGER as an event property.
    if (p.name === 'BEGIN') { depth += 1; continue; }
    if (p.name === 'END' && depth > 0) { depth -= 1; continue; }
    if (p.name === 'END' && p.value.toUpperCase() === 'VEVENT') {
      const built = buildEvent(current, calTz);
      if (built) events.push(built);
      current = null;
      continue;
    }
    if (depth === 0) current.push(p);
  }

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.externalId.localeCompare(b.externalId));
  return { name, timezone: calTz, events };
}

function buildEvent(props: Prop[], calTz: string): ExternalEvent | null {
  const first = (n: string) => props.find((p) => p.name === n);
  const all = (n: string) => props.filter((p) => p.name === n);

  const dtstart = first('DTSTART');
  const uid = first('UID')?.value.trim();
  // An event with no start is not an event. Skipped rather than defaulted to
  // now, which would scatter junk across the calendar.
  if (!dtstart || !uid) return null;

  const start = parseIcsDate(dtstart, calTz);
  const dtend = first('DTEND');
  const duration = first('DURATION');

  let endInstant: string;
  if (dtend) {
    endInstant = parseIcsDate(dtend, calTz).instant;
  } else if (duration) {
    endInstant = new Date(new Date(start.instant).getTime() + parseIcsDuration(duration.value)).toISOString();
  } else if (start.isDate) {
    // RFC 5545 §3.6.1: a DATE-valued DTSTART with no end lasts one day.
    endInstant = new Date(new Date(start.instant).getTime() + 86_400_000).toISOString();
  } else {
    endInstant = start.instant;
  }

  const statusRaw = (first('STATUS')?.value ?? 'CONFIRMED').toUpperCase();
  const status =
    statusRaw === 'CANCELLED' ? 'cancelled' : statusRaw === 'TENTATIVE' ? 'tentative' : 'confirmed';

  const organiser = first('ORGANIZER');
  const attendees: ExternalAttendee[] = [
    ...(organiser ? [parseAttendee(organiser, true)] : []),
    ...all('ATTENDEE').map((a) => parseAttendee(a, false)),
  ];

  const exdates: string[] = [];
  for (const ex of all('EXDATE')) {
    for (const one of ex.value.split(',')) {
      exdates.push(parseIcsDate({ ...ex, value: one }, calTz).instant);
    }
  }

  return {
    externalId: uid,
    etag: first('SEQUENCE')?.value.trim() ?? null,
    title: unescapeText(first('SUMMARY')?.value ?? ''),
    description: unescapeText(first('DESCRIPTION')?.value ?? ''),
    location: first('LOCATION') ? unescapeText(first('LOCATION')!.value) || null : null,
    startsAt: start.instant,
    endsAt: endInstant,
    allDay: start.isDate,
    timezone: start.timezone,
    status,
    rrule: first('RRULE')?.value.trim() ?? null,
    exdates,
    attendees,
  };
}
