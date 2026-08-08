-- 0011_travel_leg_identity.sql — one journey between two places at one time.
--
-- Session 3 wrote the duplicate guard for a derived journey into the insert:
-- `insert … select … where not exists` on (from, to, arrival). That closes the
-- double click and costs nothing, but it depends on every writer going through
-- `saveDerivedLeg`, and it was recorded as a rough edge for exactly that
-- reason. This is the honest version of it.
--
-- Why a *partial* index rather than a plain unique constraint: a leg with two
-- null place ids is legitimate. "I drove somewhere for two hours" is a journey
-- worth recording, and two of those on the same day are two journeys, not one
-- written twice. So the constraint applies only where the three columns that
-- make a journey identifiable are all present — which is precisely the case
-- calendar derivation produces, and precisely the case that can be produced
-- twice.
--
-- It leads with space_id, like every unique constraint in this schema, and the
-- pgTAP suite asserts that structurally.

-- Everything below lives in the `orbit` schema. The search_path names it
-- first so an unqualified CREATE cannot land in a schema this project
-- shares with somebody else's work, and names `public` and `extensions`
-- after it because that is where an installation puts PostGIS and pgcrypto:
-- Supabase uses `extensions`, a local cluster uses `public`.
set search_path = orbit, public, extensions, pg_catalog;

create unique index travel_legs_derived_identity_key
  on orbit.travel_legs (space_id, from_place_id, to_place_id, arrive_at)
  where from_place_id is not null
    and to_place_id is not null
    and arrive_at is not null;
