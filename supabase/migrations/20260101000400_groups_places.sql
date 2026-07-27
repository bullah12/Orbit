-- ============================================================================
-- Orbit 0004 — Groups (manual + smart) and Places
-- ============================================================================

create table groups (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  name        text not null,
  parent_id   uuid references groups(id) on delete set null,
  is_smart    boolean not null default false,
  is_household boolean not null default false,
  rule_json   jsonb,                     -- smart-group rule AST; see docs/adr
  notes_md    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz,
  constraint smart_groups_have_rules check (not is_smart or rule_json is not null)
);
create index groups_by_space on groups (space_id, name) where deleted_at is null;
create index groups_by_parent on groups (space_id, parent_id) where deleted_at is null;

-- Junction table, and it carries space_id/owner_id like everything else:
-- membership of a group otherwise leaks the existence of a private person.
create table group_members (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  group_id   uuid not null references groups(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  -- Denormalised for the same anti-leak reason as `links`.
  person_space_id uuid not null references spaces(id) on delete cascade,
  group_space_id  uuid not null references spaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (group_id, person_id)
);
create index group_members_by_group  on group_members (group_space_id, group_id) where deleted_at is null;
create index group_members_by_person on group_members (person_space_id, person_id) where deleted_at is null;

create table places (
  id                     uuid primary key default gen_random_uuid(),
  space_id               uuid not null references spaces(id) on delete cascade,
  owner_id               uuid not null references auth.users(id),
  name                   text not null,
  category               text,                  -- restaurant | cafe | venue | shop | other
  geom                   geography(Point, 4326),
  address_text           text,
  city                   text,
  country                text default 'GB',
  url                    text,
  phone                  text,
  notes_md               text,
  want_to_go             boolean not null default false,
  visited_at             date,
  recommended_by_person_id uuid references people(id) on delete set null,
  external_ref           text,                  -- OSM/Mapbox id for dedupe
  search_tsv             tsvector generated always as (
                           to_tsvector('english',
                             coalesce(name,'') || ' ' || coalesce(category,'') || ' ' ||
                             coalesce(city,'') || ' ' || coalesce(address_text,''))
                         ) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  deleted_at             timestamptz
);
create index places_geom on places using gist (geom);
create index places_search on places using gin (search_tsv);
create index places_want_to_go on places (space_id, city) where deleted_at is null and want_to_go;

-- Home base + cached travel times, per member. Personal-space by construction.
create table travel_profiles (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  owner_id      uuid not null references auth.users(id),
  user_id       uuid not null references auth.users(id) on delete cascade,
  home_geom     geography(Point, 4326),
  home_label    text default 'Birmingham',
  home_radius_m int not null default 25000,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  unique (user_id)
);

create table travel_time_cache (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  owner_id       uuid not null references auth.users(id),
  from_geom      geography(Point, 4326) not null,
  to_geom        geography(Point, 4326) not null,
  mode           text not null,                 -- rail | car | walk | cycle
  duration_s     int not null,
  distance_m     int,
  computed_at    timestamptz not null default now(),
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz
);
create index travel_cache_from on travel_time_cache using gist (from_geom);
create index travel_cache_to   on travel_time_cache using gist (to_geom);

create table projects (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  name       text not null,
  notes_md   text,
  colour     text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);
create index projects_by_space on projects (space_id, name) where deleted_at is null;
