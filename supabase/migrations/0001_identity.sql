-- 0001_identity.sql — profiles, spaces, membership, categories, devices.

-- ---------------------------------------------------------------------------
-- profiles — one row per human. Not space-scoped: a profile exists before any
-- space does. Visibility is "people I share a space with, plus me".
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  display_name    text not null,
  avatar_url      text,
  timezone        text not null default 'Europe/London',
  locale          text not null default 'en-GB',
  week_starts_on  smallint not null default 1 check (week_starts_on between 0 and 6),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint profiles_email_key unique (email)
);

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- spaces — the unit of sharing. `spaces.id` IS the space_id everywhere else.
-- ---------------------------------------------------------------------------
create table public.spaces (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete restrict,
  name          text not null,
  kind          app.space_kind not null default 'personal',
  -- The space indicator's three parts. Colour is never used without both.
  colour        text not null default 'slate',
  icon          text not null default 'circle',
  short_label   text not null,
  is_default    boolean not null default false,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint spaces_short_label_len check (char_length(short_label) between 1 and 12)
);

create trigger spaces_touch before update on public.spaces
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- space_members — membership grant. `free_busy` members see availability only.
-- ---------------------------------------------------------------------------
create table public.space_members (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        app.member_role not null default 'member',
  status      text not null default 'active' check (status in ('active', 'suspended', 'left')),
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint space_members_space_user_key unique (space_id, user_id)
);

create index space_members_user_idx on public.space_members (user_id, status);

create trigger space_members_touch before update on public.space_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- space_invites — no email delivery (decision 7 rules out email-in; invites are
-- link-based). Token is stored hashed.
-- ---------------------------------------------------------------------------
create table public.space_invites (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  token_hash    text not null,
  role          app.member_role not null default 'member',
  invited_email text,
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint space_invites_space_token_key unique (space_id, token_hash)
);

create trigger space_invites_touch before update on public.space_invites
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- categories — the ONLY source of strong colour in the UI, and never rendered
-- without its icon and label.
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  slug        text not null,
  colour      text not null,
  icon        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_space_slug_key unique (space_id, slug)
);

create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- devices — one row per browser/installation. Holds the E2EE public key and the
-- push endpoint. Space-scoped so a device registered for a personal space does
-- not leak into a household one.
-- ---------------------------------------------------------------------------
create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  label          text not null,
  platform       text not null default 'web',
  public_key     text,
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint devices_space_owner_label_key unique (space_id, owner_id, label)
);

create trigger devices_touch before update on public.devices
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================

-- profiles: me, plus anyone who shares an active space with me.
alter table public.profiles enable row level security;
grant select, update on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.space_members mine
    join public.space_members theirs on theirs.space_id = mine.space_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = public.profiles.id
      and theirs.status = 'active'
  )
);

create policy profiles_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- spaces: members can see the space itself, including free_busy members (they
-- need the name and indicator to render an anonymous block). Only admins edit.
alter table public.spaces enable row level security;
grant select, insert, update, delete on public.spaces to authenticated;

create policy spaces_select on public.spaces for select to authenticated
using (app.is_space_member(id));

create policy spaces_insert on public.spaces for insert to authenticated
with check (owner_id = auth.uid());

create policy spaces_update on public.spaces for update to authenticated
using (app.is_space_admin(id)) with check (app.is_space_admin(id));

create policy spaces_delete on public.spaces for delete to authenticated
using (owner_id = auth.uid());

-- space_members: members see the roster of their own spaces. Admins manage it;
-- anyone may remove themselves.
alter table public.space_members enable row level security;
grant select, insert, update, delete on public.space_members to authenticated;

create policy space_members_select on public.space_members for select to authenticated
using (app.is_space_member(space_id));

create policy space_members_insert on public.space_members for insert to authenticated
with check (app.is_space_admin(space_id));

create policy space_members_update on public.space_members for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));

create policy space_members_delete on public.space_members for delete to authenticated
using (app.is_space_admin(space_id) or user_id = auth.uid());

-- space_invites: admins only, in both directions.
alter table public.space_invites enable row level security;
grant select, insert, update, delete on public.space_invites to authenticated;

create policy space_invites_select on public.space_invites for select to authenticated
using (app.is_space_admin(space_id));

create policy space_invites_insert on public.space_invites for insert to authenticated
with check (app.is_space_admin(space_id) and owner_id = auth.uid());

create policy space_invites_update on public.space_invites for update to authenticated
using (app.is_space_admin(space_id)) with check (app.is_space_admin(space_id));

create policy space_invites_delete on public.space_invites for delete to authenticated
using (app.is_space_admin(space_id));

select app.apply_standard_rls('categories');
select app.apply_standard_rls('devices');
