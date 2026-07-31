import 'server-only';
import { asUser } from '@/lib/db';
import { listSpaces } from './spaces';
import type { SpaceRef } from '@/components/SpaceIndicator';

/**
 * Who is where.
 *
 * Read carefully before extending this: **decision 5** (docs/decisions-log.md)
 * says Orbit's location is manual and calendar-derived only. There is no
 * background position column, no GPS permission is ever requested, and this
 * module must never become the reason one gets added. What it reads is
 * `place_visits` — somewhere a person said they were, or somewhere the calendar
 * put them — joined to the place's point.
 *
 * That makes "where is everyone" answerable and honest at the same time: the
 * answer is "last known", it is dated, and the person chose to record it.
 *
 * A space the caller is only a `free_busy` participant of yields a person with
 * no place. They stay in the list and render `.locked`: the absence is a fact
 * about permission and has to read as deliberate, not as a person who vanished.
 */

export type Whereabouts = {
  personId: string;
  name: string;
  /** The space the sighting belongs to, which is where the colour comes from. */
  space: SpaceRef;
  placeName: string | null;
  lat: number | null;
  lon: number | null;
  /** ISO instant of the last sighting, or null when nothing is readable. */
  lastSeen: string | null;
  /** True while the visit has no departure — they are there now, not were. */
  present: boolean;
  /** Location is not shared with the caller. Renders `.locked`, never hidden. */
  locked: boolean;
};

export async function listWhereabouts(userId: string): Promise<Whereabouts[]> {
  const spaces = await listSpaces(userId);
  const readable = spaces.filter((s) => s.canRead);
  const byId = new Map(spaces.map((s) => [s.id, s]));

  const rows = readable.length
    ? await asUser(userId, async (tx) => {
        // One row per person: their most recent visit, across every space the
        // caller can read. `distinct on` is the cheapest way to say that in
        // Postgres and keeps the ordering honest — no window function needed.
        return tx<
          {
            personId: string;
            name: string;
            spaceId: string;
            placeName: string | null;
            lat: number | null;
            lon: number | null;
            arrivedAt: string;
            departedAt: string | null;
            isLocked: boolean;
          }[]
        >`
          select distinct on (v.owner_id)
            v.owner_id                        as "personId",
            p.display_name                    as name,
            v.space_id                        as "spaceId",
            case when pl.is_locked then null else pl.name end as "placeName",
            case when pl.is_locked then null else ST_Y(pl.geom::geometry) end as lat,
            case when pl.is_locked then null else ST_X(pl.geom::geometry) end as lon,
            v.arrived_at                      as "arrivedAt",
            v.departed_at                     as "departedAt",
            pl.is_locked                      as "isLocked"
          from public.place_visits v
          join public.profiles p on p.id = v.owner_id
          join public.places pl on pl.id = v.place_id
          order by v.owner_id, v.arrived_at desc
        `;
      })
    : [];

  const seen = new Map<string, Whereabouts>();
  for (const r of rows) {
    const space = byId.get(r.spaceId);
    if (!space) continue;
    seen.set(r.personId, {
      personId: r.personId,
      name: r.name,
      space,
      placeName: r.placeName,
      lat: r.lat,
      lon: r.lon,
      lastSeen: r.arrivedAt,
      present: r.departedAt == null,
      locked: r.isLocked,
    });
  }

  // Everyone the caller shares a space with, whether or not they have a
  // sighting. A person with nothing readable is still a row.
  const members = await asUser(userId, async (tx) => {
    return tx<{ personId: string; name: string; spaceId: string }[]>`
      select distinct on (m.user_id)
        m.user_id      as "personId",
        p.display_name as name,
        m.space_id     as "spaceId"
      from public.space_members m
      join public.profiles p on p.id = m.user_id
      where m.status = 'active'
      -- Prefer a space we can actually read, so somebody who shares two spaces
      -- is not reported as private on the strength of the wrong one.
      order by m.user_id, (m.role <> 'free_busy') desc, m.space_id
    `;
  });

  for (const m of members) {
    if (seen.has(m.personId)) continue;
    const space = byId.get(m.spaceId);
    if (!space) continue;
    seen.set(m.personId, {
      personId: m.personId,
      name: m.name,
      space,
      placeName: null,
      lat: null,
      lon: null,
      lastSeen: null,
      present: false,
      // Two different silences, and they must not be told the same way: a
      // space we cannot read is sharing switched off, while a readable space
      // with no visit is simply somebody who has not checked in lately.
      locked: !space.canRead,
    });
  }

  return [...seen.values()].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    if (a.present !== b.present) return a.present ? -1 : 1;
    return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name);
  });
}
