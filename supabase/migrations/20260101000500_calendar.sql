set search_path = public, extensions;

-- ============================================================================
-- Orbit 0005 — Calendar
--
-- Timezone policy: start_at/end_at are timestamptz (absolute instants) AND we
-- keep start_tz, because a weekly 09:00 recurring event must stay at 09:00
-- local across a DST boundary. Recurrence is expanded server-side into
-- event_occurrences so that week/month views are a single indexed range scan
-- rather than an RRULE walk over every event.
--
-- All-day events store start_date/end_date separately: an all-day event is a
-- date, not an instant, and treating it as an instant is how you get birthdays
-- landing on the wrong day for half the year.
-- ============================================================================

create table categories (
  id                       uuid primary key default gen_random_uuid(),
  space_id                 uuid not null references spaces(id) on delete cascade,
  owner_id                 uuid not null references auth.users(id),
  name                     text not null,
  colour                   text not null,
  icon                     text not null,        -- never colour alone
  default_reminder_minutes int not null default 10,
  prep_minutes             int not null default 0,
  travel_buffer            boolean not null default false,
  sort_order               int not null default 0,
  is_system                boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id),
  deleted_at               timestamptz,
  unique (space_id, name)
);

create table calendars (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references spaces(id) on delete cascade,
  owner_id            uuid not null references auth.users(id),
  source              calendar_source not null default 'local',
  integration_id      uuid,                      -- FK added in 0008
  external_id         text,
  name                text not null,
  colour              text,
  default_category_id uuid references categories(id) on delete set null,
  is_visible          boolean not null default true,
  read_only           boolean not null default true,   -- v1 sync is read-only
  sync_token          text,
  last_sync_at        timestamptz,
  sync_state          sync_status not null default 'ok',
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  deleted_at          timestamptz,
  unique (space_id, integration_id, external_id)
);

create table events (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references spaces(id) on delete cascade,
  owner_id            uuid not null references auth.users(id),
  calendar_id         uuid references calendars(id) on delete cascade,
  external_id         text,
  external_etag       text,
  title               text not null,
  description         text,
  all_day             boolean not null default false,
  start_at            timestamptz,
  end_at              timestamptz,
  start_date          date,
  end_date            date,
  start_tz            text not null default 'Europe/London',
  rrule               text,
  rdate               timestamptz[],
  exdate              timestamptz[],
  -- Single-instance edits: a detached override row pointing at its series.
  recurrence_parent_id     uuid references events(id) on delete cascade,
  recurrence_instance_start timestamptz,
  is_cancelled        boolean not null default false,
  location_text       text,
  place_id            uuid references places(id) on delete set null,
  category_id         uuid references categories(id) on delete set null,
  category_is_manual  boolean not null default false,   -- manual override always wins
  prep_minutes        int,
  travel_minutes      int,
  -- A task dragged onto the calendar renders as an event but remains a task.
  source_task_id      uuid,                      -- FK added in 0006
  search_tsv          tsvector generated always as (
                        to_tsvector('english'::regconfig,
                          coalesce(title,'') || ' ' || coalesce(description,'') || ' ' ||
                          coalesce(location_text,''))
                      ) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  deleted_at          timestamptz,
  constraint timed_or_allday check (
    (all_day and start_date is not null) or (not all_day and start_at is not null)
  ),
  constraint ends_after_starts check (
    (all_day and (end_date is null or end_date >= start_date)) or
    (not all_day and (end_at is null or end_at >= start_at))
  ),
  unique (space_id, calendar_id, external_id, recurrence_instance_start)
);
create index events_range   on events (space_id, start_at) where deleted_at is null;
create index events_search  on events using gin (search_tsv);
create index events_series  on events (space_id, recurrence_parent_id) where recurrence_parent_id is not null;
create index events_by_place on events (space_id, place_id) where place_id is not null;

-- Materialised recurrence expansion. Rebuilt for a rolling window (default
-- -1y..+2y) whenever the parent event changes, by an Edge Function.
create table event_occurrences (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  event_id    uuid not null references events(id) on delete cascade,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  is_override boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz,
  unique (space_id, event_id, start_at)
);
create index occurrences_range on event_occurrences (space_id, start_at, end_at) where deleted_at is null;
-- Conflict detection ("double-booked") is a range overlap query, so index it as one.
create index occurrences_gist on event_occurrences
  using gist (space_id, tstzrange(start_at, end_at));

create table event_attendees (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references spaces(id) on delete cascade,
  owner_id        uuid not null references auth.users(id),
  event_id        uuid not null references events(id) on delete cascade,
  person_id       uuid references people(id) on delete set null,
  -- Denormalised for the anti-leak rule; null when the attendee is not yet a Person.
  person_space_id uuid references spaces(id) on delete cascade,
  event_space_id  uuid not null references spaces(id) on delete cascade,
  external_email  citext,
  display_name    text,
  response_status attendee_response not null default 'needs_action',
  is_organiser    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  constraint attendee_identified check (person_id is not null or external_email is not null)
);
create index attendees_by_event  on event_attendees (event_space_id, event_id) where deleted_at is null;
create index attendees_by_person on event_attendees (person_space_id, person_id) where deleted_at is null;

create table category_rules (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  owner_id       uuid not null references auth.users(id),
  priority       int not null default 100,
  match_field    text not null,        -- calendar | title | attendee | location
  match_operator text not null,        -- equals | contains | regex | domain
  match_value    text not null,
  category_id    uuid not null references categories(id) on delete cascade,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz
);
create index category_rules_order on category_rules (space_id, priority) where deleted_at is null and enabled;

-- ----------------------------------------------------------------------------
-- free_busy members
--
-- RLS is row-level; it cannot hide the `title` column. So free_busy members are
-- excluded from the events policy entirely and read this view instead. It is
-- security_invoker = off, so it runs with the definer's rights and applies its
-- own, narrower predicate — and it exposes no column that could carry content.
-- ----------------------------------------------------------------------------

create view app.busy_blocks
with (security_invoker = off) as
  select o.space_id,
         o.start_at,
         o.end_at,
         e.owner_id as member_id
  from event_occurrences o
  join events e on e.id = o.event_id
  where o.deleted_at is null
    and e.deleted_at is null
    and e.is_cancelled = false
    and o.space_id = any(app.member_space_ids());

grant select on app.busy_blocks to authenticated;

comment on view app.busy_blocks is
  'Anonymous busy time for free_busy members. Deliberately exposes no title, '
  'description, location, attendee or category.';
