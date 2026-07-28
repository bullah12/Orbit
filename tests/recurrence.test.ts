import { describe, expect, it } from 'vitest';
import {
  describeRrule,
  expandRecurrence,
  formatRrule,
  parseRrule,
  RecurrenceError,
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
