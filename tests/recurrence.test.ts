import { describe, expect, it } from 'vitest';
import {
  describeRrule,
  expandRecurrence,
  formatRrule,
  parseRrule,
  occurrenceAt,
  RecurrenceError,
  repeatFormFromRrule,
  rruleFromForm,
} from '@/lib/recurrence';
import { londonInstant, londonTimeHHMM } from '@/lib/format';

/**
 * Recurrence is the largest bug farm in the calendar, so these tests are
 * written against the two things that actually break it: the month ends, and
 * the clocks. Every case names which one it is standing on.
 *
 * BST in 2026 runs from 01:00 UTC on Sunday 29 March to 02:00 BST on Sunday
 * 25 October. Those two dates appear throughout on purpose.
 */

const LONDON = 'Europe/London';

function days(occurrences: { onDate: string }[]) {
  return occurrences.map((o) => o.onDate);
}
function times(occurrences: { startsAt: string }[]) {
  return occurrences.map((o) => londonTimeHHMM(new Date(o.startsAt)));
}
function utcTimes(occurrences: { startsAt: string }[]) {
  return occurrences.map((o) => o.startsAt.slice(11, 16));
}

describe('parseRrule', () => {
  it('reads the common shape', () => {
    const r = parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
    expect(r).toMatchObject({ freq: 'WEEKLY', interval: 2, count: 6 });
    expect(r.byDay).toEqual([
      { weekday: 'MO', nth: null },
      { weekday: 'WE', nth: null },
    ]);
  });

  it('tolerates the RRULE: prefix and lower case', () => {
    expect(parseRrule('rrule:freq=daily').freq).toBe('DAILY');
  });

  it('reads an ordinal BYDAY from either end', () => {
    expect(parseRrule('FREQ=MONTHLY;BYDAY=3TU').byDay).toEqual([{ weekday: 'TU', nth: 3 }]);
    expect(parseRrule('FREQ=MONTHLY;BYDAY=-1FR').byDay).toEqual([{ weekday: 'FR', nth: -1 }]);
  });

  it('rejects what it cannot honour instead of ignoring it', () => {
    // Silently dropping BYSETPOS would produce a plausible, wrong calendar.
    expect(() => parseRrule('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1')).toThrow(RecurrenceError);
    expect(() => parseRrule('FREQ=HOURLY')).toThrow(RecurrenceError);
    expect(() => parseRrule('FREQ=DAILY;INTERVAL=0')).toThrow(RecurrenceError);
    expect(() => parseRrule('FREQ=DAILY;COUNT=3;UNTIL=20261231T000000Z')).toThrow(RecurrenceError);
    expect(() => parseRrule('FREQ=DAILY;BYDAY=0MO')).toThrow(RecurrenceError);
  });

  it('round-trips through formatRrule', () => {
    const src = 'FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR;COUNT=4';
    expect(formatRrule(parseRrule(src))).toBe(src);
  });
});

describe('expandRecurrence — month ends', () => {
  it('skips months with no 31st rather than clamping to the 30th', () => {
    // RFC 5545 §3.3.10: an invalid date is ignored. Clamping is the intuitive
    // implementation and it invents an event on a day nobody chose.
    const out = expandRecurrence({
      rrule: 'FREQ=MONTHLY;COUNT=6',
      dtstart: londonInstant('2026-01-31', '10:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-06-01T00:00:00Z',
    });
    expect(days(out)).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31',
      '2026-07-31', '2026-08-31', '2026-10-31',
    ]);
  });

  it('counts skipped months against COUNT nowhere — COUNT counts occurrences', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3',
      dtstart: londonInstant('2026-01-31', '10:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('takes the last day of the month with BYMONTHDAY=-1, in every month length', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4',
      dtstart: londonInstant('2026-01-31', '09:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('yearly on 29 February only lands in leap years', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=YEARLY;COUNT=3',
      dtstart: londonInstant('2028-02-29', '12:00').toISOString(),
      from: '2028-01-01T00:00:00Z',
      to: '2045-01-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });

  it('the last Friday of the month is found from the end, not the fourth', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
      dtstart: londonInstant('2026-01-30', '18:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });
    // January 2026 has five Fridays, February four.
    expect(days(out)).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('the third Tuesday is the third, even when the month opens on one', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=MONTHLY;BYDAY=3TU;COUNT=2',
      dtstart: londonInstant('2026-09-15', '19:30').toISOString(),
      from: '2026-09-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-09-15', '2026-10-20']);
  });
});

describe('expandRecurrence — the clocks', () => {
  it('keeps 09:00 local across the spring boundary, moving the UTC instant', () => {
    // 29 March 2026 is the Sunday the clocks go forward.
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      dtstart: londonInstant('2026-03-16', '09:00').toISOString(),
      from: '2026-03-01T00:00:00Z',
      to: '2026-05-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06']);
    expect(times(out)).toEqual(['09:00', '09:00', '09:00', '09:00']);
    // Same wall clock, different instants: that is the whole point.
    expect(utcTimes(out)).toEqual(['09:00', '09:00', '08:00', '08:00']);
  });

  it('keeps 09:00 local across the autumn boundary', () => {
    // 25 October 2026 is the Sunday the clocks go back.
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      dtstart: londonInstant('2026-10-19', '09:00').toISOString(),
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-30T00:00:00Z',
    });
    expect(times(out)).toEqual(['09:00', '09:00', '09:00']);
    expect(utcTimes(out)).toEqual(['08:00', '09:00', '09:00']);
  });

  it('a daily rule straddling the boundary keeps its wall clock every day', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=4',
      dtstart: londonInstant('2026-03-28', '07:30').toISOString(),
      from: '2026-03-01T00:00:00Z',
      to: '2026-04-30T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(times(out)).toEqual(['07:30', '07:30', '07:30', '07:30']);
    expect(utcTimes(out)).toEqual(['07:30', '06:30', '06:30', '06:30']);
  });

  it('an occurrence keeps its duration in real time, not in wall clock', () => {
    // An hour is an hour even on the 23-hour day.
    const out = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=2',
      dtstart: londonInstant('2026-03-28', '23:30').toISOString(),
      dtend: londonInstant('2026-03-29', '00:30').toISOString(),
      from: '2026-03-01T00:00:00Z',
      to: '2026-04-30T00:00:00Z',
    });
    for (const o of out) {
      expect(Date.parse(o.endsAt) - Date.parse(o.startsAt)).toBe(3_600_000);
    }
  });
});

describe('expandRecurrence — windows, counts and exceptions', () => {
  const weekly = {
    rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=8',
    dtstart: londonInstant('2026-03-23', '09:00').toISOString(),
  };

  it('COUNT is a property of the series, not of the window', () => {
    // Asking "what is in May?" must not restart the count in May.
    const all = expandRecurrence({ ...weekly, from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
    const may = expandRecurrence({ ...weekly, from: '2026-05-01T00:00:00Z', to: '2026-06-01T00:00:00Z' });
    expect(all).toHaveLength(8);
    // The series runs 23 March to 11 May; two of the eight land in May, and
    // they keep the indices they have in the series.
    expect(days(may)).toEqual(['2026-05-04', '2026-05-11']);
    expect(may.map((o) => o.index)).toEqual([7, 8]);
  });

  it('UNTIL is inclusive of an occurrence landing exactly on it', () => {
    const out = expandRecurrence({
      rrule: `FREQ=WEEKLY;BYDAY=MO;UNTIL=20260406T080000Z`,
      dtstart: londonInstant('2026-03-23', '09:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    // 6 April 09:00 London is 08:00Z — the UNTIL instant exactly.
    expect(days(out)).toEqual(['2026-03-23', '2026-03-30', '2026-04-06']);
  });

  it('an EXDATE removes an occurrence without shifting the ones after it', () => {
    const out = expandRecurrence({
      ...weekly,
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
      exdates: [londonInstant('2026-04-06', '09:00').toISOString()],
    });
    expect(out).toHaveLength(7);
    expect(days(out)).not.toContain('2026-04-06');
    // Still eight in the series: the last one keeps its index.
    expect(out[out.length - 1]!.index).toBe(8);
  });

  it('an occurrence overlapping the start of the window is included', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=3',
      dtstart: londonInstant('2026-06-01', '23:00').toISOString(),
      dtend: londonInstant('2026-06-02', '01:00').toISOString(),
      from: londonInstant('2026-06-02', '00:00').toISOString(),
      to: londonInstant('2026-06-02', '12:00').toISOString(),
    });
    expect(days(out)).toEqual(['2026-06-01']);
  });

  it('a rule with no COUNT and no UNTIL is bounded by the window', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=DAILY',
      dtstart: londonInstant('2020-01-01', '08:00').toISOString(),
      from: londonInstant('2026-07-01', '00:00').toISOString(),
      to: londonInstant('2026-07-08', '00:00').toISOString(),
    });
    expect(days(out)).toEqual([
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04',
      '2026-07-05', '2026-07-06', '2026-07-07',
    ]);
  });

  it('a fortnightly rule keeps its phase across a long gap', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      dtstart: londonInstant('2026-10-19', '07:00').toISOString(),
      from: londonInstant('2026-11-01', '00:00').toISOString(),
      to: londonInstant('2026-12-01', '00:00').toISOString(),
    });
    expect(days(out)).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });

  it('several weekdays in one week come back in order', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6',
      dtstart: londonInstant('2026-06-01', '09:30').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(out)).toEqual([
      '2026-06-01', '2026-06-03', '2026-06-05',
      '2026-06-08', '2026-06-10', '2026-06-12',
    ]);
  });

  it('never emits an occurrence before DTSTART, even mid-week', () => {
    // DTSTART is a Wednesday; the rule also names Monday. The Monday before it
    // is in the same week and must not appear.
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3',
      dtstart: londonInstant('2026-06-03', '09:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(out)).toEqual(['2026-06-03', '2026-06-08', '2026-06-10']);
  });

  it('honours WKST when it changes which days share a week', () => {
    // With WKST=SU the Sunday and the following Tuesday are in one week, so an
    // INTERVAL=2 rule keeps them together; with WKST=MO they split.
    const su = expandRecurrence({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU;COUNT=4',
      dtstart: londonInstant('2026-06-07', '10:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(su)).toEqual(['2026-06-07', '2026-06-09', '2026-06-21', '2026-06-23']);

    const mo = expandRecurrence({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=MO;COUNT=4',
      dtstart: londonInstant('2026-06-07', '10:00').toISOString(),
      from: '2026-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    });
    expect(days(mo)).toEqual(['2026-06-07', '2026-06-16', '2026-06-21', '2026-06-30']);
  });

  it('an all-day rule expands to London midnights, not UTC midnights', () => {
    const out = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
      dtstart: londonInstant('2026-07-06', '00:00').toISOString(),
      dtend: londonInstant('2026-07-07', '00:00').toISOString(),
      from: '2026-07-01T00:00:00Z',
      to: '2026-08-01T00:00:00Z',
    });
    expect(times(out)).toEqual(['00:00', '00:00']);
    // July is BST, so London midnight is 23:00Z the previous day.
    expect(out[0]!.startsAt).toBe('2026-07-05T23:00:00.000Z');
  });
});

describe('describeRrule', () => {
  it('says what the rule does in words a person can check', () => {
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO;COUNT=8')).toBe('Every week, on Monday, 8 times');
    expect(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('Every 2 weeks, on Monday');
    expect(describeRrule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Every month, on the 1st Friday');
    expect(describeRrule('FREQ=MONTHLY;BYMONTHDAY=31')).toBe('Every month, on the 31st');
  });
});

// ---------------------------------------------------------------------------

describe('building a repeat from a form', () => {
  const base = { freq: 'WEEKLY' as const, interval: 1, byDay: [] as const, endOn: null, startOn: '2026-08-03' };

  it('builds a weekly repeat on the days chosen', () => {
    const r = rruleFromForm({ ...base, byDay: ['MO', 'TH'] });
    expect(r).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' });
  });

  it('falls back to the day the event starts on when none is chosen', () => {
    // 3 August 2026 is a Monday.
    expect(rruleFromForm(base)).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO' });
  });

  it('carries an interval only when it is not one', () => {
    expect(rruleFromForm({ ...base, interval: 2, byDay: ['MO'] })).toEqual({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    });
  });

  it('ignores chosen days for a frequency that has none', () => {
    expect(rruleFromForm({ ...base, freq: 'MONTHLY', byDay: ['MO', 'TH'] })).toEqual({
      rrule: 'FREQ=MONTHLY',
    });
  });

  it('ends on the whole of the last day, not at midnight on it', () => {
    // The last London day, not the last UTC one: 31 August 2026 is in BST, so
    // the end of it is 22:59:59Z. `T235959Z` would be 00:59:59 on 1 September in
    // London, and a series repeating at 00:30 would run a day past the day it
    // was told to stop.
    const r = rruleFromForm({ ...base, byDay: ['MO'], endOn: '2026-08-31' });
    expect(r).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260831T225959Z' });
  });

  it('stops on the London day it was given, for an occurrence just after midnight', () => {
    // The case that made the UTC end-of-day wrong. An 00:30 repeat told to stop
    // on 31 August must not produce one on 1 September.
    const built = rruleFromForm({
      freq: 'DAILY', interval: 1, byDay: [], endOn: '2026-08-31', startOn: '2026-08-24',
    });
    if ('error' in built) throw new Error(built.error);
    const starts = expandRecurrence({
      rrule: built.rrule,
      dtstart: londonInstant('2026-08-24', '00:30').toISOString(),
      from: londonInstant('2026-08-01', '00:00').toISOString(),
      to: londonInstant('2026-09-30', '00:00').toISOString(),
    }).map((o) => o.startsAt);
    // Every occurrence is 00:30 London time, and the last is on the 31st.
    expect(starts.every((s) => londonTimeHHMM(new Date(s)) === '00:30')).toBe(true);
    expect(starts.length).toBe(8); // 24 to 31 August inclusive
    const firstSeptember = londonInstant('2026-09-01', '00:00').toISOString();
    expect(starts.every((s) => Date.parse(s) < Date.parse(firstSeptember))).toBe(true);
  });

  it('keeps the occurrence on the day it was told to stop', () => {
    const built = rruleFromForm({ ...base, byDay: ['MO'], endOn: '2026-08-31' });
    if ('error' in built) throw new Error(built.error);
    const dates = expandRecurrence({
      rrule: built.rrule,
      dtstart: '2026-08-03T09:00:00.000Z',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-30T00:00:00.000Z',
    }).map((o) => o.startsAt.slice(0, 10));
    // 31 August 2026 is a Monday, and it is the day it was told to stop.
    expect(dates).toContain('2026-08-31');
    expect(dates.every((d) => d <= '2026-08-31')).toBe(true);
  });

  it('refuses an interval that is not a whole number of anything', () => {
    expect(rruleFromForm({ ...base, interval: 0 })).toEqual({
      error: 'How often it repeats has to be a whole number between 1 and 99.',
    });
    expect(rruleFromForm({ ...base, interval: 1.5 })).toHaveProperty('error');
    expect(rruleFromForm({ ...base, interval: 100 })).toHaveProperty('error');
  });

  it('refuses to stop before it starts', () => {
    expect(rruleFromForm({ ...base, endOn: '2026-07-01' })).toEqual({
      error: 'It cannot stop repeating before it starts.',
    });
  });

  it('refuses a start date that is not a date', () => {
    expect(rruleFromForm({ ...base, startOn: 'tomorrow' })).toHaveProperty('error');
  });

  it('refuses an end date that is not a date', () => {
    expect(rruleFromForm({ ...base, endOn: '31/08/2026' })).toHaveProperty('error');
  });

  it('refuses a frequency it cannot build', () => {
    expect(rruleFromForm({ ...base, freq: 'HOURLY' as never })).toHaveProperty('error');
  });

  it('produces something parseRrule accepts, for every frequency', () => {
    for (const freq of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
      const built = rruleFromForm({ ...base, freq, interval: 3, endOn: '2027-01-01' });
      if ('error' in built) throw new Error(built.error);
      expect(() => parseRrule(built.rrule)).not.toThrow();
      expect(describeRrule(built.rrule)).toBeTruthy();
    }
  });
});

/**
 * Reading a stored rule back into the form that builds one.
 *
 * The inverse of `rruleFromForm`, and the reason a repeat can now be changed
 * rather than only created. The important cases are the refusals: a rule the form
 * cannot express has to come back as `null`, because opening the form on it and
 * saving would rewrite it as something narrower — and "the third Thursday"
 * quietly becoming "every Thursday" is data loss nobody would see happen.
 */
describe('reading a repeat back into the form', () => {
  it('round-trips every repeat the builder can build', () => {
    const forms = [
      { freq: 'DAILY', interval: 1, byDay: [], endOn: null, startOn: '2026-05-04' },
      { freq: 'DAILY', interval: 3, byDay: [], endOn: '2026-08-31', startOn: '2026-05-04' },
      { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'WE'], endOn: null, startOn: '2026-05-04' },
      { freq: 'WEEKLY', interval: 2, byDay: ['FR'], endOn: '2026-12-25', startOn: '2026-05-04' },
      { freq: 'MONTHLY', interval: 1, byDay: [], endOn: null, startOn: '2026-05-04' },
      { freq: 'YEARLY', interval: 1, byDay: [], endOn: '2030-01-01', startOn: '2026-05-04' },
    ] as const;

    for (const form of forms) {
      const built = rruleFromForm(form);
      expect(built, JSON.stringify(form)).not.toHaveProperty('error');
      if ('error' in built) continue;
      expect(repeatFormFromRrule(built.rrule, form.startOn), built.rrule).toEqual(form);
    }
  });

  it('brings the end date back as the day a person typed, not the instant stored', () => {
    // UNTIL is stored as the end of the last day; the form asked for the day.
    const built = rruleFromForm({
      freq: 'WEEKLY', interval: 1, byDay: ['TH'], endOn: '2026-10-25', startOn: '2026-09-03',
    });
    if ('error' in built) throw new Error(built.error);
    // 25 October 2026 is the day the clocks go back: the London day ends at
    // 23:59:59 GMT, which is the same wall clock and a different offset from the
    // day before it.
    expect(built.rrule).toContain('UNTIL=20261025T235959Z');
    expect(repeatFormFromRrule(built.rrule, '2026-09-03')?.endOn).toBe('2026-10-25');
  });

  it('fills in the weekly day the builder implied, rather than leaving it empty', () => {
    // A weekly repeat with no day chosen uses the start day; read back, the box
    // for that day is ticked, which is what was stored.
    const built = rruleFromForm({
      freq: 'WEEKLY', interval: 1, byDay: [], endOn: null, startOn: '2026-05-04',
    });
    if ('error' in built) throw new Error(built.error);
    expect(repeatFormFromRrule(built.rrule, '2026-05-04')?.byDay).toEqual(['MO']);
  });

  it('refuses an ordinal BYDAY rather than flattening it to every week', () => {
    // "The third Thursday" parses and expands correctly; the form has no control
    // for it, so it must not be opened on it.
    expect(parseRrule('FREQ=MONTHLY;BYDAY=3TH').byDay).toEqual([{ weekday: 'TH', nth: 3 }]);
    expect(repeatFormFromRrule('FREQ=MONTHLY;BYDAY=3TH', '2026-05-21')).toBeNull();
    expect(repeatFormFromRrule('FREQ=MONTHLY;BYDAY=-1FR', '2026-05-29')).toBeNull();
  });

  it('refuses a COUNT, a BYMONTHDAY and a BYMONTH, all of which it cannot show', () => {
    expect(repeatFormFromRrule('FREQ=DAILY;COUNT=10', '2026-05-04')).toBeNull();
    expect(repeatFormFromRrule('FREQ=MONTHLY;BYMONTHDAY=31', '2026-05-31')).toBeNull();
    expect(repeatFormFromRrule('FREQ=YEARLY;BYMONTH=3', '2026-03-04')).toBeNull();
    expect(repeatFormFromRrule('FREQ=WEEKLY;WKST=SU', '2026-05-04')).toBeNull();
  });

  it('refuses a BYDAY on a frequency that is not weekly, which has no control at all', () => {
    expect(repeatFormFromRrule('FREQ=MONTHLY;BYDAY=TU', '2026-05-05')).toBeNull();
  });

  it('refuses a rule it cannot even parse, rather than throwing at the caller', () => {
    expect(repeatFormFromRrule('FREQ=FORTNIGHTLY', '2026-05-04')).toBeNull();
    expect(repeatFormFromRrule('nonsense', '2026-05-04')).toBeNull();
    expect(repeatFormFromRrule('FREQ=DAILY;BYSETPOS=1', '2026-05-04')).toBeNull();
  });

  it('reads a rule with no INTERVAL as every one', () => {
    expect(repeatFormFromRrule('FREQ=WEEKLY;BYDAY=TU', '2026-05-05')).toEqual({
      freq: 'WEEKLY', interval: 1, byDay: ['TU'], endOn: null, startOn: '2026-05-05',
    });
  });
});

/**
 * Naming one occurrence of a series.
 *
 * An occurrence has no id — the database holds one row and one rule — so it is
 * named by its own start instant, RFC 5545's RECURRENCE-ID. That instant reaches
 * the server on a URL, which makes it a claim from the client, and the whole
 * point of this function is that the claim is checked rather than trusted: an
 * unchecked instant appended to EXDATE is a rule quietly carrying an exclusion
 * that matches nothing, or worse, one that matches something later.
 */
describe('naming one occurrence of a series', () => {
  const series = {
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    dtstart: londonInstant('2026-05-04', '09:00').toISOString(),
    dtend: londonInstant('2026-05-04', '10:00').toISOString(),
    exdates: [] as string[],
  };

  it('finds an occurrence at an instant the series really generates', () => {
    const third = londonInstant('2026-05-18', '09:00').toISOString();
    const found = occurrenceAt(series, third);
    expect(found?.startsAt).toBe(third);
    expect(found?.endsAt).toBe(londonInstant('2026-05-18', '10:00').toISOString());
  });

  it('finds the first occurrence, which is the event row itself', () => {
    expect(occurrenceAt(series, series.dtstart)?.startsAt).toBe(series.dtstart);
  });

  it('refuses an instant a minute off, rather than snapping to the nearest', () => {
    expect(occurrenceAt(series, londonInstant('2026-05-18', '09:01').toISOString())).toBeNull();
    expect(occurrenceAt(series, londonInstant('2026-05-19', '09:00').toISOString())).toBeNull();
  });

  it('refuses an instant that is not a date at all', () => {
    expect(occurrenceAt(series, 'next Tuesday')).toBeNull();
    expect(occurrenceAt(series, '')).toBeNull();
  });

  it('says an already-skipped occurrence is not an occurrence', () => {
    // Which is what makes "already skipped" distinguishable from "never
    // existed", and what stops the same instant being excluded twice.
    const skipped = londonInstant('2026-05-11', '09:00').toISOString();
    expect(occurrenceAt(series, skipped)?.startsAt).toBe(skipped);
    expect(occurrenceAt({ ...series, exdates: [skipped] }, skipped)).toBeNull();
    // And the ones either side are untouched by the exclusion.
    expect(occurrenceAt({ ...series, exdates: [skipped] }, series.dtstart)).not.toBeNull();
  });

  it('holds the wall clock across the spring clock change', () => {
    // A weekly 09:00 on a Friday is 09:00 in March and 09:00 in April, even
    // though the UTC instant moves by an hour between them.
    const s = {
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      dtstart: londonInstant('2026-03-27', '09:00').toISOString(),
      dtend: londonInstant('2026-03-27', '10:00').toISOString(),
      exdates: [] as string[],
    };
    const afterBst = londonInstant('2026-04-03', '09:00').toISOString();
    expect(s.dtstart).toBe('2026-03-27T09:00:00.000Z'); // GMT
    expect(afterBst).toBe('2026-04-03T08:00:00.000Z'); // BST
    expect(occurrenceAt(s, afterBst)?.startsAt).toBe(afterBst);
    // The naive "same UTC instant a week later" is not an occurrence.
    expect(occurrenceAt(s, '2026-04-03T09:00:00.000Z')).toBeNull();
  });

  it('refuses an instant past the end of a series that stops', () => {
    const s = { ...series, rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260518T235959Z' };
    expect(occurrenceAt(s, londonInstant('2026-05-18', '09:00').toISOString())).not.toBeNull();
    expect(occurrenceAt(s, londonInstant('2026-05-25', '09:00').toISOString())).toBeNull();
  });
});
