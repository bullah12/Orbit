set search_path = public, extensions;

-- ============================================================================
-- Orbit 0000 — extensions, schemas, enums
-- ----------------------------------------------------------------------------
-- Everything visibility-related lives in the `app` schema. There is exactly one
-- place where visibility logic can be wrong, and this is the top of it.
-- ============================================================================

create extension if not exists "pgcrypto"    with schema extensions;  -- gen_random_uuid
create extension if not exists "postgis"     with schema extensions;  -- geography(Point)
create extension if not exists "pg_trgm"     with schema extensions;  -- fuzzy name match / dedupe
create extension if not exists "unaccent"    with schema extensions;  -- search normalisation
create extension if not exists "vector"      with schema extensions;  -- semantic search
create extension if not exists "btree_gist"  with schema extensions;  -- event overlap constraints
create extension if not exists "citext"      with schema extensions;  -- case-insensitive invite emails

create schema if not exists app;
comment on schema app is
  'Access-control helpers and privileged RPCs. No client-writable tables live here.';

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Enums
--
-- NB: enum comparison follows declaration order. space_role and
-- share_permission are declared least-privileged first so that policies can
-- say `role >= 'viewer'` instead of enumerating values.
-- ----------------------------------------------------------------------------

create type space_kind        as enum ('personal', 'shared');
create type space_role        as enum ('free_busy', 'viewer', 'editor', 'owner');
create type membership_status as enum ('invited', 'active', 'left', 'revoked');
create type share_permission  as enum ('view', 'edit');

-- Every linkable / taggable object. Adding a value here means adding a branch
-- to app.entity_space() and a trigger to the table. Both are asserted by tests.
create type entity_type as enum (
  'person', 'group', 'event', 'task', 'note', 'place', 'project',
  'interaction', 'talking_point', 'attachment', 'saved_filter'
);

create type link_type as enum (
  'mentions', 'attends', 'located_at', 'about', 'blocks',
  'follows_up', 'recommended_by', 'related_to'
);

create type person_relation_type as enum (
  'spouse_of', 'partner_of', 'parent_of', 'child_of', 'sibling_of',
  'colleague_of', 'friend_of', 'introduced_me_to', 'other'
);

create type address_precision as enum ('exact', 'approximate');
create type cadence_unit      as enum ('none', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom_days');
create type interaction_channel as enum ('in_person', 'call', 'video', 'message', 'email', 'letter', 'other');

create type task_energy   as enum ('low', 'medium', 'high');
create type rrule_mode    as enum ('fixed', 'rolling');       -- 'every 2 weeks' vs '2 weeks after completion'
create type calendar_source as enum ('local', 'google', 'microsoft', 'caldav', 'ics_url');
create type sync_status   as enum ('ok', 'degraded', 'auth_required', 'error', 'disconnected');
create type attendee_response as enum ('needs_action', 'accepted', 'declined', 'tentative');

-- ----------------------------------------------------------------------------
-- Shared column conventions (documented here, applied by every table below)
--
--   id          uuid pk
--   space_id    uuid not null   -- the ONLY thing that decides visibility
--   owner_id    uuid not null   -- who created it; never used for read auth
--   created_at / updated_at / updated_by
--   deleted_at  timestamptz     -- soft delete; sync engines need tombstones
--
-- owner_id is deliberately NOT part of any read policy. If it were, a row
-- could be readable by its owner after they left a space. Leaving a space
-- must revoke, and revocation is a membership fact, not an ownership fact.
-- ----------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
