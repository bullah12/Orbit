import { describe, expect, it } from 'vitest';
import {
  dayFraction,
  departBy,
  deriveLegs,
  estimateLegMinutes,
  fitsInGap,
  haversineMetres,
  LEG_MODES,
  MODE_BUFFER_MINUTES,
  planLeg,
  providerModeFor,
  sessionDayCount,
  sessionFromEvent,
  sessionIsActive,
  type TravelEvent,
  tripStanding,
} from '@/lib/travel';
import { londonInstant } from '@/lib/format';

/**
 * Travel maths.
 *
 * The two clock changes in 2026 are Sunday 29 March (01:00 GMT → 02:00 BST, a
 * 23-hour day) and Sunday 25 October (02:00 BST → 01:00 GMT, a 25-hour day).
 * Both appear below, because both are where this is wrong if it is wrong.
 */

const HOME = { id: 'p-home', name: 'Home — Kings Heath', lat: 52.4361, lon: -1.8919 };

function event(over: Partial<TravelEvent> & Pick<TravelEvent, 'id'>): TravelEvent {
  return {
    title: 'Event',
    spaceId: 'space-home',
    startsAt: '2026-05-05T09:00:00.000Z',
    endsAt: '2026-05-05T10:00:00.000Z',
    allDay: false,
    placeId: null,
    placeName: null,
    placeLat: null,
    placeLon: null,
    ...over,
  };
}

describe('mode mapping', () => {
  it('maps every stored mode to a provider mode or to nothing, with no gaps', () => {
    for (const mode of LEG_MODES) {
      const provider = providerModeFor(mode);
      expect(provider === null || ['walk', 'cycle', 'drive', 'transit'].includes(provider)).toBe(true);
    }
  });

  it('sends bus and train to transit, which the fake answers and ORS refuses', () => {
    expect(providerModeFor('bus')).toBe('transit');
    expect(providerModeFor('train')).toBe('transit');
  });

  it('refuses to route a flight rather than returning a driving time', () => {
    expect(providerModeFor('plane')).toBeNull();
    expect(providerModeFor('other')).toBeNull();
  });

  it('has a buffer for every mode', () => {
    for (const mode of LEG_MODES) {
      expect(MODE_BUFFER_MINUTES[mode]).toBeDefined();
    }
  });
});

describe('planLeg', () => {
  it('adds the mode buffers to the moving part', () => {
    const plan = planLeg(20, 'car');
    expect(plan.travelMinutes).toBe(20);
    expect(plan.bufferBefore).toBe(3);
    expect(plan.bufferAfter).toBe(5);
    expect(plan.doorToDoorMinutes).toBe(28);
  });

  it('leaves walking alone — there is nothing to park', () => {
    expect(planLeg(12, 'walk').doorToDoorMinutes).toBe(12);
  });

  it('rounds and never goes negative', () => {
    expect(planLeg(-5, 'walk').travelMinutes).toBe(0);
    expect(planLeg(9.6, 'walk').travelMinutes).toBe(10);
  });

  it('a flight is mostly not flying', () => {
    expect(planLeg(60, 'plane').doorToDoorMinutes).toBe(180);
  });
});

describe('departBy', () => {
  it('subtracts the whole door-to-door time', () => {
    const arrive = londonInstant('2026-05-05', '09:00');
    const leave = departBy(arrive, planLeg(20, 'car'));
    expect(leave.toISOString()).toBe('2026-05-05T07:32:00.000Z');
  });

  it('crosses the spring-forward hour without losing an hour', () => {
    // 29 March 2026: 01:00 GMT becomes 02:00 BST. Arriving at 09:00 BST is
    // 08:00 UTC; leaving 90 minutes earlier is 06:30 UTC, which is 07:30 BST.
    const arrive = londonInstant('2026-03-29', '09:00');
    expect(arrive.toISOString()).toBe('2026-03-29T08:00:00.000Z');
    const leave = departBy(arrive, planLeg(90, 'walk'));
    expect(leave.toISOString()).toBe('2026-03-29T06:30:00.000Z');
  });

  it('a journey that starts before the clocks go forward and ends after is shorter on the clock', () => {
    // Leaving at 00:30 GMT and travelling 90 real minutes lands at 03:00 BST:
    // the wall clock advanced 150 minutes because an hour did not exist.
    const arrive = londonInstant('2026-03-29', '03:00');
    const leave = departBy(arrive, planLeg(90, 'walk'));
    expect(leave.toISOString()).toBe('2026-03-29T00:30:00.000Z');
    const wallMinutes =
      (Date.parse('2026-03-29T02:00:00.000Z') - leave.getTime()) / 60_000;
    expect(wallMinutes).toBe(90);
  });

  it('crosses the autumn repeat, where the wall clock moves less than the journey', () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT. 01:30 happens twice and
    // londonInstant takes the second (GMT) one, so this is 01:30 UTC.
    const arrive = londonInstant('2026-10-25', '01:30');
    expect(arrive.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    const leave = departBy(arrive, planLeg(120, 'car'));
    // 128 door-to-door minutes back from 01:30 UTC is 23:22 UTC = 00:22 BST.
    expect(leave.toISOString()).toBe('2026-10-24T23:22:00.000Z');
  });
});

describe('fitsInGap', () => {
  const plan = planLeg(20, 'car'); // 28 door to door

  it('reports slack when there is plenty of room', () => {
    const verdict = fitsInGap(
      londonInstant('2026-05-05', '10:00'),
      londonInstant('2026-05-05', '11:00'),
      plan,
    );
    expect(verdict.gapMinutes).toBe(60);
    expect(verdict.slackMinutes).toBe(32);
    expect(verdict.feasibility).toBe('comfortable');
  });

  it('calls a small margin tight rather than fine', () => {
    const verdict = fitsInGap(
      londonInstant('2026-05-05', '10:00'),
      londonInstant('2026-05-05', '10:35'),
      plan,
    );
    expect(verdict.slackMinutes).toBe(7);
    expect(verdict.feasibility).toBe('tight');
  });

  it('calls an impossible journey impossible, with the shortfall', () => {
    const verdict = fitsInGap(
      londonInstant('2026-05-05', '10:00'),
      londonInstant('2026-05-05', '10:15'),
      plan,
    );
    expect(verdict.slackMinutes).toBe(-13);
    expect(verdict.feasibility).toBe('impossible');
  });

  it('a gap that spans the spring-forward hour is an hour shorter than the clock says', () => {
    // 00:30 to 03:00 on 29 March looks like 150 minutes and is 90.
    const verdict = fitsInGap(
      londonInstant('2026-03-29', '00:30'),
      londonInstant('2026-03-29', '03:00'),
      planLeg(100, 'walk'),
    );
    expect(verdict.gapMinutes).toBe(90);
    expect(verdict.feasibility).toBe('impossible');
  });

  it('a gap that spans the autumn repeat is an hour longer than the clock says', () => {
    // 00:30 BST to 02:00 GMT on 25 October looks like 90 minutes and is 150.
    const verdict = fitsInGap(
      '2026-10-24T23:30:00.000Z',
      londonInstant('2026-10-25', '02:00'),
      planLeg(100, 'walk'),
    );
    expect(verdict.gapMinutes).toBe(150);
    expect(verdict.feasibility).toBe('comfortable');
  });
});

describe('deriveLegs', () => {
  it('makes a leg between two events at different places', () => {
    const legs = deriveLegs([
      event({
        id: 'a', startsAt: '2026-05-05T08:00:00.000Z', endsAt: '2026-05-05T09:00:00.000Z',
        placeId: 'p1', placeName: 'Home', placeLat: 52.4361, placeLon: -1.8919,
      }),
      event({
        id: 'b', startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z',
        placeId: 'p2', placeName: 'Symphony Hall', placeLat: 52.479, placeLon: -1.909,
      }),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.fromPlaceName).toBe('Home');
    expect(legs[0]!.toPlaceName).toBe('Symphony Hall');
    expect(legs[0]!.leaveAfter).toBe('2026-05-05T09:00:00.000Z');
    expect(legs[0]!.arriveBy).toBe('2026-05-05T10:00:00.000Z');
    expect(legs[0]!.needsCoordinates).toBe(false);
    expect(legs[0]!.metres).toBeGreaterThan(4000);
  });

  it('makes no leg when two consecutive events are at the same place', () => {
    const legs = deriveLegs([
      event({ id: 'a', placeId: 'p1', placeName: 'Home', startsAt: '2026-05-05T08:00:00.000Z', endsAt: '2026-05-05T09:00:00.000Z' }),
      event({ id: 'b', placeId: 'p1', placeName: 'Home', startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z' }),
    ]);
    expect(legs).toHaveLength(0);
  });

  it('ignores an event with no place, and does not let it break the chain', () => {
    const legs = deriveLegs([
      event({ id: 'a', placeId: 'p1', placeName: 'Home', startsAt: '2026-05-05T08:00:00.000Z', endsAt: '2026-05-05T09:00:00.000Z' }),
      event({ id: 'b', startsAt: '2026-05-05T09:30:00.000Z', endsAt: '2026-05-05T09:45:00.000Z' }),
      event({ id: 'c', placeId: 'p2', placeName: 'Park', startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z' }),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.fromEventId).toBe('a');
    expect(legs[0]!.toEventId).toBe('c');
  });

  it('ignores all-day events — being somewhere all day is a session, not a leg', () => {
    const legs = deriveLegs([
      event({ id: 'a', allDay: true, placeId: 'p1', placeName: 'Manchester' }),
      event({ id: 'b', placeId: 'p2', placeName: 'Park', startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z' }),
    ]);
    expect(legs).toHaveLength(0);
  });

  it('sorts by start instant rather than trusting the order it was handed', () => {
    const legs = deriveLegs([
      event({ id: 'late', placeId: 'p2', placeName: 'Second', startsAt: '2026-05-05T14:00:00.000Z', endsAt: '2026-05-05T15:00:00.000Z' }),
      event({ id: 'early', placeId: 'p1', placeName: 'First', startsAt: '2026-05-05T08:00:00.000Z', endsAt: '2026-05-05T09:00:00.000Z' }),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.fromPlaceName).toBe('First');
  });

  it('only makes a first leg of the day when it is told where you started', () => {
    const one = event({
      id: 'a', placeId: 'p2', placeName: 'Park', placeLat: 52.4489, placeLon: -1.9006,
      startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z',
    });
    expect(deriveLegs([one])).toHaveLength(0);

    const withStart = deriveLegs([one], { startPlace: HOME });
    expect(withStart).toHaveLength(1);
    expect(withStart[0]!.fromEventId).toBeNull();
    expect(withStart[0]!.fromPlaceName).toBe('Home — Kings Heath');
    // Free to leave from midnight of the day the first event falls in.
    expect(withStart[0]!.leaveAfter).toBe('2026-05-04T23:00:00.000Z');
  });

  it('flags a leg whose ends have no coordinates instead of inventing a distance', () => {
    const legs = deriveLegs([
      event({ id: 'a', placeId: 'p1', placeName: 'Home', startsAt: '2026-05-05T08:00:00.000Z', endsAt: '2026-05-05T09:00:00.000Z' }),
      event({ id: 'b', placeId: 'p2', placeName: 'Nowhere', startsAt: '2026-05-05T10:00:00.000Z', endsAt: '2026-05-05T11:00:00.000Z' }),
    ]);
    expect(legs[0]!.needsCoordinates).toBe(true);
    expect(legs[0]!.metres).toBeNull();
  });

  it('derives across the spring-forward morning with the real gap, not the clock gap', () => {
    // Ends 00:45 GMT, starts 03:00 BST. The clock says 135 minutes; it is 75.
    const legs = deriveLegs([
      event({
        id: 'a', placeId: 'p1', placeName: 'Home', placeLat: 52.4361, placeLon: -1.8919,
        startsAt: '2026-03-29T00:00:00.000Z', endsAt: '2026-03-29T00:45:00.000Z',
      }),
      event({
        id: 'b', placeId: 'p2', placeName: 'Airport', placeLat: 52.4539, placeLon: -1.7480,
        startsAt: '2026-03-29T02:00:00.000Z', endsAt: '2026-03-29T04:00:00.000Z',
      }),
    ]);
    expect(legs).toHaveLength(1);
    const verdict = fitsInGap(legs[0]!.leaveAfter, legs[0]!.arriveBy, planLeg(30, 'car'));
    expect(verdict.gapMinutes).toBe(75);
    expect(verdict.feasibility).toBe('comfortable');
  });

  it('derives across the autumn repeat, where an hour is given back', () => {
    // Ends 01:00 BST (00:00 UTC), starts 01:30 GMT (01:30 UTC): 90 real minutes
    // for what the wall clock calls 30.
    const legs = deriveLegs([
      event({
        id: 'a', placeId: 'p1', placeName: 'Gig', placeLat: 52.4361, placeLon: -1.8919,
        startsAt: '2026-10-24T22:00:00.000Z', endsAt: '2026-10-25T00:00:00.000Z',
      }),
      event({
        id: 'b', placeId: 'p2', placeName: 'Home', placeLat: 52.4489, placeLon: -1.9006,
        startsAt: '2026-10-25T01:30:00.000Z', endsAt: '2026-10-25T02:00:00.000Z',
      }),
    ]);
    const verdict = fitsInGap(legs[0]!.leaveAfter, legs[0]!.arriveBy, planLeg(45, 'car'));
    expect(verdict.gapMinutes).toBe(90);
    expect(verdict.slackMinutes).toBe(37);
  });
});

describe('distance and the crude estimate', () => {
  it('agrees with the fake provider about Birmingham distances', () => {
    const metres = haversineMetres({ lat: 52.4361, lon: -1.8919 }, { lat: 52.479, lon: -1.909 });
    expect(metres).toBeGreaterThan(4700);
    expect(metres).toBeLessThan(5000);
  });

  it('is zero for the same point', () => {
    expect(haversineMetres({ lat: 52.4, lon: -1.9 }, { lat: 52.4, lon: -1.9 })).toBe(0);
  });

  it('walking is slower than driving over the same distance', () => {
    expect(estimateLegMinutes(5000, 'walk')).toBeGreaterThan(estimateLegMinutes(5000, 'car'));
  });

  it('never returns zero minutes for a real distance', () => {
    expect(estimateLegMinutes(50, 'car')).toBe(1);
  });

  it('does not apply a road detour factor to a flight', () => {
    const direct = estimateLegMinutes(700_000, 'plane');
    expect(direct).toBe(60);
  });
});

describe('sessionFromEvent', () => {
  it('makes nothing from an ordinary event', () => {
    expect(sessionFromEvent(event({ id: 'a' }))).toBeNull();
  });

  it('makes a session from a multi-day all-day event', () => {
    // An all-day event on the 3rd and 4th ends at midnight starting the 5th.
    const draft = sessionFromEvent(
      event({
        id: 'a', title: 'Manchester', allDay: true,
        startsAt: londonInstant('2026-05-03', '00:00').toISOString(),
        endsAt: londonInstant('2026-05-05', '00:00').toISOString(),
        placeId: 'p9',
      }),
    );
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe('Manchester');
    expect(draft!.source).toBe('calendar');
    expect(draft!.destinationPlaceId).toBe('p9');
    expect(draft!.startsAt).toBe(londonInstant('2026-05-03', '00:00').toISOString());
    expect(draft!.endsAt).toBe(londonInstant('2026-05-04', '23:59').toISOString());
  });

  it('makes nothing from a single all-day event', () => {
    expect(
      sessionFromEvent(
        event({
          id: 'a', allDay: true,
          startsAt: londonInstant('2026-05-03', '00:00').toISOString(),
          endsAt: londonInstant('2026-05-04', '00:00').toISOString(),
        }),
      ),
    ).toBeNull();
  });

  it('calls a gig that runs past midnight a late night, not a trip', () => {
    expect(
      sessionFromEvent(
        event({
          id: 'a',
          startsAt: londonInstant('2026-05-03', '22:00').toISOString(),
          endsAt: londonInstant('2026-05-04', '02:00').toISOString(),
        }),
      ),
    ).toBeNull();
  });

  it('but a timed event that ends the next afternoon is a trip', () => {
    const draft = sessionFromEvent(
      event({
        id: 'a',
        startsAt: londonInstant('2026-05-03', '18:00').toISOString(),
        endsAt: londonInstant('2026-05-04', '15:00').toISOString(),
      }),
    );
    expect(draft).not.toBeNull();
    expect(draft!.startsAt).toBe(londonInstant('2026-05-03', '18:00').toISOString());
  });

  it('treats the 23-hour day as one day like any other', () => {
    // 28 March to 29 March, all day: two days, one of them 23 hours long.
    const draft = sessionFromEvent(
      event({
        id: 'a', allDay: true,
        startsAt: londonInstant('2026-03-28', '00:00').toISOString(),
        endsAt: londonInstant('2026-03-30', '00:00').toISOString(),
      }),
    );
    expect(draft).not.toBeNull();
    expect(sessionDayCount(draft!)).toBe(2);
  });

  it('treats the 25-hour day as one day like any other', () => {
    const draft = sessionFromEvent(
      event({
        id: 'a', allDay: true,
        startsAt: londonInstant('2026-10-24', '00:00').toISOString(),
        endsAt: londonInstant('2026-10-26', '00:00').toISOString(),
      }),
    );
    expect(sessionDayCount(draft!)).toBe(2);
  });
});

describe('sessionDayCount and sessionIsActive', () => {
  it('counts both ends', () => {
    expect(
      sessionDayCount({
        startsAt: londonInstant('2026-05-03', '18:00').toISOString(),
        endsAt: londonInstant('2026-05-05', '09:00').toISOString(),
      }),
    ).toBe(3);
  });

  it('is one day for something inside a single day', () => {
    expect(
      sessionDayCount({
        startsAt: londonInstant('2026-05-03', '08:00').toISOString(),
        endsAt: londonInstant('2026-05-03', '23:00').toISOString(),
      }),
    ).toBe(1);
  });

  it('is right across the weekend the clocks go back, where 24h arithmetic is not', () => {
    // 24 to 26 October is three days and 73 hours.
    const session = {
      startsAt: londonInstant('2026-10-24', '00:00').toISOString(),
      endsAt: londonInstant('2026-10-26', '00:00').toISOString(),
    };
    const hours = (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 3_600_000;
    expect(hours).toBe(49);
    expect(sessionDayCount(session)).toBe(3);
  });

  it('knows whether a session is running now', () => {
    const session = {
      startsAt: '2026-05-03T08:00:00.000Z',
      endsAt: '2026-05-05T08:00:00.000Z',
    };
    expect(sessionIsActive(session, new Date('2026-05-04T12:00:00.000Z'))).toBe(true);
    expect(sessionIsActive(session, new Date('2026-05-06T12:00:00.000Z'))).toBe(false);
    expect(sessionIsActive(session, new Date('2026-05-01T12:00:00.000Z'))).toBe(false);
  });
});

describe('dayFraction', () => {
  it('puts midday just past halfway on an ordinary day', () => {
    const f = dayFraction(londonInstant('2026-05-05', '12:00'), '2026-05-05');
    expect(f).toBeCloseTo(0.5, 3);
  });

  it('puts midday past the middle of the 23-hour day', () => {
    // 12:00 BST on 29 March is 660 minutes into a 1380-minute day.
    const f = dayFraction(londonInstant('2026-03-29', '12:00'), '2026-03-29');
    expect(f).toBeCloseTo(660 / 1380, 4);
    expect(f).toBeGreaterThan(0.47);
  });

  it('puts midday before the middle of the 25-hour day', () => {
    // 12:00 GMT on 25 October is 780 minutes into a 1500-minute day.
    const f = dayFraction(londonInstant('2026-10-25', '12:00'), '2026-10-25');
    expect(f).toBeCloseTo(780 / 1500, 4);
  });

  it('clamps to the day it is drawn against', () => {
    expect(dayFraction(londonInstant('2026-05-04', '12:00'), '2026-05-05')).toBe(0);
    expect(dayFraction(londonInstant('2026-05-06', '12:00'), '2026-05-05')).toBe(1);
  });
});

/**
 * Where a trip stands.
 *
 * This is the sentence a trip's own page opens with, and it is derived from the
 * dates every single time rather than read from `travel_sessions.is_active`. The
 * column is a cache written from the dates at every write; nothing sweeps it and
 * Orbit has no scheduler by decision, so it goes stale the moment a trip ends
 * while a date range never can. These cases pin the derivation, including on the
 * two days a year when 24-hour arithmetic gives the wrong answer.
 */
describe('where a trip stands', () => {
  const trip = (from: string, to: string) => ({
    startsAt: londonInstant(from, '00:00').toISOString(),
    endsAt: londonInstant(to, '23:59').toISOString(),
  });
  const at = (day: string, time: string) => londonInstant(day, time);

  it('is running while it is running, and counts no days away', () => {
    const s = tripStanding(trip('2026-05-03', '2026-05-07'), at('2026-05-05', '12:00'));
    expect(s).toEqual({ phase: 'running', days: 5, daysAway: 0 });
  });

  it('is running on its first and last day, both ends inclusive', () => {
    expect(tripStanding(trip('2026-05-03', '2026-05-07'), at('2026-05-03', '00:30')).phase).toBe('running');
    expect(tripStanding(trip('2026-05-03', '2026-05-07'), at('2026-05-07', '23:00')).phase).toBe('running');
  });

  it('counts whole days until an upcoming trip starts', () => {
    const s = tripStanding(trip('2026-05-10', '2026-05-12'), at('2026-05-07', '18:00'));
    expect(s.phase).toBe('upcoming');
    expect(s.daysAway).toBe(3);
    expect(s.days).toBe(3);
  });

  it('says one day away for a trip starting tomorrow, whatever the time of day', () => {
    expect(tripStanding(trip('2026-05-08', '2026-05-09'), at('2026-05-07', '00:05')).daysAway).toBe(1);
    expect(tripStanding(trip('2026-05-08', '2026-05-09'), at('2026-05-07', '23:55')).daysAway).toBe(1);
  });

  it('counts whole days since a past trip ended', () => {
    const s = tripStanding(trip('2026-05-01', '2026-05-04'), at('2026-05-07', '09:00'));
    expect(s.phase).toBe('past');
    expect(s.daysAway).toBe(3);
    expect(s.days).toBe(4);
  });

  it('is past, zero days away, on the day a trip ended', () => {
    // 23:59 on the 4th has gone; it is still the 4th.
    const s = tripStanding(trip('2026-05-01', '2026-05-04'), londonInstant('2026-05-04', '23:59:30'));
    expect(s.phase).toBe('past');
    expect(s.daysAway).toBe(0);
  });

  it('counts days across the spring clock change, where 24-hour arithmetic is out', () => {
    // 27 to 30 March 2026: one of those days is 23 hours long.
    const s = tripStanding(trip('2026-03-30', '2026-03-31'), at('2026-03-27', '12:00'));
    expect(s.phase).toBe('upcoming');
    expect(s.daysAway).toBe(3);
  });

  it('counts days across the autumn clock change too', () => {
    // 24 to 27 October 2026: one of those days is 25 hours long.
    const s = tripStanding(trip('2026-10-23', '2026-10-24'), at('2026-10-27', '12:00'));
    expect(s.phase).toBe('past');
    expect(s.daysAway).toBe(3);
  });

  it('agrees with sessionIsActive, which is what the stored column was set from', () => {
    const s = trip('2026-05-03', '2026-05-07');
    for (const day of ['2026-05-01', '2026-05-03', '2026-05-05', '2026-05-07', '2026-05-09']) {
      const now = at(day, '12:00');
      expect(tripStanding(s, now).phase === 'running').toBe(sessionIsActive(s, now));
    }
  });
});
