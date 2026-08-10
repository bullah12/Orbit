-- 0017_person_home_place.sql — where somebody lives.
--
-- Orbit had no person↔place link at all. `queries/places.ts` exposes an
-- association derived from `event_attendees → events.place_id`, and that is
-- worth having, but it is *attendance history* — it says Dr Iqbal was at the
-- surgery, and it would say the same of anybody who once had an appointment
-- there. It cannot answer "where does this person live", and putting people on
-- a map on that basis would draw a map of meetings and label it home.
--
-- So: one nullable column. The smallest thing that works.
--
-- ---------------------------------------------------------------------------
-- Why nullable, and why it stays nullable
-- ---------------------------------------------------------------------------
--
-- Most people in a household organiser have no address and never will — the
-- other parent from swimming is a name and a phone number. Null is the normal
-- case here, not a gap waiting to be filled, and every reader has to keep those
-- rows: `listPeople` left-joins, and the map says out loud how many people it
-- is not showing rather than quietly drawing a shorter list.
--
-- ---------------------------------------------------------------------------
-- `on delete set null`, not cascade
-- ---------------------------------------------------------------------------
--
-- Deleting a place must not delete a person. The person is the record; the
-- address is a fact about them that stopped being true.
--
-- ---------------------------------------------------------------------------
-- Same space, and where that is enforced
-- ---------------------------------------------------------------------------
--
-- A person and their home place belong to the same space. That is not a check
-- constraint here, for the same reason `people.category_id` is not one: the
-- writers enforce it in the statement (`updatePerson` resolves the id through
-- a subquery filtered on `p.space_id`, exactly as it already does for
-- `category_id`), and the picker only ever offers places from the person's own
-- space. A cross-space id supplied by hand resolves to null rather than to a
-- link.
--
-- RLS is unchanged and needs no change: reading a person already requires
-- membership of their space, and joining to `places` runs under the caller's
-- own policies — so a place in a space they cannot read comes back as no row,
-- not as a leaked address.

alter table orbit.people
  add column home_place_id uuid null
    references orbit.places(id) on delete set null;

create index on orbit.people (home_place_id);

comment on column orbit.people.home_place_id is
  'Where this person lives, as a place in the same space. Null is the ordinary '
  'case — most people in a household organiser have no address recorded. '
  'Distinct from the attendance association derived from events.place_id, '
  'which is history rather than home.';
