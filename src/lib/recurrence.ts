/**
 * RFC 5545 recurrence: parsing an RRULE, and expanding one into occurrences.
 *
 * This is a bug farm, so it is a pure module with no database and no I/O, and
 * the tests are written against the two things that actually break it:
 *
 *  1. **Month ends.** "The 31st of every month" does not mean "the 30th in
 *     April". RFC 5545 says an invalid date is *skipped*, not clamped. Clamping
 *     is the intuitive implementation and it is wrong: it silently invents an
 *     event on a day nobody chose.
 *  2. **The clocks.** A repeat is a rule about the *wall clock*, so 09:00 every
 *     Monday is 09:00 in March and 09:00 in April even though the UTC instant
 *     moves by an hour between them. Expansion therefore happens on local dates
 *     and times, and an instant is rebuilt per occurrence.
 *
 * Supported: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, COUNT, UNTIL, BYDAY
 * (with an optional ordinal, e.g. 3TU or -1FR), BYMONTHDAY (negative counts
 * back from the month end), BYMONTH, WKST. Not supported, and rejected rather
 * than ignored: BYSETPOS, BYYEARDAY, BYWEEKNO, BYHOUR/BYMINUTE/BYSECOND.
 * Silently dropping one of those would produce a plausible wrong calendar.
 */

import { addDaysISO, TZ, zonedInstant, zonedWallClock, type DateOnly } from '@/lib/format';

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type ByDay = { weekday: Weekday; nth: number | null };

export type Rrule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  /** ISO instant, inclusive. */
  until: string | null;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  wkst: Weekday;
};

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

const UNSUPPORTED = ['BYSETPOS', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND'];

export function parseRrule(input: string): Rrule {
  const body = input.trim().replace(/^RRULE:/i, '');
  const parts: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    if (eq < 0) throw new RecurrenceError(`malformed RRULE part "${chunk}"`);
    parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1).toUpperCase();
  }

  for (const key of UNSUPPORTED) {
    if (parts[key]) throw new RecurrenceError(`${key} is not supported`);
  }

  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    throw new RecurrenceError(`unsupported FREQ "${parts.FREQ ?? '(missing)'}"`);
  }

  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new RecurrenceError(`INTERVAL must be a positive integer, got "${parts.INTERVAL}"`);
  }

  const count = parts.COUNT ? Number(parts.COUNT) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) {
    throw new RecurrenceError(`COUNT must be a positive integer, got "${parts.COUNT}"`);
  }
  if (count !== null && parts.UNTIL) {
    throw new RecurrenceError('COUNT and UNTIL are mutually exclusive');
  }

  return {
    freq,
    interval,
    count,
    until: parts.UNTIL ? parseUntil(parts.UNTIL) : null,
    byDay: parts.BYDAY ? parts.BYDAY.split(',').map(parseByDay) : [],
    byMonthDay: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : [],
    byMonth: parts.BYMONTH ? parts.BYMONTH.split(',').map(Number) : [],
    wkst: (parts.WKST as Weekday) ?? 'MO',
  };
}

function parseUntil(v: string): string {
  if (/^\d{8}$/.test(v)) {
    // A DATE-valued UNTIL is inclusive of that whole day.
    return zonedInstant(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, '23:59:59', TZ).toISOString();
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) throw new RecurrenceError(`unparseable UNTIL "${v}"`);
  const [, y, mo, d, h, mi, s, z] = m;
  const iso = `${y}-${mo}-${d}`;
  const hhmmss = `${h}:${mi}:${s}`;
  return z === 'Z'
    ? new Date(`${iso}T${hhmmss}Z`).toISOString()
    : zonedInstant(iso, hhmmss, TZ).toISOString();
}

function parseByDay(v: string): ByDay {
  const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(v.trim());
  if (!m) throw new RecurrenceError(`unparseable BYDAY "${v}"`);
  const nth = m[1] ? Number(m[1]) : null;
  if (nth === 0) throw new RecurrenceError('BYDAY ordinal 0 is meaningless');
  return { weekday: m[2] as Weekday, nth };
}

/** Serialise back to an RRULE line — what gets stored in `recurrence_rules.rrule`. */
export function formatRrule(r: Rrule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval !== 1) out.push(`INTERVAL=${r.interval}`);
  if (r.byMonth.length) out.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.byMonthDay.length) out.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byDay.length) {
    out.push(`BYDAY=${r.byDay.map((d) => `${d.nth ?? ''}${d.weekday}`).join(',')}`);
  }
  if (r.count != null) out.push(`COUNT=${r.count}`);
  if (r.until) out.push(`UNTIL=${r.until.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  if (r.wkst !== 'MO') out.push(`WKST=${r.wkst}`);
  return out.join(';');
}

// ---------------------------------------------------------------------------
// Date helpers. All on 'YYYY-MM-DD' strings, so nothing here can pick up the
// container's timezone the way a Date would.
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function weekdayOf(iso: DateOnly): Weekday {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(dow + 6) % 7]!;
}

function ymd(iso: DateOnly): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y!, m!, d!];
}

function makeISO(y: number, m: number, d: number): DateOnly {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Valid dates only: 31 April does not exist, and RFC 5545 skips it rather than moving it. */
function safeISO(y: number, m: number, d: number): DateOnly | null {
  const month = ((m - 1) % 12 + 12) % 12 + 1;
  const year = y + Math.floor((m - 1) / 12);
  const day = d < 0 ? daysInMonth(year, month) + 1 + d : d;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return makeISO(year, month, day);
}

/** The start of the week containing `iso`, honouring WKST. */
function weekStart(iso: DateOnly, wkst: Weekday): DateOnly {
  const idx = WEEKDAYS.indexOf(weekdayOf(iso));
  const start = WEEKDAYS.indexOf(wkst);
  return addDaysISO(iso, -(((idx - start) % 7 + 7) % 7));
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

export type Occurrence = {
  /** ISO instant. */
  startsAt: string;
  endsAt: string;
  /** The London calendar date the occurrence starts on. Handy for grouping. */
  onDate: DateOnly;
  /** 1-based position in the series, counted from DTSTART — COUNT and UNTIL are absolute. */
  index: number;
};

export type ExpandOptions = {
  rrule: string | Rrule;
  /** ISO instant of the first occurrence. */
  dtstart: string;
  /** Window start, ISO instant, inclusive. */
  from: string;
  /** Window end, ISO instant, exclusive. */
  to: string;
  /** Length of each occurrence. Defaults to the duration implied by `dtend`, or zero. */
  dtend?: string;
  timezone?: string;
  /** Instants (or all-day start instants) the series skips. */
  exdates?: string[];
  /** Safety valve. Expansion is bounded by the window, but a pathological rule still needs a stop. */
  maxOccurrences?: number;
};

/**
 * Every occurrence of a rule that overlaps [from, to).
 *
 * Iteration starts at DTSTART even when the window is years later, because
 * COUNT and UNTIL are properties of the series and not of the view — asking
 * "what is in November?" must not turn a COUNT=10 series into ten November
 * events. The candidate walk is capped so a rule that never produces anything
 * cannot spin.
 */
export function expandRecurrence(opts: ExpandOptions): Occurrence[] {
  const rule = typeof opts.rrule === 'string' ? parseRrule(opts.rrule) : opts.rrule;
  const tz = opts.timezone ?? TZ;
  const maxOccurrences = opts.maxOccurrences ?? 1000;

  const startWall = zonedWallClock(opts.dtstart, tz);
  const durationMs = opts.dtend
    ? Math.max(0, Date.parse(opts.dtend) - Date.parse(opts.dtstart))
    : 0;

  const fromMs = Date.parse(opts.from);
  const toMs = Date.parse(opts.to);
  const untilMs = rule.until ? Date.parse(rule.until) : Infinity;
  const exdates = new Set((opts.exdates ?? []).map((e) => new Date(e).toISOString()));

  const out: Occurrence[] = [];
  let emitted = 0; // counts toward COUNT — every occurrence, in or out of window
  let periods = 0;
  const MAX_PERIODS = 4000;

  let cursor = periodStart(startWall.date, rule);

  while (periods < MAX_PERIODS) {
    periods += 1;
    const dates = datesInPeriod(cursor, rule, startWall.date);

    for (const date of dates) {
      if (date < startWall.date) continue;
      const instant = zonedInstant(date, startWall.time, tz);
      const startMs = instant.getTime();
      if (startMs > untilMs) return out;

      emitted += 1;
      if (rule.count != null && emitted > rule.count) return out;

      const endMs = startMs + durationMs;
      if (endMs > fromMs && startMs < toMs && !exdates.has(instant.toISOString())) {
        out.push({
          startsAt: instant.toISOString(),
          endsAt: new Date(endMs).toISOString(),
          onDate: date,
          index: emitted,
        });
        if (out.length >= maxOccurrences) return out;
      }

      // Past the window with no COUNT or UNTIL left to honour: stop. (With a
      // COUNT we still stop, because occurrences only move forwards.)
      if (startMs >= toMs) return out;
    }

    cursor = advance(cursor, rule);
    // Periods only move forwards and every occurrence in a period starts on or
    // after that period's first day, so once the period itself begins after the
    // window there is nothing left to find.
    if (zonedInstant(cursor, startWall.time, tz).getTime() >= toMs) return out;
  }
  return out;
}

/** The first date of the period (day / week / month / year) that DTSTART falls in. */
function periodStart(dtstartDate: DateOnly, rule: Rrule): DateOnly {
  const [y, m] = ymd(dtstartDate);
  switch (rule.freq) {
    case 'DAILY': return dtstartDate;
    case 'WEEKLY': return weekStart(dtstartDate, rule.wkst);
    case 'MONTHLY': return makeISO(y, m, 1);
    case 'YEARLY': return makeISO(y, 1, 1);
  }
}

function advance(cursor: DateOnly, rule: Rrule): DateOnly {
  const [y, m] = ymd(cursor);
  switch (rule.freq) {
    case 'DAILY': return addDaysISO(cursor, rule.interval);
    case 'WEEKLY': return addDaysISO(cursor, 7 * rule.interval);
    case 'MONTHLY': return safeISO(y, m + rule.interval, 1)!;
    case 'YEARLY': return makeISO(y + rule.interval, 1, 1);
  }
}

/** Candidate dates within one period, in order. */
function datesInPeriod(cursor: DateOnly, rule: Rrule, dtstartDate: DateOnly): DateOnly[] {
  const [y, m] = ymd(cursor);
  const [, , startDay] = ymd(dtstartDate);

  const wanted = new Set(rule.byDay.map((d) => d.weekday));

  switch (rule.freq) {
    case 'DAILY':
      // BYDAY on a daily rule is a filter, never an ordinal.
      return wanted.size === 0 || wanted.has(weekdayOf(cursor)) ? [cursor] : [];

    case 'WEEKLY': {
      const days = rule.byDay.length ? rule.byDay.map((d) => d.weekday) : [weekdayOf(dtstartDate)];
      const out: DateOnly[] = [];
      for (let i = 0; i < 7; i++) {
        const date = addDaysISO(cursor, i);
        if (days.includes(weekdayOf(date))) out.push(date);
      }
      return out;
    }

    case 'MONTHLY':
      return datesInMonth(y, m, rule, startDay);

    case 'YEARLY': {
      const months = rule.byMonth.length ? rule.byMonth : [ymd(dtstartDate)[1]];
      return months
        .sort((a, b) => a - b)
        .flatMap((month) => datesInMonth(y, month, rule, startDay));
    }
  }
}

function datesInMonth(y: number, m: number, rule: Rrule, startDay: number): DateOnly[] {
  const out: DateOnly[] = [];

  if (rule.byMonthDay.length) {
    for (const d of rule.byMonthDay) {
      const iso = safeISO(y, m, d);
      // Skipped, not clamped: 31 April is not 30 April.
      if (iso) out.push(iso);
    }
  } else if (rule.byDay.length) {
    for (const { weekday, nth } of rule.byDay) {
      const all: DateOnly[] = [];
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const iso = makeISO(y, m, d);
        if (weekdayOf(iso) === weekday) all.push(iso);
      }
      if (nth == null) out.push(...all);
      else {
        const pick = nth > 0 ? all[nth - 1] : all[all.length + nth];
        if (pick) out.push(pick);
      }
    }
  } else {
    const iso = safeISO(y, m, startDay);
    if (iso) out.push(iso);
  }

  return [...new Set(out)].sort();
}

/**
 * A plain-English description, for the UI.
 *
 * A recurrence the user cannot read is a recurrence they cannot check, and the
 * whole point of expanding rules in the application is that the rule stays
 * visible rather than becoming 200 rows nobody can trace back.
 */
export function describeRrule(input: string | Rrule): string {
  const r = typeof input === 'string' ? parseRrule(input) : input;
  const every =
    r.interval === 1
      ? { DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month', YEARLY: 'Every year' }[r.freq]
      : `Every ${r.interval} ${{ DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years' }[r.freq]}`;

  const names: Record<Weekday, string> = {
    MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
    FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
  };
  const bits: string[] = [every];

  if (r.byDay.length) {
    bits.push(
      `on ${r.byDay
        .map((d) => (d.nth ? `the ${ordinal(d.nth)} ${names[d.weekday]}` : names[d.weekday]))
        .join(', ')}`,
    );
  }
  if (r.byMonthDay.length) {
    bits.push(`on the ${r.byMonthDay.map((d) => (d < 0 ? `${ordinal(-d)} from the end` : ordinal(d))).join(', ')}`);
  }
  if (r.count != null) bits.push(`${r.count} times`);
  if (r.until) bits.push(`until ${r.until.slice(8, 10)}/${r.until.slice(5, 7)}/${r.until.slice(0, 4)}`);
  return bits.join(', ');
}

function ordinal(n: number): string {
  const abs = Math.abs(n);
  const suffix =
    abs % 100 >= 11 && abs % 100 <= 13 ? 'th'
    : abs % 10 === 1 ? 'st'
    : abs % 10 === 2 ? 'nd'
    : abs % 10 === 3 ? 'rd'
    : 'th';
  return `${abs}${suffix}`;
}
