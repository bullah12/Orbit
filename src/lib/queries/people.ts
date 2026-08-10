import 'server-only';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';

export type PersonRow = {
  id: string;
  displayName: string;
  nickname: string | null;
  pronouns: string | null;
  notesMd: string;
  visibility: string;
  isLocked: boolean;
  space: SpaceRef;
  category: { name: string; colour: string; icon: string } | null;
  contactCount: number;
  linkCount: number;
  nextDate: { kind: string; label: string | null; onDate: string } | null;
  /**
   * Where they live, if anybody has said. Null is the ordinary case — see
   * `0017_person_home_place.sql`. `homePlaceId` can be set while `lat`/`lon`
   * are null: a place typed in by hand and never geocoded is a normal place,
   * and it is an address without a pin rather than a broken row.
   */
  homePlaceId: string | null;
  homePlaceName: string | null;
  homePlaceAddress: string | null;
  homeLat: number | null;
  homeLon: number | null;
};

const PERSON_SELECT = `
  p.id,
  p.display_name as "displayName",
  p.nickname,
  p.pronouns,
  p.notes_md as "notesMd",
  p.visibility::text as visibility,
  p.is_locked as "isLocked",
  jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                     'colour', s.colour, 'icon', s.icon) as space,
  case when c.id is null then null else
    jsonb_build_object('name', c.name, 'colour', c.colour, 'icon', c.icon) end as category,
  p.home_place_id       as "homePlaceId",
  hp.name               as "homePlaceName",
  hp.address_text       as "homePlaceAddress",
  ST_Y(hp.geom::geometry) as "homeLat",
  ST_X(hp.geom::geometry) as "homeLon"
`;

/**
 * The home place, joined for every read of a person.
 *
 * `left join`, and it has to stay one: a person with no place is the ordinary
 * case, and an inner join here would silently shorten every list in the app to
 * the people who happen to have an address. It is also a left join *through*
 * RLS — a place in a space the caller cannot read resolves to no row, so the
 * person still appears and their address does not.
 */
const HOME_PLACE_JOIN = `left join orbit.places hp on hp.id = p.home_place_id`;

export async function listPeople(
  userId: string,
  opts: { spaceId?: string | null; query?: string } = {},
): Promise<PersonRow[]> {
  const { spaceId = null, query = '' } = opts;
  const q = query.trim();

  return asUser(userId, async (tx) => {
    return tx<PersonRow[]>`
      select
        ${tx.unsafe(PERSON_SELECT)},
        coalesce(ct.n, 0) as "contactCount",
        coalesce(lk.n, 0) as "linkCount",
        nd.next as "nextDate"
      from orbit.people p
      join orbit.spaces s on s.id = p.space_id
      left join orbit.categories c on c.id = p.category_id
      ${tx.unsafe(HOME_PLACE_JOIN)}
      left join lateral (
        select count(*)::int as n from orbit.person_contacts x where x.person_id = p.id
      ) ct on true
      left join lateral (
        -- Links are stored once but read from either side, so both directions
        -- are counted. Two records, linked; never one record.
        select count(*)::int as n from orbit.person_links l
        where l.person_a_id = p.id or l.person_b_id = p.id
      ) lk on true
      left join lateral (
        select jsonb_build_object('kind', d.kind, 'label', d.label, 'onDate', d.on_date) as next
        from orbit.person_dates d
        where d.person_id = p.id
        order by
          -- The next anniversary of the date, ignoring the year it started.
          (make_date(
             extract(year from current_date)::int
               + case when to_char(d.on_date, 'MM-DD') < to_char(current_date, 'MM-DD')
                      then 1 else 0 end,
             extract(month from d.on_date)::int,
             least(extract(day from d.on_date)::int, 28))
          )
        limit 1
      ) nd on true
      where p.archived_at is null
        ${spaceId ? tx`and p.space_id = ${spaceId}::uuid` : tx``}
        ${q ? tx`and (p.display_name ilike ${'%' + q + '%'} or p.nickname ilike ${'%' + q + '%'})` : tx``}
      order by p.display_name
      limit 400
    `;
  });
}

export type PersonContact = {
  id: string;
  kind: string;
  label: string;
  value: string;
  isPrimary: boolean;
};

export type PersonDate = {
  id: string;
  kind: string;
  label: string | null;
  onDate: string;
  yearKnown: boolean;
};

/**
 * The other record for the same person.
 *
 * Two records, linked permanently, never collapsed and never auto-merged
 * (decision 4). This resolves the far side through RLS: if the linked record
 * lives in a space you cannot read, you get the link's existence and no
 * details — which is the honest answer, not a hidden row.
 */
export type PersonLink = {
  id: string;
  otherId: string | null;
  otherName: string | null;
  otherSpace: SpaceRef | null;
  linkedAt: string;
  confidence: string;
};

export type PersonMention = {
  kind: 'note' | 'task' | 'event';
  id: string;
  label: string;
  at: string | null;
};

export async function getPerson(
  userId: string,
  id: string,
): Promise<{
  person: PersonRow;
  contacts: PersonContact[];
  dates: PersonDate[];
  links: PersonLink[];
  mentions: PersonMention[];
} | null> {
  return asUser(userId, async (tx) => {
    const rows = await tx<PersonRow[]>`
      select ${tx.unsafe(PERSON_SELECT)},
             0 as "contactCount", 0 as "linkCount", null as "nextDate"
      from orbit.people p
      join orbit.spaces s on s.id = p.space_id
      left join orbit.categories c on c.id = p.category_id
      ${tx.unsafe(HOME_PLACE_JOIN)}
      where p.id = ${id}::uuid
    `;
    const person = rows[0];
    if (!person) return null;

    const contacts = await tx<PersonContact[]>`
      select id, kind, label, value, is_primary as "isPrimary"
      from orbit.person_contacts
      where person_id = ${id}::uuid
      order by is_primary desc, kind, label
    `;

    const dates = await tx<PersonDate[]>`
      select id, kind, label, on_date as "onDate", year_known as "yearKnown"
      from orbit.person_dates
      where person_id = ${id}::uuid
      order by on_date
    `;

    // Either side of the link resolves to "the other one". The join to people
    // is a LEFT join on purpose: an unreadable far side leaves the row with a
    // null name rather than dropping the link entirely.
    const links = await tx<PersonLink[]>`
      select
        l.id,
        other.id as "otherId",
        other.display_name as "otherName",
        case when os.id is null then null else
          jsonb_build_object('id', os.id, 'name', os.name, 'shortLabel', os.short_label,
                             'colour', os.colour, 'icon', os.icon) end as "otherSpace",
        l.linked_at as "linkedAt",
        l.confidence
      from orbit.person_links l
      left join orbit.people other
        on other.id = case when l.person_a_id = ${id}::uuid then l.person_b_id
                           else l.person_a_id end
      left join orbit.spaces os on os.id = other.space_id
      where l.person_a_id = ${id}::uuid or l.person_b_id = ${id}::uuid
      order by l.linked_at
    `;

    const mentions = await tx<PersonMention[]>`
      (select 'note'::text as kind, n.id, n.title as label, n.updated_at::text as at
         from orbit.note_links nl
         join orbit.notes n on n.id = nl.note_id
        where nl.entity_kind = 'person' and nl.entity_id = ${id}::uuid
          and n.archived_at is null and not n.is_locked)
      union all
      (select 'event', e.id, e.title, e.starts_at::text
         from orbit.event_attendees a
         join orbit.events e on e.id = a.event_id
        where a.person_id = ${id}::uuid and e.status <> 'cancelled'
        order by e.starts_at desc limit 20)
    `;

    return { person, contacts, dates, links, mentions };
  });
}

export type UpcomingDate = {
  personId: string;
  displayName: string;
  kind: string;
  label: string | null;
  onDate: string;
  yearKnown: boolean;
  daysAway: number;
  turning: number | null;
  space: SpaceRef;
};

/**
 * Birthdays and anniversaries in the next N days, for Today.
 *
 * The anniversary maths happens in Postgres against Europe/London's idea of
 * today, so it agrees with everything else on the page. 29 February is folded
 * to the 28th rather than skipped in three years out of four.
 */
export async function upcomingDates(
  userId: string,
  withinDays = 21,
): Promise<UpcomingDate[]> {
  return asUser(userId, async (tx) => {
    return tx<UpcomingDate[]>`
      with today as (
        select (now() at time zone 'Europe/London')::date as d
      ),
      next as (
        select
          p.id as "personId",
          p.display_name as "displayName",
          d.kind,
          d.label,
          d.on_date as "onDate",
          d.year_known as "yearKnown",
          make_date(
            extract(year from t.d)::int
              + case when to_char(d.on_date, 'MM-DD') < to_char(t.d, 'MM-DD') then 1 else 0 end,
            extract(month from d.on_date)::int,
            least(extract(day from d.on_date)::int, 28)
          ) as occurs_on,
          jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                             'colour', s.colour, 'icon', s.icon) as space
        from orbit.person_dates d
        join orbit.people p on p.id = d.person_id
        join orbit.spaces s on s.id = p.space_id
        cross join today t
        where p.archived_at is null and not p.is_locked
      )
      select
        "personId", "displayName", kind, label, "onDate", "yearKnown", space,
        (occurs_on - (select d from today))::int as "daysAway",
        case when "yearKnown"
             then extract(year from occurs_on)::int - extract(year from "onDate")::int
             else null end as turning
      from next
      where occurs_on - (select d from today) between 0 and ${withinDays}
      order by occurs_on, "displayName"
    `;
  });
}

/**
 * People this record could be linked to.
 *
 * Only from spaces the caller can *write* — the policy on `person_links`
 * requires write access to both sides, so offering a candidate you could not
 * link would be offering a refusal. Excludes the person themselves, anyone
 * already linked to them, and locked records (whose names do not exist).
 */
export type LinkCandidate = { id: string; displayName: string; space: SpaceRef };

export async function listLinkCandidates(
  userId: string,
  personId: string,
): Promise<LinkCandidate[]> {
  return asUser(userId, async (tx) => {
    return tx<LinkCandidate[]>`
      select
        p.id,
        p.display_name as "displayName",
        jsonb_build_object('id', s.id, 'name', s.name, 'shortLabel', s.short_label,
                           'colour', s.colour, 'icon', s.icon) as space
      from orbit.people p
      join orbit.spaces s on s.id = p.space_id
      join orbit.space_members m
        on m.space_id = p.space_id and m.user_id = ${userId}::uuid
       and m.status = 'active' and m.role in ('owner','admin','member')
      where p.id <> ${personId}::uuid
        and p.archived_at is null
        and not p.is_locked
        and not exists (
          select 1 from orbit.person_links l
          where (l.person_a_id = ${personId}::uuid and l.person_b_id = p.id)
             or (l.person_b_id = ${personId}::uuid and l.person_a_id = p.id)
        )
      order by
        -- Someone with the same name in another space is almost always what
        -- you are looking for, so float those to the top.
        (p.display_name = (select display_name from orbit.people where id = ${personId}::uuid)) desc,
        p.display_name
      limit 300
    `;
  });
}
