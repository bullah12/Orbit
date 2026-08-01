import { describe, expect, it } from 'vitest';
import {
  byDay,
  daySpan,
  hourLines,
  isAllDayOn,
  layoutDay,
  monthGrid,
  MIN_BLOCK_MINUTES,
  scrollToMinute,
  splitDay,
  stepAnchor,
  viewRange,
  weekDays,
} from '@/lib/calendar';
import { londonInstant } from '@/lib/format';

/**
 * The week grid across both BST boundaries, which is where this breaks.
 *
 * 2026: clocks forward 01:00 UTC on Sunday 29 March (a 23-hour day), back at
 * 02:00 BST on Sunday 25 October (a 25-hour day). Every case here that names a
 * date names it for that reason.
 */

function ev(day: string, from: string, to: string, allDay = false) {
  return {
    startsAt: londonInstant(day, from).toISOString(),
    endsAt: londonInstant(day, to).toISOString(),
    allDay,
  };
}

describe('weekDays — Monday first, UK convention', () => {
  it('starts on Monday whatever day you ask about', () => {
    expect(weekDays('2026-07-29')).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
  });

  it('a Sunday belongs to the week that started six days earlier, not the next one', () => {
    // The off-by-one that makes Sunday's events vanish in a Monday-first grid.
    expect(weekDays('2026-08-02')[0]).toBe('2026-07-27');
    expect(weekDays('2026-08-02')[6]).toBe('2026-08-02');
  });

  it('holds together across the spring boundary', () => {
    const week = weekDays('2026-03-29');
    expect(week).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26',
      '2026-03-27', '2026-03-28', '2026-03-29',
    ]);
  });

  it('holds together across the autumn boundary', () => {
    const week = weekDays('2026-10-25');
    expect(week[0]).toBe('2026-10-19');
    expect(week[6]).toBe('2026-10-25');
  });

  it('crosses a year end without repeating or skipping a day', () => {
    const week = weekDays('2027-01-01');
    expect(week).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });
});

describe('viewRange', () => {
  it('a week in March runs from London midnight to London midnight, 7 days later', () => {
    const { from, to } = viewRange('week', '2026-03-25');
    expect(from.toISOString()).toBe('2026-03-23T00:00:00.000Z');
    // The week contains the 23-hour day, so it is 7×24−1 hours long.
    expect(to.getTime() - from.getTime()).toBe((7 * 24 - 1) * 3_600_000);
  });

  it('a week containing 25 October is 169 hours long', () => {
    const { from, to } = viewRange('week', '2026-10-21');
    expect(to.getTime() - from.getTime()).toBe((7 * 24 + 1) * 3_600_000);
  });

  it('a day range is one London day, not 24 hours', () => {
    const spring = viewRange('day', '2026-03-29');
    expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * 3_600_000);
    const autumn = viewRange('day', '2026-10-25');
    expect(autumn.to.getTime() - autumn.from.getTime()).toBe(25 * 3_600_000);
  });

  it('a month range covers the whole six-week grid', () => {
    const { from, to } = viewRange('month', '2026-07-15');
    expect(from.toISOString()).toBe('2026-06-28T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-09T23:00:00.000Z');
  });
});

describe('monthGrid', () => {
  it('is always six Monday-first weeks, so the page does not change height', () => {
    for (const anchor of ['2026-02-10', '2026-07-01', '2027-01-31']) {
      const grid = monthGrid(anchor);
      expect(grid).toHaveLength(6);
      expect(grid.every((w) => w.length === 7)).toBe(true);
    }
  });

  it('starts on the Monday on or before the 1st', () => {
    // 1 July 2026 is a Wednesday.
    expect(monthGrid('2026-07-20')[0]![0]).toBe('2026-06-29');
    expect(monthGrid('2026-07-20')[5]![6]).toBe('2026-08-09');
  });

  it('February 2027 begins on a Monday and still gets six rows', () => {
    const grid = monthGrid('2027-02-15');
    expect(grid[0]![0]).toBe('2027-02-01');
    expect(grid[5]![6]).toBe('2027-03-14');
  });
});

describe('stepAnchor', () => {
  it('steps a month by calendar months, not by 28 or 30 days', () => {
    expect(stepAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(stepAnchor('month', '2026-03-15', -1)).toBe('2026-02-01');
    expect(stepAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(stepAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('steps a week over the boundary without drifting by an hour', () => {
    expect(stepAnchor('week', '2026-03-25', 1)).toBe('2026-04-01');
    expect(stepAnchor('week', '2026-10-22', 1)).toBe('2026-10-29');
  });

  it('steps a day across the 23-hour day', () => {
    expect(stepAnchor('day', '2026-03-28', 1)).toBe('2026-03-29');
    expect(stepAnchor('day', '2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('daySpan', () => {
  it('measures from London midnight, not UTC midnight', () => {
    // In BST these differ by an hour: 09:00 is 480 minutes into the day, not 540.
    expect(daySpan(ev('2026-07-15', '09:00', '10:00'), '2026-07-15')).toMatchObject({
      startMinute: 540, endMinute: 600,
    });
    expect(daySpan(ev('2026-01-15', '09:00', '10:00'), '2026-01-15')).toMatchObject({
      startMinute: 540, endMinute: 600,
    });
  });

  it('puts an event that crosses midnight on both days, clipped', () => {
    const overnight = {
      startsAt: londonInstant('2026-07-15', '23:00').toISOString(),
      endsAt: londonInstant('2026-07-16', '01:30').toISOString(),
      allDay: false,
    };
    expect(daySpan(overnight, '2026-07-15')).toMatchObject({
      startMinute: 1380, endMinute: 1440, continuesTo: true, continuesFrom: false,
    });
    expect(daySpan(overnight, '2026-07-16')).toMatchObject({
      startMinute: 0, endMinute: 90, continuesFrom: true, continuesTo: false,
    });
  });

  it('is null for a day the event does not touch', () => {
    expect(daySpan(ev('2026-07-15', '09:00', '10:00'), '2026-07-16')).toBeNull();
    expect(daySpan(ev('2026-07-15', '09:00', '10:00'), '2026-07-14')).toBeNull();
  });

  it('does not draw a sliver on the next day for an event ending at midnight', () => {
    const untilMidnight = {
      startsAt: londonInstant('2026-07-15', '22:00').toISOString(),
      endsAt: londonInstant('2026-07-16', '00:00').toISOString(),
      allDay: false,
    };
    expect(daySpan(untilMidnight, '2026-07-16')).toBeNull();
    expect(daySpan(untilMidnight, '2026-07-15')!.endMinute).toBe(1440);
  });

  it('the 23-hour day ends at minute 1380 and the 25-hour day at 1500', () => {
    const springLate = {
      startsAt: londonInstant('2026-03-29', '22:00').toISOString(),
      endsAt: londonInstant('2026-03-30', '00:00').toISOString(),
      allDay: false,
    };
    expect(daySpan(springLate, '2026-03-29')!.endMinute).toBe(1380);

    const autumnLate = {
      startsAt: londonInstant('2026-10-25', '22:00').toISOString(),
      endsAt: londonInstant('2026-10-26', '00:00').toISOString(),
      allDay: false,
    };
    expect(autumnLate).toBeTruthy();
    expect(daySpan(autumnLate, '2026-10-25')!.endMinute).toBe(1500);
  });

  it('an event in the repeated hour on 25 October sits after the first 01:00, not before', () => {
    // 01:30 resolves to the second (GMT) occurrence, 150 minutes into the day.
    expect(daySpan(ev('2026-10-25', '01:30', '02:00'), '2026-10-25')!.startMinute).toBe(150);
  });
});

describe('all-day handling', () => {
  it('an explicitly all-day item is all-day whatever its times say', () => {
    expect(isAllDayOn(ev('2026-07-15', '09:00', '10:00', true), '2026-07-15')).toBe(true);
  });

  it('a midnight-to-midnight item is all-day too, on both a 23- and a 25-hour day', () => {
    const spring = {
      startsAt: londonInstant('2026-03-29', '00:00').toISOString(),
      endsAt: londonInstant('2026-03-30', '00:00').toISOString(),
      allDay: false,
    };
    expect(isAllDayOn(spring, '2026-03-29')).toBe(true);

    const autumn = {
      startsAt: londonInstant('2026-10-25', '00:00').toISOString(),
      endsAt: londonInstant('2026-10-26', '00:00').toISOString(),
      allDay: false,
    };
    // 1440 minutes would not cover this 1500-minute day; the hard-coded number
    // is exactly the bug this asserts against.
    expect(isAllDayOn(autumn, '2026-10-25')).toBe(true);
  });

  it('a multi-day event is all-day on its middle days only', () => {
    const trip = {
      startsAt: londonInstant('2026-07-15', '18:00').toISOString(),
      endsAt: londonInstant('2026-07-18', '11:00').toISOString(),
      allDay: false,
    };
    expect(isAllDayOn(trip, '2026-07-15')).toBe(false);
    expect(isAllDayOn(trip, '2026-07-16')).toBe(true);
    expect(isAllDayOn(trip, '2026-07-17')).toBe(true);
    expect(isAllDayOn(trip, '2026-07-18')).toBe(false);
  });

  it('splitDay keeps the grid free of full-height blocks', () => {
    const items = [
      ev('2026-07-15', '09:00', '10:00'),
      ev('2026-07-15', '00:00', '00:00', true),
    ];
    const { allDay, timed } = splitDay(items, '2026-07-15');
    expect(allDay).toHaveLength(1);
    expect(timed).toHaveLength(1);
  });
});

describe('layoutDay', () => {
  it('gives a lone event the full width', () => {
    const [block] = layoutDay([ev('2026-07-15', '09:00', '10:00')], '2026-07-15');
    expect(block!.columns).toBe(1);
    expect(block!.column).toBe(0);
    expect(block!.top).toBeCloseTo(540 / 1440, 6);
    expect(block!.height).toBeCloseTo(60 / 1440, 6);
  });

  it('positions against the real length of a 25-hour day', () => {
    const [block] = layoutDay([ev('2026-10-25', '12:00', '13:00')], '2026-10-25');
    // 13 hours into the day because the extra hour has already happened.
    expect(block!.top).toBeCloseTo(780 / 1500, 6);
    expect(block!.height).toBeCloseTo(60 / 1500, 6);
  });

  it('puts two overlapping events side by side', () => {
    const blocks = layoutDay(
      [ev('2026-07-15', '09:00', '10:30'), ev('2026-07-15', '10:00', '11:00')],
      '2026-07-15',
    );
    expect(blocks.map((b) => b.columns)).toEqual([2, 2]);
    expect(blocks.map((b) => b.column).sort()).toEqual([0, 1]);
  });

  it('reuses a lane once it is free, rather than widening the whole day', () => {
    const blocks = layoutDay(
      [
        ev('2026-07-15', '09:00', '10:00'),
        ev('2026-07-15', '09:30', '10:30'),
        ev('2026-07-15', '10:00', '11:00'),
      ],
      '2026-07-15',
    );
    // Three events, but never three at once: two lanes are enough.
    expect(blocks.every((b) => b.columns === 2)).toBe(true);
    expect(blocks[2]!.column).toBe(0);
  });

  it('does not let one busy morning squeeze the rest of the day', () => {
    const blocks = layoutDay(
      [
        ev('2026-07-15', '09:00', '10:00'),
        ev('2026-07-15', '09:00', '10:00'),
        ev('2026-07-15', '09:00', '10:00'),
        ev('2026-07-15', '14:00', '15:00'),
      ],
      '2026-07-15',
    );
    expect(blocks.filter((b) => b.columns === 3)).toHaveLength(3);
    expect(blocks.find((b) => b.span.startMinute === 840)!.columns).toBe(1);
  });

  it('draws a very short event tall enough to click without moving anything else', () => {
    const blocks = layoutDay(
      [ev('2026-07-15', '09:00', '09:05'), ev('2026-07-15', '09:15', '09:20')],
      '2026-07-15',
    );
    expect(blocks[0]!.height).toBeCloseTo(MIN_BLOCK_MINUTES / 1440, 6);
    // Their true ends do not overlap, so they stay in one lane despite being
    // drawn taller than they are.
    expect(blocks.every((b) => b.columns === 1)).toBe(true);
  });

  it('never draws a block past the bottom of the day', () => {
    const blocks = layoutDay([ev('2026-07-15', '23:55', '23:59')], '2026-07-15');
    expect(blocks[0]!.top + blocks[0]!.height).toBeLessThanOrEqual(1);
  });

  it('includes the tail of an event that started yesterday', () => {
    const overnight = {
      startsAt: londonInstant('2026-07-14', '22:00').toISOString(),
      endsAt: londonInstant('2026-07-15', '02:00').toISOString(),
      allDay: false,
    };
    const blocks = layoutDay([overnight], '2026-07-15');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.top).toBe(0);
    expect(blocks[0]!.span.continuesFrom).toBe(true);
  });

  it('is stable: same input, same order out', () => {
    const items = [ev('2026-07-15', '10:00', '11:00'), ev('2026-07-15', '09:00', '12:00')];
    const a = layoutDay(items, '2026-07-15').map((b) => b.span.startMinute);
    const b = layoutDay(items, '2026-07-15').map((x) => x.span.startMinute);
    expect(a).toEqual(b);
    expect(a).toEqual([540, 600]);
  });
});

describe('byDay', () => {
  it('lists an event under every day it touches', () => {
    const trip = {
      startsAt: londonInstant('2026-07-15', '18:00').toISOString(),
      endsAt: londonInstant('2026-07-17', '11:00').toISOString(),
      allDay: false,
    };
    const map = byDay([trip], ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18']);
    expect(map.get('2026-07-14')).toHaveLength(0);
    expect(map.get('2026-07-15')).toHaveLength(1);
    expect(map.get('2026-07-16')).toHaveLength(1);
    expect(map.get('2026-07-17')).toHaveLength(1);
    expect(map.get('2026-07-18')).toHaveLength(0);
  });

  it('sorts all-day items above timed ones', () => {
    const items = [ev('2026-07-15', '09:00', '10:00'), ev('2026-07-15', '00:00', '00:00', true)];
    expect(byDay(items, ['2026-07-15']).get('2026-07-15')![0]!.allDay).toBe(true);
  });
});

describe('hourLines', () => {
  it('labels 23 lines on an ordinary day', () => {
    const lines = hourLines('2026-07-15');
    expect(lines).toHaveLength(23);
    expect(lines[0]).toMatchObject({ label: '01:00' });
    expect(lines[22]).toMatchObject({ label: '23:00' });
  });

  it('labels the repeated hour twice on 25 October rather than inventing 24:00', () => {
    const labels = hourLines('2026-10-25').map((l) => l.label);
    expect(labels).toHaveLength(24);
    expect(labels.filter((l) => l === '01:00')).toHaveLength(2);
    expect(labels).not.toContain('24:00');
  });

  it('skips the hour that does not exist on 29 March', () => {
    const labels = hourLines('2026-03-29').map((l) => l.label);
    expect(labels).toHaveLength(22);
    expect(labels).not.toContain('01:00');
    expect(labels[0]).toBe('02:00');
  });
});

describe('scrollToMinute', () => {
  it('opens at 06:30 when the day starts later than that', () => {
    expect(scrollToMinute([ev('2026-07-15', '09:00', '10:00')], '2026-07-15')).toBe(390);
  });

  it('opens earlier when something starts before 07:00', () => {
    expect(scrollToMinute([ev('2026-07-15', '05:00', '06:00')], '2026-07-15')).toBe(270);
  });

  it('ignores all-day items, which are not in the grid', () => {
    expect(
      scrollToMinute([ev('2026-07-15', '00:00', '00:00', true)], '2026-07-15'),
    ).toBe(390);
  });

  /**
   * Now wins over the first event whenever the day being shown is today. This
   * is what stops the grid opening on seven empty night hours, which on a phone
   * was the whole screen. Half an hour of headroom is kept above it, because
   * arriving at 14:05 you nearly always want to see what 13:30 was.
   */
  describe('when today is the day on screen', () => {
    it('opens half an hour before now, not at the first event', () => {
      const now = londonInstant('2026-07-15', '14:05');
      expect(scrollToMinute([ev('2026-07-15', '09:00', '10:00')], '2026-07-15', now))
        .toBe(13 * 60 + 35);
    });

    it('does not scroll above the top of the day in the small hours', () => {
      expect(
        scrollToMinute(
          [ev('2026-07-15', '09:00', '10:00')],
          '2026-07-15',
          londonInstant('2026-07-15', '00:10'),
        ),
      ).toBe(0);
    });

    it('opens at now even when nothing is on that day at all', () => {
      expect(scrollToMinute([], '2026-07-15', londonInstant('2026-07-15', '16:00')))
        .toBe(15 * 60 + 30);
    });

    it('ignores a `now` belonging to a different day, and falls back to the events', () => {
      expect(
        scrollToMinute(
          [ev('2026-07-15', '09:00', '10:00')],
          '2026-07-15',
          londonInstant('2026-07-16', '14:00'),
        ),
      ).toBe(390);
    });

    it('falls back to the events when no clock is given at all', () => {
      expect(scrollToMinute([ev('2026-07-15', '09:00', '10:00')], '2026-07-15', null))
        .toBe(390);
    });

    /**
     * Minutes are measured from London midnight, so on the 25-hour day in
     * October 14:00 is 900 minutes in rather than 840 — the repeated hour is
     * counted. Getting this wrong would put the grid an hour off on exactly
     * one day a year, which is the kind of bug nobody finds until October.
     */
    it('counts the repeated hour on the 25-hour day', () => {
      expect(scrollToMinute([], '2026-10-25', londonInstant('2026-10-25', '14:00')))
        .toBe(15 * 60 - 30);
    });

    it('counts the missing hour on the 23-hour day', () => {
      expect(scrollToMinute([], '2026-03-29', londonInstant('2026-03-29', '14:00')))
        .toBe(13 * 60 - 30);
    });
  });
});
