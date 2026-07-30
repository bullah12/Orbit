import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';
import { expandRecurrence } from '@/lib/recurrence';
import { listSpaces } from './spaces';

/**
 * Calendar reads.
 *
 * Two things worth knowing before changing anything here:
 *
 *  - **There is no space filter in these queries.** The policies on `events`
 *    decide what comes back. A `where space_id in (...)` would hide the fact
 *    that the policy is what protects it, and would be the first thing somebody
 *    widens when a page looks empty.
 *  - **A `free_busy` participant never reaches this table.** They fail
 *    `can_read_space()`, so `listEvents` returns nothing for that space no
 *    matter what the caller asks. Their view of it comes from
 *    `app.free_busy_blocks()`, which returns times and nothing else — that is
 *    the only path, and it is a different query on purpose (decision 3).
 */

export type EventRow = {
  id: string;
  /** Distinct per rendered occurrence: a repeat draws many blocks from one row. */
  key: string;
  title: string;
  bodyMd: string;
  locationText: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  isLocked: boolean;
  isRecurring: boolean;
  rrule: string | null;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  calendarName: string | null;
  placeId: string | null;
  placeName: string | null;
  /** The place's point, when it has one. Travel derivation needs it; nothing else does. */
  placeLat: number | null;
  placeLon: number | null;
  attendeeCount: number;
  /** Always false. Present so a block and an event can share one list. */
  isBusy: false;
};

/**
 * What a `free_busy` participant sees: a time, a space, and nothing else.
 * No title, no category, no attendees, no place, no id.
 */
export type BusyBlock = {
  key: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  space: SpaceRef;
  isBusy: true;
};

export type CalendarItem = EventRow | BusyBlock;

type RawEvent = Omit<EventRow, 'key' | 'isBusy' | 'isRecurring'> & {
  rrule: string | null;
  ruleUntil: string | null;
  /** RFC 5545 EXDATE: the occurrences this series skips. */
  exdates: string[];
};

/**
 * Every event the caller can see that overlaps [from, to), plus every
 * anonymous block from a space they can only see availability for.
 *
 * Recurring events are expanded **here**, in the application, from the stored
 * RRULE — the database holds one row and one rule, not 200 rows. That keeps
 * one implementation of what a repeat means (src/lib/recurrence.ts) and it is
 * the implementation the tests can reach.
 */
export async function listCalendarItems(
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarItem[]> {
  const spaces = await listSpaces(userId);
  const opaque = spaces.filter((s) => !s.canRead);

  const [raw, blocks] = await Promise.all([
    asUser(userId, async (tx) => {
      return tx<RawEvent[]>`
        select
          e.id,
          e.title,
          e.body_md        as "bodyMd",
          e.location_text  as "locationText",
          e.starts_at      as "startsAt",
          e.ends_at        as "endsAt",
          e.all_day        as "allDay",
          e.status::text   as status,
          e.is_locked      as "isLocked",
          r.rrule          as rrule,
          r.until          as "ruleUntil",
          coalesce(r.exdates, '{}')::text[] as exdates,
          jsonb_build_object(
            'id', s.id, 'name', s.name, 'shortLabel', s.short_label,
            'colour', s.colour, 'icon', s.icon
          ) as space,
          case when c.id is null then null else
            jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon)
          end as category,
          cal.name  as "calendarName",
          pl.id     as "placeId",
          pl.name   as "placeName",
          ST_Y(pl.geom::geometry) as "placeLat",
          ST_X(pl.geom::geometry) as "placeLon",
          coalesce(att.n, 0) as "attendeeCount"
        from public.events e
        join public.spaces s on s.id = e.space_id
        left join public.categories c on c.id = e.category_id
        left join public.calendars cal on cal.id = e.calendar_id
        left join public.places pl on pl.id = e.place_id
        left join public.recurrence_rules r on r.id = e.recurrence_rule_id
        left join lateral (
          select count(*)::int as n from public.event_attendees a where a.event_id = e.id
        ) att on true
        where e.status <> 'cancelled'
          and (
            -- A one-off has to overlap the window. A repeat is fetched whenever
            -- the series could still be running, and is filtered by expansion.
            (r.rrule is null and e.starts_at < ${to} and e.ends_at > ${from})
            or (r.rrule is not null and e.starts_at < ${to}
                and (r.until is null or r.until > ${from}))
          )
        order by e.starts_at
      `;
    }),
    // One call per space the caller can only see availability for. There is no
    // way to widen this into "all spaces": the function re-checks the grant.
    Promise.all(
      opaque.map(async (space) => {
        const rows = await asUser(userId, async (tx) => {
          return tx<{ startsAt: string; endsAt: string; allDay: boolean }[]>`
            select starts_at as "startsAt", ends_at as "endsAt", all_day as "allDay"
            from app.free_busy_blocks(${space.id}::uuid, ${from}, ${to})
          `;
        });
        return rows.map(
          (r, i): BusyBlock => ({
            key: `busy:${space.id}:${i}`,
            startsAt: new Date(r.startsAt).toISOString(),
            endsAt: new Date(r.endsAt).toISOString(),
            allDay: r.allDay,
            space: {
              id: space.id, name: space.name, shortLabel: space.shortLabel,
              colour: space.colour, icon: space.icon,
            },
            isBusy: true,
          }),
        );
      }),
    ),
  ]);

  const events = raw.flatMap((row) => occurrencesOf(row, from, to));
  const items: CalendarItem[] = [...events, ...blocks.flat()];
  items.sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key),
  );
  return items;
}

/** One stored row becomes one block, or many if it carries a rule. */
function occurrencesOf(row: RawEvent, from: Date, to: Date): EventRow[] {
  const base: Omit<EventRow, 'key' | 'startsAt' | 'endsAt'> = {
    id: row.id,
    title: row.title,
    bodyMd: row.bodyMd,
    locationText: row.locationText,
    allDay: row.allDay,
    status: row.status,
    isLocked: row.isLocked,
    isRecurring: row.rrule != null,
    rrule: row.rrule,
    space: row.space,
    category: row.category,
    calendarName: row.calendarName,
    placeId: row.placeId,
    placeName: row.placeName,
    placeLat: row.placeLat,
    placeLon: row.placeLon,
    attendeeCount: row.attendeeCount,
    isBusy: false,
  };

  if (!row.rrule) {
    return [{
      ...base,
      key: row.id,
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
    }];
  }

  try {
    return expandRecurrence({
      rrule: row.rrule,
      dtstart: new Date(row.startsAt).toISOString(),
      dtend: new Date(row.endsAt).toISOString(),
      exdates: row.exdates,
      from: from.toISOString(),
      to: to.toISOString(),
      maxOccurrences: 400,
    }).map((o) => ({
      ...base,
      // The occurrence's own start makes the key, so React never reuses a block
      // and a link can name which occurrence was clicked.
      key: `${row.id}@${o.startsAt}`,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
    }));
  } catch {
    // A rule we cannot parse must not take the whole calendar down with it. The
    // series falls back to its first occurrence, which is a stored fact.
    return [{
      ...base,
      key: row.id,
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
    }];
  }
}

export type EventDetail = EventRow & {
  categoryId: string | null;
  placeId: string | null;
  calendarId: string | null;
  timezone: string;
  /**
   * The occurrences this series skips (RFC 5545 EXDATE). Already selected by the
   * query below; exposed on the type because the detail page and the exclusion
   * actions both need to know which occurrences are already excluded — asking
   * "is this an occurrence?" without them would answer yes for one that is
   * skipped, and appending it again would be a duplicate exclusion.
   */
  exdates: string[];
  attendees: {
    id: string;
    displayName: string | null;
    email: string | null;
    response: string;
    isOrganiser: boolean;
    personId: string | null;
  }[];
};

export async function getEvent(userId: string, id: string): Promise<EventDetail | null> {
  const rows = await asUser(userId, async (tx) => {
    return tx<(RawEvent & {
      categoryId: string | null;
      placeId: string | null;
      calendarId: string | null;
      timezone: string;
    })[]>`
      select
        e.id, e.title, e.body_md as "bodyMd", e.location_text as "locationText",
        e.starts_at as "startsAt", e.ends_at as "endsAt", e.all_day as "allDay",
        e.status::text as status, e.is_locked as "isLocked", e.timezone,
        e.category_id as "categoryId", e.place_id as "placeId",
        e.calendar_id as "calendarId",
        r.rrule as rrule, r.until as "ruleUntil",
        coalesce(r.exdates, '{}')::text[] as exdates,
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space,
        case when c.id is null then null else
          jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category,
        cal.name as "calendarName", pl.name as "placeName",
        0 as "attendeeCount"
      from public.events e
      join public.spaces s on s.id = e.space_id
      left join public.categories c on c.id = e.category_id
      left join public.calendars cal on cal.id = e.calendar_id
      left join public.places pl on pl.id = e.place_id
      left join public.recurrence_rules r on r.id = e.recurrence_rule_id
      where e.id = ${id}::uuid
    `;
  });
  const row = rows[0];
  if (!row) return null;

  const attendees = await asUser(userId, async (tx) => {
    return tx<EventDetail['attendees']>`
      select
        a.id,
        coalesce(a.display_name, p.display_name, pr.display_name) as "displayName",
        a.email, a.response::text as response, a.is_organiser as "isOrganiser",
        a.person_id as "personId"
      from public.event_attendees a
      left join public.people p on p.id = a.person_id
      left join public.profiles pr on pr.id = a.profile_id
      where a.event_id = ${id}::uuid
      order by a.is_organiser desc, "displayName" nulls last
    `;
  });

  return {
    ...row,
    key: row.id,
    isBusy: false,
    isRecurring: row.rrule != null,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    attendees,
  };
}

export type CalendarOption = {
  id: string;
  name: string;
  spaceId: string;
  isWritable: boolean;
};

/** Calendars the caller can see, for the compose surface and the importer. */
export async function listCalendarsBySpace(userId: string): Promise<Record<string, CalendarOption[]>> {
  const rows = await asUser(userId, async (tx) => {
    return tx<CalendarOption[]>`
      select id, name, space_id as "spaceId", is_writable as "isWritable"
      from public.calendars
      order by sort_order, name
    `;
  });
  const out: Record<string, CalendarOption[]> = {};
  for (const r of rows) (out[r.spaceId] ??= []).push(r);
  return out;
}

/** How many events happened yesterday and how many notes came out of them. */
export async function eventCountOn(userId: string, from: Date, to: Date): Promise<number> {
  const rows = await asUser(userId, async (tx) => {
    return tx<{ n: number }[]>`
      select count(*)::int as n from public.events
      where status <> 'cancelled' and starts_at < ${to} and ends_at > ${from}
    `;
  });
  return rows[0]?.n ?? 0;
}
