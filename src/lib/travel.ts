/**
 * Travel maths.
 *
 * Pure, like src/lib/recurrence.ts and for the same reason: travel time is a
 * bug farm — clock changes, midnight, overlapping events, missing coordinates —
 * and every one of those is cheap to test here and expensive to test through a
 * page. Nothing in this file touches Postgres, the network or a provider. The
 * provider's job is one number (`TravelTimeProvider.estimate`); everything
 * built on top of that number is here.
 *
 * Decision 5 is load-bearing throughout: a journey is either **manual** — you
 * said so — or **calendar-derived** — two events with places imply a trip
 * between them. There is no third source. No background location, and Orbit
 * never asks for the permission, so there is no function here that takes a
 * position fix.
 *
 * Everything works in instants and in London wall-clock minutes, via
 * `zonedInstant` / `zonedWallClock` / `londonDayMinutes` from format.ts. Nothing
 * here calls getDate(): on 29 March a day is 23 hours long, and arithmetic that
 * assumes 1440 minutes is wrong twice a year in the direction that makes
 * somebody late.
 */

import {
  addDaysISO,
  londonDayISO,
  londonDayMinutes,
  londonMidnight,
  zonedInstant,
  zonedWallClock,
} from '@/lib/format';

/** The modes the database stores. Wider than the provider interface's four. */
export const LEG_MODES = ['walk', 'cycle', 'car', 'bus', 'train', 'plane', 'other'] as const;
export type LegMode = (typeof LEG_MODES)[number];

/** The provider interface's modes. Everything else has to map onto one of these. */
export type ProviderMode = 'walk' | 'cycle' | 'drive' | 'transit';

export const LEG_MODE_LABEL: Record<LegMode, string> = {
  walk: 'Walking',
  cycle: 'Cycling',
  car: 'Driving',
  bus: 'Bus',
  train: 'Train',
  plane: 'Flying',
  other: 'Other',
};

export const LEG_MODE_ICON: Record<LegMode, string> = {
  walk: 'walk',
  cycle: 'bike',
  car: 'car',
  bus: 'bus',
  train: 'train',
  plane: 'plane',
  other: 'route',
};

/**
 * How a stored mode asks the provider.
 *
 * Bus and train both become `transit`, which the fake answers with an average
 * speed and OpenRouteService refuses outright. `plane` and `other` map to
 * nothing: a routing engine's answer for a flight would be a driving time
 * across an ocean, and a confident wrong number is worse than no number.
 */
export function providerModeFor(mode: LegMode): ProviderMode | null {
  switch (mode) {
    case 'walk':
      return 'walk';
    case 'cycle':
      return 'cycle';
    case 'car':
      return 'drive';
    case 'bus':
    case 'train':
      return 'transit';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Buffers and departure times
// ---------------------------------------------------------------------------

/**
 * Minutes to add either side of the moving part, by mode.
 *
 * Door-to-door is not the same as point-to-point: a car has to be parked, a
 * train has to be caught before it leaves. These are deliberately small and
 * deliberately visible — the UI shows the buffer separately from the travel
 * time so that a wrong one is arguable rather than mysterious.
 */
export const MODE_BUFFER_MINUTES: Record<LegMode, { before: number; after: number }> = {
  walk: { before: 0, after: 0 },
  cycle: { before: 2, after: 3 },
  car: { before: 3, after: 5 },
  bus: { before: 5, after: 2 },
  train: { before: 10, after: 5 },
  plane: { before: 90, after: 30 },
  other: { before: 0, after: 0 },
};

export type LegPlan = {
  /** The moving part, as the provider (or a person) reported it. */
  travelMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  /** travelMinutes + both buffers. What actually has to fit in the gap. */
  doorToDoorMinutes: number;
};

export function planLeg(travelMinutes: number, mode: LegMode): LegPlan {
  const travel = Math.max(0, Math.round(travelMinutes));
  const { before, after } = MODE_BUFFER_MINUTES[mode];
  return {
    travelMinutes: travel,
    bufferBefore: before,
    bufferAfter: after,
    doorToDoorMinutes: travel + before + after,
  };
}

/**
 * The instant you have to leave to arrive by `arriveBy`.
 *
 * Subtracting from an instant is safe across a clock change — an instant has no
 * timezone — which is exactly why the whole module works in instants and
 * converts to a wall clock only for display. Leaving at "07:30 minus 90
 * minutes" on 29 March is 05:00 GMT wall-clock and 06:00 BST wall-clock, and
 * both are the same moment; the arithmetic below does not have to know which.
 */
export function departBy(arriveBy: Date | string, plan: LegPlan): Date {
  const arrive = typeof arriveBy === 'string' ? new Date(arriveBy) : arriveBy;
  return new Date(arrive.getTime() - plan.doorToDoorMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// Fitting a journey into the gap between two events
// ---------------------------------------------------------------------------

export type Feasibility = 'comfortable' | 'tight' | 'impossible';

export type GapVerdict = {
  gapMinutes: number;
  plan: LegPlan;
  /** gap − door-to-door. Negative means you cannot get there. */
  slackMinutes: number;
  feasibility: Feasibility;
};

/** Under this much slack, a journey is "tight" rather than comfortable. */
export const TIGHT_SLACK_MINUTES = 10;

/**
 * Does this journey fit between the end of one event and the start of the next?
 *
 * The gap is measured in real elapsed minutes between two instants, so a gap
 * that spans the spring-forward hour is correctly an hour shorter than the wall
 * clock suggests — which is the case where somebody misses something.
 */
export function fitsInGap(
  leaveAfter: Date | string,
  arriveBy: Date | string,
  plan: LegPlan,
): GapVerdict {
  const from = typeof leaveAfter === 'string' ? new Date(leaveAfter) : leaveAfter;
  const to = typeof arriveBy === 'string' ? new Date(arriveBy) : arriveBy;
  const gapMinutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  const slackMinutes = gapMinutes - plan.doorToDoorMinutes;
  return {
    gapMinutes,
    plan,
    slackMinutes,
    feasibility:
      slackMinutes < 0 ? 'impossible' : slackMinutes < TIGHT_SLACK_MINUTES ? 'tight' : 'comfortable',
  };
}

// ---------------------------------------------------------------------------
// Deriving journeys from the calendar
// ---------------------------------------------------------------------------

/** The shape the derivation needs. A subset of an event row, deliberately. */
export type TravelEvent = {
  id: string;
  title: string;
  spaceId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  placeId: string | null;
  placeName: string | null;
  placeLat: number | null;
  placeLon: number | null;
};

export type DerivedLeg = {
  fromEventId: string | null;
  toEventId: string;
  fromPlaceId: string | null;
  toPlaceId: string;
  fromPlaceName: string;
  toPlaceName: string;
  spaceId: string;
  /** When you are free to leave: the end of the previous event, or the day's start. */
  leaveAfter: string;
  /** When you have to be there: the start of the next event. */
  arriveBy: string;
  /** Straight-line metres, when both ends have coordinates. Null otherwise. */
  metres: number | null;
  /** True when either end has no coordinates, so no estimate is possible. */
  needsCoordinates: boolean;
};

/**
 * Journeys implied by a day's events.
 *
 * The rule is deliberately narrow, because a wrong journey in a list is worse
 * than a missing one:
 *  - all-day events are ignored — "in Manchester all Tuesday" is a session,
 *    not a leg;
 *  - an event with no place cannot be an endpoint, and it does not break the
 *    chain either: the journey is from the last *placed* event;
 *  - two consecutive events at the same place imply no journey;
 *  - the first placed event of the day gets a leg only if `startPlace` is
 *    given, because otherwise nobody knows where you started from.
 *
 * Events are sorted by start instant here rather than trusted to arrive
 * sorted — a merged calendar comes from several queries.
 */
export function deriveLegs(
  events: TravelEvent[],
  opts: {
    startPlace?: { id: string; name: string; lat: number | null; lon: number | null } | null;
  } = {},
): DerivedLeg[] {
  const placed = events
    .filter((e) => !e.allDay && e.placeId !== null)
    .slice()
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const legs: DerivedLeg[] = [];
  let previous: {
    id: string | null;
    placeId: string;
    name: string;
    lat: number | null;
    lon: number | null;
    endsAt: string;
  } | null = null;

  if (opts.startPlace && placed[0]) {
    previous = {
      id: null,
      placeId: opts.startPlace.id,
      name: opts.startPlace.name,
      lat: opts.startPlace.lat,
      lon: opts.startPlace.lon,
      // Free to leave from the start of the day the first event falls in.
      endsAt: londonMidnight(londonDayISO(placed[0].startsAt)).toISOString(),
    };
  }

  for (const event of placed) {
    if (previous && previous.placeId !== event.placeId) {
      const bothPlaced =
        previous.lat !== null && previous.lon !== null &&
        event.placeLat !== null && event.placeLon !== null;
      legs.push({
        fromEventId: previous.id,
        toEventId: event.id,
        fromPlaceId: previous.placeId,
        toPlaceId: event.placeId!,
        fromPlaceName: previous.name,
        toPlaceName: event.placeName ?? 'Unnamed place',
        spaceId: event.spaceId,
        leaveAfter: previous.endsAt,
        arriveBy: event.startsAt,
        metres: bothPlaced
          ? haversineMetres(
              { lat: previous.lat!, lon: previous.lon! },
              { lat: event.placeLat!, lon: event.placeLon! },
            )
          : null,
        needsCoordinates: !bothPlaced,
      });
    }
    previous = {
      id: event.id,
      placeId: event.placeId!,
      name: event.placeName ?? 'Unnamed place',
      lat: event.placeLat,
      lon: event.placeLon,
      endsAt: event.endsAt,
    };
  }

  return legs;
}

/**
 * Straight-line metres between two WGS84 points.
 *
 * The same maths the fake travel provider uses, kept here too because deriving
 * a leg has to be able to say "these two places are 400 m apart" without
 * reaching for a provider. Duplication is deliberate and small; the test names
 * both.
 */
export function haversineMetres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * A crude fallback when no provider answer is available.
 *
 * Used for the modes OpenRouteService will not route (`plane`, `other`) and
 * whenever an estimate has to be shown before a provider call. It is labelled
 * as a guess everywhere it appears; the point is that "no idea" is less useful
 * than "about twenty minutes, and we are telling you we guessed".
 */
const KMH: Record<LegMode, number> = {
  walk: 4.8,
  cycle: 15,
  car: 28,
  bus: 18,
  train: 60,
  plane: 700,
  other: 25,
};
const DETOUR = 1.3;

export function estimateLegMinutes(metres: number, mode: LegMode): number {
  const road = metres * (mode === 'plane' ? 1 : DETOUR);
  return Math.max(1, Math.round((road / 1000 / KMH[mode]) * 60));
}

// ---------------------------------------------------------------------------
// Travel sessions — "away from home between these dates"
// ---------------------------------------------------------------------------

export type TravelSessionDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  eventId: string | null;
  destinationPlaceId: string | null;
  source: 'manual' | 'calendar';
};

/**
 * A session implied by a multi-day event.
 *
 * Decision 5 again: a session is created by hand or derived from the calendar,
 * and nothing else creates one. The threshold is "spans more than one London
 * day", not "longer than 24 hours" — an all-day event on the 3rd and the 4th is
 * a trip; a 22:00–02:00 gig is not, even though the second crosses midnight.
 *
 * `londonDayISO` is what decides, so the 23-hour and 25-hour days count as one
 * day like every other.
 */
export function sessionFromEvent(event: TravelEvent): TravelSessionDraft | null {
  const firstDay = londonDayISO(event.startsAt);
  // An all-day event's end is the London midnight *after* its last day, so the
  // last day it actually covers is one before that. A timed event ends when it
  // ends.
  const rawLastDay = londonDayISO(event.endsAt);
  const lastDay = event.allDay ? addDaysISO(rawLastDay, -1) : rawLastDay;
  if (lastDay <= firstDay) return null;

  // A timed event that runs past midnight is a late night, not a trip.
  if (!event.allDay) {
    const nights = Math.round(
      (londonMidnight(lastDay).getTime() - londonMidnight(firstDay).getTime()) / 86_400_000,
    );
    const { time } = zonedWallClock(event.endsAt);
    if (nights === 1 && time < '06:00:00') return null;
  }

  return {
    title: event.title,
    startsAt: event.allDay ? londonMidnight(firstDay).toISOString() : event.startsAt,
    endsAt: event.allDay ? zonedInstant(lastDay, '23:59').toISOString() : event.endsAt,
    eventId: event.id,
    destinationPlaceId: event.placeId,
    source: 'calendar',
  };
}

/** Is this session running at this instant? Inclusive of both ends. */
export function sessionIsActive(
  session: { startsAt: string; endsAt: string },
  now: Date = new Date(),
): boolean {
  const t = now.getTime();
  return t >= Date.parse(session.startsAt) && t <= Date.parse(session.endsAt);
}

/**
 * How many London days a session covers, counting both ends.
 *
 * Not `(end − start) / 86 400 000`: on the weekend the clocks change that is
 * out by an hour and rounds to the wrong number of days. Counting midnights is
 * right on all 365 of them.
 */
export function sessionDayCount(session: { startsAt: string; endsAt: string }): number {
  const first = londonDayISO(session.startsAt);
  const last = londonDayISO(session.endsAt);
  let days = 1;
  for (let d = first; d < last; d = addDaysISO(d, 1)) days += 1;
  return days;
}

/**
 * Minutes from London midnight, for a bar drawn against a day.
 *
 * Clamped to the day's own length, which is 1380 minutes on 29 March 2026 and
 * 1500 on 25 October — the same rule the calendar grid follows, and the same
 * reason.
 */
export function dayFraction(instant: string | Date, day: string): number {
  const t = typeof instant === 'string' ? new Date(instant) : instant;
  const start = londonMidnight(day);
  const length = londonDayMinutes(day);
  const minutes = (t.getTime() - start.getTime()) / 60_000;
  return Math.max(0, Math.min(1, minutes / length));
}
