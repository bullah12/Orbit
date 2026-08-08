-- 0000_bootstrap.sql
-- Extensions, Supabase-compatible auth shim, roles, and the `app` helper schema.
--
-- On a real Supabase project the `auth` schema and the three roles already exist;
-- every statement here is guarded so this migration is a no-op there.

-- The membership helpers below reference orbit.space_members, which is created
-- in 0001. Postgres validates `language sql` bodies at CREATE time, so turn that
-- off for this file. Every referenced object exists by the end of 0001.
set check_function_bodies = off;

create extension if not exists pgcrypto;
create extension if not exists postgis;
-- Installed because the environment bootstrap expects it. Nothing in this schema
-- uses it: decision 10 says no pgvector. See docs/decisions-log.md.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- auth shim
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- auth.uid() reads the same GUC Supabase's PostgREST sets. Our own connection
-- pool sets it per request; see src/lib/db/index.ts.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app schema — helper functions used by every policy
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- orbit — where every application table lives.
--
-- Not `public`, deliberately. Orbit shares its Postgres instance with another
-- application whose tables are in `public`, and two applications in one schema
-- is a namespace collision waiting to happen — `profiles` alone exists in both.
-- A schema per application keeps each one's migrations, grants and RLS its own.
--
-- Every reference in this repository is schema-qualified (`orbit.tasks`, never
-- a bare `tasks`), so this is not a `search_path` trick that a different
-- connection could resolve differently. It is the name of the objects.
-- ---------------------------------------------------------------------------
create schema if not exists orbit;
grant usage on schema orbit to anon, authenticated, service_role;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- Enums -------------------------------------------------------------------
do $$ begin
  create type app.space_kind as enum ('personal', 'household', 'work', 'project');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.member_role as enum ('owner', 'admin', 'member', 'viewer', 'free_busy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.visibility as enum ('space', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.task_status as enum ('todo', 'doing', 'blocked', 'done', 'dropped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.priority as enum ('none', 'low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.entity_kind as enum (
    'task', 'note', 'person', 'event', 'place', 'travel_leg', 'rule', 'space'
  );
exception when duplicate_object then null; end $$;

-- Membership helpers ------------------------------------------------------
-- SECURITY DEFINER so policies on space_members do not recurse into themselves.

create or replace function app.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select exists (
    select 1
    from orbit.space_members m
    where m.space_id = p_space_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function app.space_role(p_space_id uuid)
returns app.member_role
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select m.role
  from orbit.space_members m
  where m.space_id = p_space_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

-- Can the current user see *content* in this space? A free_busy participant is a
-- member for calendar-availability purposes only and must never read content.
create or replace function app.can_read_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select exists (
    select 1
    from orbit.space_members m
    where m.space_id = p_space_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role <> 'free_busy'
  )
$$;

-- Can the current user create/modify content in this space?
create or replace function app.can_write_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select exists (
    select 1
    from orbit.space_members m
    where m.space_id = p_space_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'member')
  )
$$;

create or replace function app.is_space_admin(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select exists (
    select 1
    from orbit.space_members m
    where m.space_id = p_space_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  )
$$;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- The standard RLS pattern.
--
-- Applied to every space-scoped table so policies cannot drift table to table.
-- Read it once here rather than 40 times below.
--
--   select : content-reader in the space, and if the table has a `visibility`
--            column, private rows are visible only to their owner
--   insert : content-writer in the space, and owner_id must be you
--   update : content-writer in the space, and (you own it or you are an admin)
--   delete : same as update
--
-- Anything narrower than this (item_shares, free_busy) gets a hand-written
-- policy and says so at the call site.
-- ---------------------------------------------------------------------------
create or replace function app.apply_standard_rls(
  p_table text,
  p_has_visibility boolean default false,
  p_has_owner boolean default true
)
returns void
language plpgsql
as $$
declare
  v_read_extra text := '';
  v_owner_ins  text := '';
  v_owner_mod  text := '';
begin
  if p_has_visibility then
    v_read_extra := ' and (visibility <> ''private'' or owner_id = auth.uid())';
  end if;

  if p_has_owner then
    v_owner_ins := ' and owner_id = auth.uid()';
    v_owner_mod := ' and (owner_id = auth.uid() or app.is_space_admin(space_id))';
  end if;

  -- Deliberately NOT `force row level security`: the table owner (postgres) must
  -- bypass RLS so migrations, seeds, and pgTAP setup can write. The application
  -- never connects as the owner — it connects as `authenticated`, which is not
  -- the owner and is therefore fully subject to these policies.
  execute format('alter table orbit.%I enable row level security', p_table);

  execute format('drop policy if exists %I on orbit.%I', p_table || '_select', p_table);
  execute format('drop policy if exists %I on orbit.%I', p_table || '_insert', p_table);
  execute format('drop policy if exists %I on orbit.%I', p_table || '_update', p_table);
  execute format('drop policy if exists %I on orbit.%I', p_table || '_delete', p_table);

  execute format(
    'create policy %I on orbit.%I for select to authenticated using (app.can_read_space(space_id)%s)',
    p_table || '_select', p_table, v_read_extra);

  execute format(
    'create policy %I on orbit.%I for insert to authenticated with check (app.can_write_space(space_id)%s)',
    p_table || '_insert', p_table, v_owner_ins);

  execute format(
    'create policy %I on orbit.%I for update to authenticated using (app.can_write_space(space_id)%s) with check (app.can_write_space(space_id)%s)',
    p_table || '_update', p_table, v_owner_mod, v_owner_mod);

  execute format(
    'create policy %I on orbit.%I for delete to authenticated using (app.can_write_space(space_id)%s)',
    p_table || '_delete', p_table, v_owner_mod);

  execute format('grant select, insert, update, delete on orbit.%I to authenticated', p_table);
end $$;

-- Convenience: standard columns every space-scoped table carries.
-- Written out per table rather than generated, so the DDL stays greppable.
