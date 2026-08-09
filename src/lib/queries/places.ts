import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';

/**
 * Places.
 *
 * Coordinates live in a PostGIS `geography(Point, 4326)` column and come out as
 * two numbers here — nothing above this module handles WKB, and nothing below it
 * handles a `{ lat, lon }` pair. `geocodedAt` being null is a legitimate steady
 * state: a place typed in by hand and never geocoded is a normal place.
 *
 * There is no location column anywhere in this file. Decision 5: Travel Mode is
 * manual and calendar-derived only, and we never ask for the permission.
 */

export type PlaceRow = {
  id: string;
  name: string;
  addressText: string | null;
  postcode: string | null;
  city: string | null;
  countryCode: string;
  notesMd: string;
  visibility: string;
  isLocked: boolean;
  lat: number | null;
  lon: number | null;
  geocodedAt: string | null;
  geocodeSource: string | null;
  archivedAt: string | null;
  updatedAt: string;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  visitCount: number;
  eventCount: number;
};

const PLACE_SELECT = `
  pl.id,
  pl.name,
  pl.address_text  as "addressText",
  pl.postcode,
  pl.city,
  pl.country_code  as "countryCode",
  pl.notes_md      as "notesMd",
  pl.visibility::text as visibility,
  pl.is_locked     as "isLocked",
  ST_Y(pl.geom::geometry) as lat,
  ST_X(pl.geom::geometry) as lon,
  pl.geocoded_at   as "geocodedAt",
  pl.geocode_source as "geocodeSource",
  pl.archived_at   as "archivedAt",
  pl.updated_at    as "updatedAt",
  jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                     'colour', s.colour, 'icon', s.icon) as space,
  case when c.id is null then null else
    jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category
`;

export async function listPlaces(
  userId: string,
  opts: { spaceId?: string | null; query?: string; includeArchived?: boolean } = {},
): Promise<PlaceRow[]> {
  const { spaceId = null, query = '', includeArchived = false } = opts;
  const q = query.trim();

  return asUser(userId, async (tx) => {
    return tx<PlaceRow[]>`
      select
        ${tx.unsafe(PLACE_SELECT)},
        coalesce(v.n, 0) as "visitCount",
        coalesce(e.n, 0) as "eventCount"
      from orbit.places pl
      join orbit.spaces s on s.id = pl.space_id
      left join orbit.categories c on c.id = pl.category_id
      left join lateral (
        select count(*)::int as n from orbit.place_visits x where x.place_id = pl.id
      ) v on true
      left join lateral (
        select count(*)::int as n from orbit.events x
         where x.place_id = pl.id and x.status <> 'cancelled'
      ) e on true
      where ${includeArchived ? tx`true` : tx`pl.archived_at is null`}
        ${spaceId ? tx`and pl.space_id = ${spaceId}::uuid` : tx``}
        ${
          q
            ? tx`and (pl.name ilike ${'%' + q + '%'}
                   or pl.address_text ilike ${'%' + q + '%'}
                   or pl.postcode ilike ${'%' + q + '%'})`
            : tx``
        }
      order by pl.name
      limit 400
    `;
  });
}

export type PlaceVisit = {
  id: string;
  source: string;
  arrivedAt: string;
  departedAt: string | null;
  notesMd: string;
  eventId: string | null;
  eventTitle: string | null;
};

export type PlaceEvent = {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  space: SpaceRef;
};

export type PlaceNote = { id: string; title: string; updatedAt: string };

/**
 * People associated with a place.
 *
 * There is no person↔place table and adding one would be a schema change for a
 * feature that does not need it: the honest association is "people who were at
 * an event here", which the attendee rows already say. It is derived, and the
 * page says it is derived rather than implying somebody recorded it.
 */
export type PlacePerson = { id: string; displayName: string; times: number; space: SpaceRef };

export async function getPlace(
  userId: string,
  id: string,
): Promise<{
  place: PlaceRow;
  visits: PlaceVisit[];
  events: PlaceEvent[];
  notes: PlaceNote[];
  people: PlacePerson[];
} | null> {
  return asUser(userId, async (tx) => {
    const rows = await tx<PlaceRow[]>`
      select ${tx.unsafe(PLACE_SELECT)}, 0 as "visitCount", 0 as "eventCount"
      from orbit.places pl
      join orbit.spaces s on s.id = pl.space_id
      left join orbit.categories c on c.id = pl.category_id
      where pl.id = ${id}::uuid
    `;
    const place = rows[0];
    if (!place) return null;

    const visits = await tx<PlaceVisit[]>`
      select v.id, v.source, v.arrived_at as "arrivedAt", v.departed_at as "departedAt",
             v.notes_md as "notesMd", v.event_id as "eventId", e.title as "eventTitle"
      from orbit.place_visits v
      left join orbit.events e on e.id = v.event_id
      where v.place_id = ${id}::uuid
      order by v.arrived_at desc
      limit 50
    `;

    const events = await tx<PlaceEvent[]>`
      select e.id, e.title, e.starts_at as "startsAt", e.all_day as "allDay",
             jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                                'colour', s.colour, 'icon', s.icon) as space
      from orbit.events e
      join orbit.spaces s on s.id = e.space_id
      where e.place_id = ${id}::uuid and e.status <> 'cancelled'
      order by e.starts_at desc
      limit 25
    `;

    const notes = await tx<PlaceNote[]>`
      select n.id, n.title, n.updated_at as "updatedAt"
      from orbit.note_links nl
      join orbit.notes n on n.id = nl.note_id
      where nl.entity_kind = 'place' and nl.entity_id = ${id}::uuid
        and n.archived_at is null and not n.is_locked
      order by n.updated_at desc
      limit 25
    `;

    const people = await tx<PlacePerson[]>`
      select p.id, p.display_name as "displayName", count(*)::int as times,
             jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                                'colour', s.colour, 'icon', s.icon) as space
      from orbit.event_attendees a
      join orbit.events e on e.id = a.event_id
      join orbit.people p on p.id = a.person_id
      join orbit.spaces s on s.id = p.space_id
      where e.place_id = ${id}::uuid and e.status <> 'cancelled'
        and not p.is_locked and p.archived_at is null
      group by p.id, p.display_name, s.id, s.name, s.short_label, s.colour, s.icon
      order by count(*) desc, p.display_name
      limit 25
    `;

    return { place, visits, events, notes, people };
  });
}

/** Places in one space, for a picker. Locked places have no readable name to offer. */
export type PlaceOption = { id: string; name: string; lat: number | null; lon: number | null };

export async function listPlaceOptions(
  userId: string,
  spaceId: string,
): Promise<PlaceOption[]> {
  return asUser(userId, async (tx) => {
    return tx<PlaceOption[]>`
      select id, name, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lon
      from orbit.places
      where space_id = ${spaceId}::uuid and archived_at is null and not is_locked
      order by name
      limit 300
    `;
  });
}

/**
 * Every place the caller can write to, across spaces, for the travel planner.
 * The space comes with each one because a leg between two spaces' places is a
 * question the planner has to be able to ask about.
 */
export type PlacePickerRow = PlaceOption & { space: SpaceRef };

export async function listPlacesForPicker(userId: string): Promise<PlacePickerRow[]> {
  return asUser(userId, async (tx) => {
    return tx<PlacePickerRow[]>`
      select pl.id, pl.name,
             ST_Y(pl.geom::geometry) as lat, ST_X(pl.geom::geometry) as lon,
             jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                                'colour', s.colour, 'icon', s.icon) as space
      from orbit.places pl
      join orbit.spaces s on s.id = pl.space_id
      join orbit.space_members m
        on m.space_id = pl.space_id and m.user_id = ${userId}::uuid
       and m.status = 'active' and m.role in ('owner','admin','member')
      where pl.archived_at is null and not pl.is_locked
      order by s.name, pl.name
      limit 400
    `;
  });
}
