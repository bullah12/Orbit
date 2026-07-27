set search_path = public, extensions;

-- ============================================================================
-- Orbit 0003 — People: the shared-facts / private-notes split
--
-- The subtle requirement: a person record may live in the shared household
-- space (someone we both know) while what each of us has written about them
-- stays private. That is expressed structurally, not by a flag:
--
--   people          -> shared facts. Lives in whatever space the record is in.
--   person_fields   -> shared facts, flexible schema. Same space as `people`.
--   person_state    -> ONE ROW PER MEMBER, always in that member's PERSONAL
--                      space, even when the person is shared. Cadence,
--                      last-contacted, private notes, lock state.
--   interactions,
--   talking_points  -> same rule: always personal-space rows.
--
-- Because person_state.space_id is the member's personal space, the ordinary
-- table policy already hides it from everyone else. There is no special-case
-- policy for "private bits of a shared person", which is exactly the point:
-- one visibility rule, applied uniformly.
-- ============================================================================

-- array_to_string() is only STABLE, so it cannot appear directly in a generated
-- column. With a constant delimiter over text[] it is in fact deterministic,
-- so we assert that once here rather than dropping nicknames from search.
create or replace function app.people_search_tsv(
  p_display_name text, p_nicknames text[], p_relationship_type text)
returns tsvector
language sql
immutable
as $$
  select to_tsvector('english'::regconfig,
           coalesce(p_display_name, '') || ' ' ||
           coalesce(array_to_string(p_nicknames, ' '), '') || ' ' ||
           coalesce(p_relationship_type, ''));
$$;

create table people (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references spaces(id) on delete cascade,
  owner_id          uuid not null references auth.users(id),
  display_name      text not null,
  given_name        text,
  family_name       text,
  nicknames         text[] not null default '{}',
  pronunciation     text,
  pronouns          text,
  photo_path        text,
  relationship_type text,                       -- 'family' | 'friend' | 'colleague' | free text
  met_on            date,
  met_how           text,
  archived          boolean not null default false,
  -- Set when two records (mine and my partner's) are explicitly declared the
  -- same human. Never populated automatically on import.
  same_as_person_id uuid references people(id) on delete set null,
  search_tsv        tsvector generated always as (
                      app.people_search_tsv(display_name, nicknames, relationship_type)
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz
);
create index people_search on people using gin (search_tsv);
create index people_name_trgm on people using gin (display_name gin_trgm_ops);
create index people_by_space on people (space_id, display_name) where deleted_at is null;

-- Flexible shared facts: job, employer, city, partner, children, pets,
-- dietary, allergies, drink, team, hobbies, gift ideas, topics to avoid.
create table person_fields (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  person_id    uuid not null references people(id) on delete cascade,
  key          text not null,
  value        text,
  is_sensitive boolean not null default false,   -- health etc. Blocked from bulk share.
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  unique (person_id, key, space_id)
);
create index person_fields_by_person on person_fields (space_id, person_id) where deleted_at is null;

create table person_dates (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references spaces(id) on delete cascade,
  owner_id           uuid not null references auth.users(id),
  person_id          uuid not null references people(id) on delete cascade,
  kind               text not null,             -- 'birthday' | 'anniversary' | custom
  on_date            date not null,
  year_known         boolean not null default true,
  recurring          boolean not null default true,
  reminder_lead_days int[] not null default '{14,1,0}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  deleted_at         timestamptz
);
-- Drives "birthdays in the next 14 days" without a full scan.
create index person_dates_recurring
  on person_dates (space_id, (extract(month from on_date)), (extract(day from on_date)))
  where deleted_at is null and recurring;

-- One row per (person, member). ALWAYS in the member's personal space.
create table person_state (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references spaces(id) on delete cascade,
  owner_id            uuid not null references auth.users(id),
  person_id           uuid not null references people(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  notes_md            text,
  notes_cipher        bytea,                     -- set instead of notes_md when locked
  cadence             cadence_unit not null default 'none',
  cadence_days        int,                       -- used when cadence = 'custom_days'
  last_interaction_at timestamptz,
  next_nudge_at       timestamptz,               -- computed on write; drives Today
  nudge_snoozed_until timestamptz,
  is_locked           boolean not null default false,   -- biometric gate
  is_sensitive        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  deleted_at          timestamptz,
  unique (space_id, person_id, user_id),
  constraint locked_notes_are_encrypted
    check (not is_locked or (notes_md is null and notes_cipher is not null)),
  constraint custom_cadence_has_days
    check (cadence <> 'custom_days' or cadence_days is not null)
);
create index person_state_nudges on person_state (space_id, next_nudge_at)
  where deleted_at is null and next_nudge_at is not null;
create index person_state_last_seen on person_state (space_id, last_interaction_at desc)
  where deleted_at is null;

create table person_relations (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  owner_id      uuid not null references auth.users(id),
  person_a      uuid not null references people(id) on delete cascade,
  person_b      uuid not null references people(id) on delete cascade,
  relation_type person_relation_type not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  constraint no_self_relation check (person_a <> person_b),
  unique (space_id, person_a, person_b, relation_type)
);
create index person_relations_a on person_relations (space_id, person_a);
create index person_relations_b on person_relations (space_id, person_b);

create table addresses (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  owner_type  entity_type not null,              -- 'person' | 'place'
  owner_ref   uuid not null,
  label       text,                              -- home | work | parents'
  line1       text,
  line2       text,
  city        text,
  region      text,
  postcode    text,
  country     text not null default 'GB',
  geom        geography(Point, 4326),
  precision   address_precision not null default 'exact',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz
);
create index addresses_geom on addresses using gist (geom);
create index addresses_by_owner on addresses (space_id, owner_type, owner_ref) where deleted_at is null;
create index addresses_by_city on addresses (space_id, lower(city)) where deleted_at is null;

-- Private per-member by construction (personal space).
create table interactions (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  person_id   uuid not null references people(id) on delete cascade,
  occurred_at timestamptz not null,
  channel     interaction_channel not null default 'in_person',
  duration_minutes int,
  summary     text,
  event_id    uuid,                              -- FK added in 0005 (calendar)
  note_id     uuid,                              -- FK added in 0007 (notes)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz
);
create index interactions_timeline on interactions (space_id, person_id, occurred_at desc)
  where deleted_at is null;

create table talking_points (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  owner_id     uuid not null references auth.users(id),
  person_id    uuid not null references people(id) on delete cascade,
  text         text not null,
  discussed_at timestamptz,
  note_id      uuid,                             -- FK added in 0007
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz
);
create index talking_points_open on talking_points (space_id, person_id)
  where deleted_at is null and discussed_at is null;

-- Guard: person_state / interactions / talking_points must live in a personal
-- space. Enforced here rather than in the client so that a bug in a share
-- action cannot promote someone's private read on a person into the household.
create or replace function app.require_personal_space()
returns trigger language plpgsql
security definer set search_path = public, app, pg_temp
as $$
begin
  if (select kind from spaces where id = new.space_id) <> 'personal' then
    raise exception
      '% rows are per-member and must live in a personal space', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger person_state_personal   before insert or update on person_state
  for each row execute function app.require_personal_space();
create trigger interactions_personal   before insert or update on interactions
  for each row execute function app.require_personal_space();
create trigger talking_points_personal before insert or update on talking_points
  for each row execute function app.require_personal_space();
