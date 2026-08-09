-- 0004_calendar.sql — calendars, events, attendees, sync, free/busy.
--
-- Decision 9: Google + .ics only. No iCloud, no CalDAV.
-- Decision 3: free_busy policies stay as they are; only the UI anonymises.

create table orbit.calendar_accounts (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references orbit.spaces(id) on delete cascade,
  owner_id       uuid not null references orbit.profiles(id) on delete cascade,
  provider       text not null check (provider in ('google', 'ics', 'local')),
  display_name   text not null,
  external_id    text,
  -- Credentials are never stored in plaintext here. With the fixture-backed
  -- fake provider (the default) this stays null entirely.
  credential_ref text,
  status         text not null default 'connected'
                   check (status in ('connected', 'needs_reauth', 'disconnected')),
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint calendar_accounts_space_provider_external_key
    unique (space_id, provider, external_id)
);

create trigger calendar_accounts_touch before update on orbit.calendar_accounts
  for each row execute function app.touch_updated_at();

create table orbit.calendars (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  account_id   uuid references orbit.calendar_accounts(id) on delete cascade,
  category_id  uuid references orbit.categories(id) on delete set null,
  name         text not null,
  external_id  text,
  colour       text not null default 'slate',
  icon         text not null default 'calendar',
  is_visible   boolean not null default true,
  is_writable  boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint calendars_space_account_external_key unique (space_id, account_id, external_id)
);

create trigger calendars_touch before update on orbit.calendars
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table orbit.events (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references orbit.spaces(id) on delete cascade,
  owner_id           uuid not null references orbit.profiles(id) on delete cascade,
  calendar_id        uuid references orbit.calendars(id) on delete cascade,
  category_id        uuid references orbit.categories(id) on delete set null,
  place_id           uuid,  -- FK added in 0005 once places exists
  recurrence_rule_id uuid references orbit.recurrence_rules(id) on delete set null,

  title              text not null default '',
  body_md            text not null default '',
  location_text      text,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  all_day            boolean not null default false,
  timezone           text not null default 'Europe/London',
  status             text not null default 'confirmed'
                       check (status in ('confirmed', 'tentative', 'cancelled')),
  visibility         app.visibility not null default 'space',
  is_locked          boolean not null default false,

  external_id        text,
  external_etag      text,
  -- Set when a row came from an external calendar and has local edits that have
  -- not been pushed back. Sync tests live off this column.
  is_dirty           boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint events_ends_after_starts check (ends_at >= starts_at),
  constraint events_locked_has_no_plaintext
    check (not is_locked or (title = '' and body_md = '')),
  constraint events_space_calendar_external_key unique (space_id, calendar_id, external_id)
);

create index events_space_starts_idx on orbit.events (space_id, starts_at);
create index events_range_idx on orbit.events (space_id, starts_at, ends_at)
  where status <> 'cancelled';
create index events_dirty_idx on orbit.events (space_id) where is_dirty;
create index events_search_idx on orbit.events
  using gin (to_tsvector('english', title || ' ' || body_md))
  where not is_locked;

create trigger events_touch before update on orbit.events
  for each row execute function app.touch_updated_at();

create table orbit.event_attendees (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  event_id     uuid not null references orbit.events(id) on delete cascade,
  person_id    uuid references orbit.people(id) on delete set null,
  profile_id   uuid references orbit.profiles(id) on delete set null,
  email        text,
  display_name text,
  response     text not null default 'needs_action'
                 check (response in ('needs_action', 'accepted', 'declined', 'tentative')),
  is_organiser boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint event_attendees_space_event_person_key unique (space_id, event_id, person_id),
  constraint event_attendees_identified check (person_id is not null or profile_id is not null or email is not null)
);

create index event_attendees_event_idx on orbit.event_attendees (event_id);

create trigger event_attendees_touch before update on orbit.event_attendees
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- calendar_sync_state — one row per calendar per direction. Sync is a bug farm;
-- everything it needs to resume is here rather than in memory.
-- ---------------------------------------------------------------------------
create table orbit.calendar_sync_state (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references orbit.spaces(id) on delete cascade,
  owner_id       uuid not null references orbit.profiles(id) on delete cascade,
  calendar_id    uuid not null references orbit.calendars(id) on delete cascade,
  direction      text not null check (direction in ('pull', 'push')),
  sync_token     text,
  window_start   timestamptz,
  window_end     timestamptz,
  last_run_at    timestamptz,
  last_status    text not null default 'idle'
                   check (last_status in ('idle', 'running', 'ok', 'error')),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint calendar_sync_state_space_calendar_direction_key
    unique (space_id, calendar_id, direction)
);

create trigger calendar_sync_state_touch before update on orbit.calendar_sync_state
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- free_busy_shares — grants one profile availability-only sight of a space.
-- The policy layer is unchanged from any other table (decision 3); what makes
-- it free/busy is that members holding role 'free_busy' fail can_read_space(),
-- so they never see events at all — the merged calendar renders anonymous
-- blocks from this table instead.
-- ---------------------------------------------------------------------------
create table orbit.free_busy_shares (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references orbit.spaces(id) on delete cascade,
  owner_id     uuid not null references orbit.profiles(id) on delete cascade,
  grantee_id   uuid not null references orbit.profiles(id) on delete cascade,
  granularity  text not null default 'block'
                 check (granularity in ('block', 'busy_only')),
  starts_on    date,
  ends_on      date,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint free_busy_shares_space_grantee_key unique (space_id, grantee_id)
);

create trigger free_busy_shares_touch before update on orbit.free_busy_shares
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
select app.apply_standard_rls('calendar_accounts');
select app.apply_standard_rls('calendars');
select app.apply_standard_rls('events', p_has_visibility => true);
select app.apply_standard_rls('event_attendees');
select app.apply_standard_rls('calendar_sync_state');

-- free_busy_shares: readable by space members AND by the grantee (who by
-- definition cannot read the space's content).
alter table orbit.free_busy_shares enable row level security;
grant select, insert, update, delete on orbit.free_busy_shares to authenticated;

create policy free_busy_shares_select on orbit.free_busy_shares for select to authenticated
using (app.can_read_space(space_id) or grantee_id = auth.uid());

create policy free_busy_shares_insert on orbit.free_busy_shares for insert to authenticated
with check (app.is_space_admin(space_id) and owner_id = auth.uid());

create policy free_busy_shares_update on orbit.free_busy_shares for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));

create policy free_busy_shares_delete on orbit.free_busy_shares for delete to authenticated
using (app.is_space_admin(space_id) or grantee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- app.free_busy_blocks() — the ONLY way a free_busy participant reaches event
-- times. Returns anonymous blocks: no title, no attendees, no category.
-- SECURITY DEFINER, and it re-checks the grant itself.
-- ---------------------------------------------------------------------------
create or replace function app.free_busy_blocks(
  p_space_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, all_day boolean)
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select e.starts_at, e.ends_at, e.all_day
  from orbit.events e
  where e.space_id = p_space_id
    and e.status <> 'cancelled'
    and e.starts_at < p_to
    and e.ends_at > p_from
    and (
      app.can_read_space(p_space_id)
      or exists (
        select 1 from orbit.free_busy_shares s
        where s.space_id = p_space_id
          and s.grantee_id = auth.uid()
          and s.revoked_at is null
          and (s.starts_on is null or s.starts_on <= p_to::date)
          and (s.ends_on is null or s.ends_on >= p_from::date)
      )
    )
  order by e.starts_at
$$;

grant execute on function app.free_busy_blocks(uuid, timestamptz, timestamptz) to authenticated;
