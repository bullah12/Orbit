-- 0003_people.sql — people, and the same-person linking model.
--
-- Decision 4: the same human appearing in two spaces is TWO records, linked
-- permanently, never collapsed and never auto-merged. `person_links` is that
-- link. It is deliberately symmetric and deliberately has no "primary" side.

create table public.people (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  category_id    uuid references public.categories(id) on delete set null,

  -- A person record may correspond to an Orbit user. Usually it does not.
  profile_id     uuid references public.profiles(id) on delete set null,

  display_name   text not null,
  given_name     text,
  family_name    text,
  nickname       text,
  pronouns       text,
  notes_md       text not null default '',
  visibility     app.visibility not null default 'space',
  is_locked      boolean not null default false,
  archived_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint people_locked_has_no_plaintext
    check (not is_locked or (display_name = '' and notes_md = ''))
);

create index people_space_name_idx on public.people (space_id, display_name);
create index people_search_idx on public.people
  using gin (to_tsvector('english', display_name || ' ' || coalesce(nickname, '') || ' ' || notes_md))
  where not is_locked;

create trigger people_touch before update on public.people
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- person_links — "these two records are the same human".
--
-- Stored once per pair with a canonical ordering (a < b) so the pair cannot be
-- double-inserted. Crossing spaces is the whole point, so this table is scoped
-- to the space of side A and readable from either side.
-- ---------------------------------------------------------------------------
create table public.person_links (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references public.spaces(id) on delete cascade,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  person_a_id     uuid not null references public.people(id) on delete cascade,
  person_b_id     uuid not null references public.people(id) on delete cascade,
  person_b_space  uuid not null references public.spaces(id) on delete cascade,
  confidence      text not null default 'confirmed'
                    check (confidence in ('confirmed', 'suggested')),
  linked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint person_links_space_pair_key unique (space_id, person_a_id, person_b_id),
  constraint person_links_canonical_order check (person_a_id < person_b_id),
  constraint person_links_distinct check (person_a_id <> person_b_id)
);

create index person_links_b_idx on public.person_links (person_b_id);

create trigger person_links_touch before update on public.person_links
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- person_contacts / person_dates / person_relationships
-- ---------------------------------------------------------------------------
create table public.person_contacts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  kind        text not null check (kind in ('email', 'phone', 'address', 'handle', 'url')),
  label       text not null default 'other',
  value       text not null,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint person_contacts_space_person_kind_value_key unique (space_id, person_id, kind, value)
);

create index person_contacts_person_idx on public.person_contacts (person_id);

create trigger person_contacts_touch before update on public.person_contacts
  for each row execute function app.touch_updated_at();

create table public.person_dates (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  person_id    uuid not null references public.people(id) on delete cascade,
  kind         text not null check (kind in ('birthday', 'anniversary', 'met_on', 'other')),
  label        text,
  on_date      date not null,
  -- Birthdays where the year is unknown are common. Store 1900 and set this.
  year_known   boolean not null default true,
  remind_days  integer not null default 7 check (remind_days >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint person_dates_space_person_kind_date_key unique (space_id, person_id, kind, on_date)
);

create index person_dates_month_day_idx on public.person_dates
  (space_id, (extract(month from on_date)), (extract(day from on_date)));

create trigger person_dates_touch before update on public.person_dates
  for each row execute function app.touch_updated_at();

create table public.person_relationships (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  related_id    uuid not null references public.people(id) on delete cascade,
  relationship  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint person_relationships_space_pair_key unique (space_id, person_id, related_id, relationship),
  constraint person_relationships_distinct check (person_id <> related_id)
);

create trigger person_relationships_touch before update on public.person_relationships
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
select app.apply_standard_rls('people', p_has_visibility => true);
select app.apply_standard_rls('person_contacts');
select app.apply_standard_rls('person_dates');
select app.apply_standard_rls('person_relationships');

-- person_links is the one place where a row legitimately spans two spaces. You
-- may read the link if you can read EITHER side; you may only create one if you
-- can write BOTH sides, which is what stops a link being used to smuggle a
-- person record into a space you cannot see.
alter table public.person_links enable row level security;
grant select, insert, update, delete on public.person_links to authenticated;

create policy person_links_select on public.person_links for select to authenticated
using (app.can_read_space(space_id) or app.can_read_space(person_b_space));

create policy person_links_insert on public.person_links for insert to authenticated
with check (
  owner_id = auth.uid()
  and app.can_write_space(space_id)
  and app.can_write_space(person_b_space)
);

create policy person_links_update on public.person_links for update to authenticated
using (app.can_write_space(space_id) and app.can_write_space(person_b_space))
with check (app.can_write_space(space_id) and app.can_write_space(person_b_space));

-- Unlinking is destructive and permanent (decision 4 says links are permanent,
-- so this is admin-only and exists for mistakes, not for merging).
create policy person_links_delete on public.person_links for delete to authenticated
using (app.is_space_admin(space_id) and app.is_space_admin(person_b_space));
