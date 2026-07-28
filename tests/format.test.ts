import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  daysFromToday,
  formatDate,
  formatDateTime,
  formatDueDate,
  formatDuration,
  formatTime,
  londonDayISO,
  londonMidnight,
  plural,
  startOfWeekISO,
  todayISO,
} from '@/lib/format';

/**
 * These are the tests that catch the bug you only find in late October.
 *
 * The UK spends roughly half the year at UTC+1. Any code that reaches for
 * getDate(), or builds a Date from a bare 'YYYY-MM-DD' and then reads it back
 * in local time, is off by a day for one of those halves. Every case below
 * names the boundary it is standing on.
 */

// The 2026 transitions: BST begins 29 March, ends 25 October.
const BST_START = '2026-03-29';
const BST_END = '2026-10-25';

describe('londonDayISO — which calendar day is this instant?', () => {
  it('files a UTC instant under the London day, not the UTC day', () => {
    // 23:30 UTC on 14 July is 00:30 BST on 15 July. A naive slice(0,10) of the
    // ISO string says the 14th, which is the bug this function exists to stop.
    expect(londonDayISO(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
  });

  it('agrees with UTC in winter', () => {
    expect(londonDayISO(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-14');
  });

  it('handles the last minute before the clocks go forward', () => {
    // 00:59 UTC on 29 March is 00:59 GMT — the jump to 02:00 happens at 01:00.
    expect(londonDayISO(new Date(`${BST_START}T00:59:00Z`))).toBe(BST_START);
  });

  it('handles the ambiguous hour when the clocks go back', () => {
    // 01:30 UTC on 25 October is 01:30 GMT, after the repeat of 01:00–02:00.
    expect(londonDayISO(new Date(`${BST_END}T01:30:00Z`))).toBe(BST_END);
  });

  it('accepts a string or a number as well as a Date', () => {
    expect(londonDayISO('2026-07-14T23:30:00Z')).toBe('2026-07-15');
    expect(londonDayISO(Date.parse('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
  });
});

describe('londonMidnight — the start of a London day as a UTC instant', () => {
  it('is 23:00 the previous day in UTC during BST', () => {
    expect(londonMidnight('2026-07-15').toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('is the same instant as UTC midnight in winter', () => {
    expect(londonMidnight('2026-01-15').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('is right on the day the clocks go forward', () => {
    // 29 March starts at 00:00 GMT; the hour that vanishes is 01:00–02:00.
    expect(londonMidnight(BST_START).toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });

  it('is right on the day the clocks go back', () => {
    // 25 October starts at 00:00 BST, which is 23:00 UTC on the 24th.
    expect(londonMidnight(BST_END).toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });

  it('round-trips: the midnight of a day is filed under that day', () => {
    for (const day of ['2026-01-01', BST_START, '2026-07-15', BST_END, '2026-12-31']) {
      expect(londonDayISO(londonMidnight(day))).toBe(day);
    }
  });
});

describe('formatTime — 24-hour, London, always', () => {
  it('shifts a summer instant into BST', () => {
    expect(formatTime('2026-07-15T13:05:00Z')).toBe('14:05');
  });

  it('leaves a winter instant at UTC', () => {
    expect(formatTime('2026-01-15T13:05:00Z')).toBe('13:05');
  });

  it('uses a 24-hour clock with no am/pm', () => {
    expect(formatTime('2026-01-15T19:30:00Z')).toBe('19:30');
    expect(formatTime('2026-01-15T00:05:00Z')).toBe('00:05');
  });
});

describe('formatDateTime', () => {
  it('reads as UK prose with a 24-hour time', () => {
    expect(formatDateTime('2026-07-15T13:05:00Z')).toBe('15 Jul, 14:05');
  });

  it('rolls to the next London day when the UTC instant is late', () => {
    expect(formatDateTime('2026-07-14T23:30:00Z')).toBe('15 Jul, 00:30');
  });
});

describe('formatDate — DD/MM/YYYY, never MM/DD', () => {
  it('puts the day first', () => {
    expect(formatDate('2026-03-04')).toBe('04/03/2026');
  });
});

describe('daysFromToday', () => {
  it('counts calendar days, not 24-hour periods, across a BST boundary', () => {
    // 25 October 2026 is 25 hours long. Counting milliseconds would give 24/25
    // of a day and round to the wrong side; counting calendar dates gives 1.
    expect(daysFromToday('2026-10-25', '2026-10-24')).toBe(1);
    expect(daysFromToday('2026-10-26', '2026-10-25')).toBe(1);
  });

  it('counts across the shorter spring day too', () => {
    expect(daysFromToday('2026-03-29', '2026-03-28')).toBe(1);
    expect(daysFromToday('2026-03-30', '2026-03-29')).toBe(1);
  });

  it('is negative in the past and zero for today', () => {
    expect(daysFromToday('2026-07-10', '2026-07-15')).toBe(-5);
    expect(daysFromToday('2026-07-15', '2026-07-15')).toBe(0);
  });
});

describe('formatDueDate', () => {
  const today = '2026-07-15'; // a Wednesday

  it('names the near days rather than dating them', () => {
    expect(formatDueDate('2026-07-15', today)).toBe('Today');
    expect(formatDueDate('2026-07-16', today)).toBe('Tomorrow');
    expect(formatDueDate('2026-07-14', today)).toBe('Yesterday');
  });

  it('uses the weekday inside the coming week', () => {
    expect(formatDueDate('2026-07-17', today)).toBe('Friday');
  });

  it('says how long ago for the recent past', () => {
    expect(formatDueDate('2026-07-12', today)).toBe('Sun — 3 days ago');
  });

  it('drops the year when it is this year, and keeps it when it is not', () => {
    expect(formatDueDate('2026-11-02', today)).toBe('2 Nov');
    expect(formatDueDate('2027-01-04', today)).toBe('04/01/2027');
  });

  it('is stable when today is the day the clocks change', () => {
    expect(formatDueDate(BST_END, BST_END)).toBe('Today');
    expect(formatDueDate('2026-10-26', BST_END)).toBe('Tomorrow');
    expect(formatDueDate('2026-10-24', BST_END)).toBe('Yesterday');
    expect(formatDueDate(BST_START, BST_START)).toBe('Today');
    expect(formatDueDate('2026-03-30', BST_START)).toBe('Tomorrow');
  });

  it('renders nothing for a task with no date', () => {
    expect(formatDueDate(null, today)).toBe('');
  });
});

describe('todayISO', () => {
  it('answers in London, so a late-evening BST instant is already tomorrow', () => {
    expect(todayISO(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    expect(todayISO(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-14');
  });
});

describe('addDaysISO', () => {
  it('adds calendar days across both boundaries', () => {
    expect(addDaysISO('2026-03-28', 1)).toBe(BST_START);
    expect(addDaysISO(BST_START, 1)).toBe('2026-03-30');
    expect(addDaysISO('2026-10-24', 1)).toBe(BST_END);
    expect(addDaysISO(BST_END, 1)).toBe('2026-10-26');
  });

  it('goes backwards and across months and years', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('startOfWeekISO — Monday first, UK convention', () => {
  it('returns Monday for every day of a week', () => {
    // 13 July 2026 is a Monday; 19 July is the Sunday that ends that week.
    for (const d of [
      '2026-07-13', '2026-07-14', '2026-07-15',
      '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19',
    ]) {
      expect(startOfWeekISO(d)).toBe('2026-07-13');
    }
  });

  it('does not treat Sunday as the start of the next week', () => {
    expect(startOfWeekISO('2026-07-19')).not.toBe('2026-07-19');
  });

  it('is stable across the BST boundaries', () => {
    expect(startOfWeekISO(BST_START)).toBe('2026-03-23'); // Sunday 29 March
    expect(startOfWeekISO(BST_END)).toBe('2026-10-19'); // Sunday 25 October
  });
});

describe('the small prose helpers', () => {
  it('pluralises', () => {
    expect(plural(1, 'event')).toBe('1 event');
    expect(plural(3, 'event')).toBe('3 events');
    expect(plural(0, 'event')).toBe('0 events');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });

  it('formats durations the way a person says them', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
  });
});
