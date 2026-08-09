-- 0005_places_travel.sql — places, visits, travel legs, Travel Mode.
--
-- Decision 5: Travel Mode is manual + calendar-derived ONLY. There is no
-- background location column here and no permission is ever requested. If a
-- future session finds itself wanting `last_known_position`, that is the wrong
-- turning — go back and read the decision.

create table orbit.places (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references orbit.spaces(id) on delete cascade,
  owner_id      uuid not null references orbit.profiles(id) on delete cascade,
  category_id   uuid references orbit.categories(id) on delete set null,

  name          text not null,
  address_text  text,
  postcode      text,
  city          text,
  country_code  text not null default 'GB',
  geom          geography(Point, 4326),
  what3words    text,
  notes_md      text not null default '',
  visibility    app.visibility not null default 'space',
  is_locked     boolean not null default false,
  -- Set by the geocoding integration; null means "never geocoded", which is a
  -- legitimate steady state when running with the fake provider.
  geocoded_at   timestamptz,
  geocode_source text,
  archived_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint places_locked_has_no_plaintext
    check (not is_locked or (name = '' and notes_md = '')),
  constraint places_space_name_key unique (space_id, name)
);

create index places_geom_idx on orbit.places using gist (geom);
create index places_search_idx on orbit.places
  using gin (to_tsvector('english', name || ' ' || coalesce(address_text, '') || ' ' || notes_md))
  where not is_locked;

create trigger places_touch before update on orbit.places
  for each row execute function app.touch_updated_at();

-- events.place_id could not be declared in 0004 because places did not exist.
alter table orbit.events
  add constraint events_place_id_fkey
  foreign key (place_id) references orbit.places(id) on delete set null;

create index events_place_idx on orbit.events (place_id) where place_id is not null;

create table orbit.place_visits (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references orbit.spaces(id) on delete cascade,
  owner_id    uuid not null references orbit.profiles(id) on delete cascade,
  place_id    uuid not null references orbit.places(id) on delete cascade,
  event_id    uuid references orbit.events(id) on delete set null,
  -- 'manual' or 'calendar'. Never 'background_location'; see the header.
  source      text not null default 'manual' check (source in ('manual', 'calendar')),
  arrived_at  timestamptz not null,
  departed_at timestamptz,
  notes_md    text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint place_visits_departed_after_arrived
    check (departed_at is null or departed_at >= arrived_at)
);

create index place_visits_place_idx on orbit.place_visits (space_id, place_id, arrived_at desc);

create trigger place_visits_touch before update on orbit.place_visits
  for each row execute function app.touch_updated_at();

create table orbit.travel_legs (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references orbit.spaces(id) on delete cascade,
  owner_id          uuid not null references orbit.profiles(id) on delete cascade,
  session_id        uuid,  -- FK added below, after travel_sessions exists
  from_place_id     uuid references orbit.places(id) on delete set null,
  to_place_id       uuid references orbit.places(id) on delete set null,
  event_id          uuid references orbit.events(id) on delete set null,
  mode              text not null default 'car'
                      check (mode in ('walk', 'cycle', 'car', 'bus', 'train', 'plane', 'other')),
  depart_at         timestamptz,
  arrive_at         timestamptz,
  duration_minutes  integer check (duration_minutes is null or duration_minutes >= 0),
  distance_metres   integer check (distance_metres is null or distance_metres >= 0),
  estimate_source   text not null default 'none'
                      check (estimate_source in ('none', 'manual', 'provider')),
  estimated_at      timestamptz,
  notes_md          text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint travel_legs_arrive_after_depart
    check (arrive_at is null or depart_at is null or arrive_at >= depart_at)
);

create index travel_legs_space_depart_idx on orbit.travel_legs (space_id, depart_at);

create trigger travel_legs_touch before update on orbit.travel_legs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- travel_sessions — "I am away from home between these dates". Created by hand
-- or derived from a calendar event. Nothing else creates one.
-- ---------------------------------------------------------------------------
create table orbit.travel_sessions (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references orbit.spaces(id) on delete cascade,
  owner_id      uuid not null references orbit.profiles(id) on delete cascade,
  title         text not null,
  source        text not null default 'manual' check (source in ('manual', 'calendar')),
  origin_place_id uuid references orbit.places(id) on delete set null,
  destination_place_id uuid references orbit.places(id) on delete set null,
  event_id      uuid references orbit.events(id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  timezone      text not null default 'Europe/London',
  is_active     boolean not null default false,
  notes_md      text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint travel_sessions_ends_after_starts check (ends_at >= starts_at)
);

create index travel_sessions_active_idx on orbit.travel_sessions (space_id, starts_at)
  where is_active;

create trigger travel_sessions_touch before update on orbit.travel_sessions
  for each row execute function app.touch_updated_at();

alter table orbit.travel_legs
  add constraint travel_legs_session_id_fkey
  foreign key (session_id) references orbit.travel_sessions(id) on delete cascade;

-- ===========================================================================
-- RLS
-- ===========================================================================
select app.apply_standard_rls('places', p_has_visibility => true);
select app.apply_standard_rls('place_visits');
select app.apply_standard_rls('travel_legs');
select app.apply_standard_rls('travel_sessions');
