import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import { listCalendarItems, type CalendarItem, type EventRow } from '@/lib/queries/events';
import { londonMidnight, addDaysISO } from '@/lib/format';
import type { LegMode } from '@/lib/travel';
import type { TravelEvent } from '@/lib/travel';

/**
 * Travel legs and travel sessions.
 *
 * Both are space-scoped and both are read through RLS like everything else —
 * there is no "all my travel across every space" query that reaches past a
 * policy. A leg between two spaces' places is simply a leg in whichever space
 * it was created in.
 */

export type TravelLegRow = {
  id: string;
  mode: LegMode;
  departAt: string | null;
  arriveAt: string | null;
  durationMinutes: number | null;
  distanceMetres: number | null;
  estimateSource: string;
  estimatedAt: string | null;
  notesMd: string;
  fromPlaceId: string | null;
  fromPlaceName: string | null;
  toPlaceId: string | null;
  toPlaceName: string | null;
  eventId: string | null;
  eventTitle: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  space: SpaceRef;
};

const LEG_SELECT = `
  l.id,
  l.mode,
  l.depart_at        as "departAt",
  l.arrive_at        as "arriveAt",
  l.duration_minutes as "durationMinutes",
  l.distance_metres  as "distanceMetres",
  l.estimate_source  as "estimateSource",
  l.estimated_at     as "estimatedAt",
  l.notes_md         as "notesMd",
  l.from_place_id    as "fromPlaceId",
  fp.name            as "fromPlaceName",
  l.to_place_id      as "toPlaceId",
  tp.name            as "toPlaceName",
  l.event_id         as "eventId",
  e.title            as "eventTitle",
  l.session_id       as "sessionId",
  ts.title           as "sessionTitle",
  jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                     'colour', s.colour, 'icon', s.icon) as space
`;

const LEG_FROM = `
  from public.travel_legs l
  join public.spaces s on s.id = l.space_id
  left join public.places fp on fp.id = l.from_place_id
  left join public.places tp on tp.id = l.to_place_id
  left join public.events e on e.id = l.event_id
  left join public.travel_sessions ts on ts.id = l.session_id
`;

/** Legs departing on one London day. A leg with no departure time is listed last. */
export async function listLegsOnDay(userId: string, day: string): Promise<TravelLegRow[]> {
  const from = londonMidnight(day);
  const to = londonMidnight(addDaysISO(day, 1));
  return asUser(userId, async (tx) => {
    return tx<TravelLegRow[]>`
      select ${tx.unsafe(LEG_SELECT)}
      ${tx.unsafe(LEG_FROM)}
      where l.depart_at >= ${from} and l.depart_at < ${to}
      order by l.depart_at
      limit 200
    `;
  });
}

/** Every leg attached to a session, in order. */
export async function listLegsInSession(
  userId: string,
  sessionId: string,
): Promise<TravelLegRow[]> {
  return asUser(userId, async (tx) => {
    return tx<TravelLegRow[]>`
      select ${tx.unsafe(LEG_SELECT)}
      ${tx.unsafe(LEG_FROM)}
      where l.session_id = ${sessionId}::uuid
      order by l.depart_at nulls last
      limit 200
    `;
  });
}

export type TravelSessionRow = {
  id: string;
  title: string;
  source: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isActive: boolean;
  notesMd: string;
  eventId: string | null;
  originPlaceId: string | null;
  originPlaceName: string | null;
  destinationPlaceId: string | null;
  destinationPlaceName: string | null;
  legCount: number;
  space: SpaceRef;
};

export async function listTravelSessions(userId: string): Promise<TravelSessionRow[]> {
  return asUser(userId, async (tx) => {
    return tx<TravelSessionRow[]>`
      select
        t.id, t.title, t.source, t.starts_at as "startsAt", t.ends_at as "endsAt",
        t.timezone, t.is_active as "isActive", t.notes_md as "notesMd",
        t.event_id as "eventId",
        t.origin_place_id as "originPlaceId", op.name as "originPlaceName",
        t.destination_place_id as "destinationPlaceId", dp.name as "destinationPlaceName",
        coalesce(lg.n, 0) as "legCount",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.travel_sessions t
      join public.spaces s on s.id = t.space_id
      left join public.places op on op.id = t.origin_place_id
      left join public.places dp on dp.id = t.destination_place_id
      left join lateral (
        select count(*)::int as n from public.travel_legs x where x.session_id = t.id
      ) lg on true
      order by t.starts_at desc
      limit 100
    `;
  });
}

/**
 * One trip, or null — which is also the answer when it belongs to a space you
 * are not in. Not found and not permitted are the same response on purpose:
 * anything else confirms the trip exists.
 */
export async function getTravelSession(
  userId: string,
  id: string,
): Promise<TravelSessionRow | null> {
  return asUser(userId, async (tx) => {
    const rows = await tx<TravelSessionRow[]>`
      select
        t.id, t.title, t.source, t.starts_at as "startsAt", t.ends_at as "endsAt",
        t.timezone, t.is_active as "isActive", t.notes_md as "notesMd",
        t.event_id as "eventId",
        t.origin_place_id as "originPlaceId", op.name as "originPlaceName",
        t.destination_place_id as "destinationPlaceId", dp.name as "destinationPlaceName",
        coalesce(lg.n, 0) as "legCount",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from public.travel_sessions t
      join public.spaces s on s.id = t.space_id
      left join public.places op on op.id = t.origin_place_id
      left join public.places dp on dp.id = t.destination_place_id
      left join lateral (
        select count(*)::int as n from public.travel_legs x where x.session_id = t.id
      ) lg on true
      where t.id = ${id}::uuid
    `;
    return rows[0] ?? null;
  });
}

/**
 * The day's events, reduced to what travel derivation needs.
 *
 * Deliberately built on `listCalendarItems`, which is the one place recurrence
 * is expanded and the one place a `free_busy` space is turned into anonymous
 * blocks. Those blocks are dropped here: an anonymous block has no place and no
 * id, so it cannot be an endpoint, and reaching past the policy to find out
 * where somebody is would be exactly the disclosure the free/busy model exists
 * to prevent.
 */
export async function travelEventsOnDay(userId: string, day: string): Promise<TravelEvent[]> {
  const from = londonMidnight(day);
  const to = londonMidnight(addDaysISO(day, 1));
  const items = await listCalendarItems(userId, from, to);
  return items.filter(isReadableEvent).map(toTravelEvent);
}

/**
 * A block is not an event. `isBusy` is the discriminant, and a locked event has
 * no title or place to reason about, so both are dropped before anything here
 * treats an item as somewhere you went.
 */
function isReadableEvent(item: CalendarItem): item is EventRow {
  return !item.isBusy && !item.isLocked;
}

function toTravelEvent(e: EventRow): TravelEvent {
  return {
    id: e.id,
    title: e.title,
    spaceId: e.space.id,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    placeId: e.placeId,
    placeName: e.placeName,
    placeLat: e.placeLat,
    placeLon: e.placeLon,
  };
}

/**
 * Multi-day events in a window, as candidates for a travel session.
 *
 * Only events that are not already the source of one — offering to create the
 * same session twice is how a list of trips becomes a list of duplicates.
 */
export async function sessionCandidates(
  userId: string,
  fromDay: string,
  toDay: string,
): Promise<TravelEvent[]> {
  const from = londonMidnight(fromDay);
  const to = londonMidnight(toDay);
  const items = await listCalendarItems(userId, from, to);
  const existing = await asUser(userId, async (tx) => {
    const rows = await tx<{ eventId: string }[]>`
      select distinct event_id as "eventId" from public.travel_sessions
      where event_id is not null
    `;
    return new Set(rows.map((r) => r.eventId));
  });

  return items
    .filter((i) => isReadableEvent(i) && !existing.has(i.id))
    .map((i) => toTravelEvent(i as EventRow));
}
