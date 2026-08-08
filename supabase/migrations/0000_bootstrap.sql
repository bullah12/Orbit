-- 0000_bootstrap.sql
-- Extensions, Supabase-compatible auth shim, roles, and the `orbit` schema.
--
-- On a real Supabase project the `auth` schema and the three roles already exist;
-- every statement here is guarded so this migration is a no-op there.
--
-- EVERYTHING ORBIT OWNS LIVES IN ONE SCHEMA, `orbit` — tables, enums and the
-- helper functions every policy calls. Orbit creates nothing in `public` and
-- nothing named `app`, so it can be installed into a Supabase project that is
-- already carrying other work without either side having to know about the
-- other. The one exception is the trigger on `auth.users` in 0012, which is
-- unavoidable: that table belongs to Supabase and the profile row has to be
-- created when an account is.

-- The membership helpers below reference orbit.space_members, which is created
-- in 0001. Postgres validates `language sql` bodies at CREATE time, so turn that
-- off for this file. Every referenced object exists by the end of 0001.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- The schema, created before anything that might land in it
-- ---------------------------------------------------------------------------
-- The grant waits until the roles below exist; on a bare cluster they do not
-- yet, and a grant to a role that is missing is an error rather than a no-op.
create schema if not exists orbit;

-- Unqualified names resolve to `orbit` for the rest of this file and every
-- migration after it, so a CREATE that forgets its prefix lands in the right
-- place rather than in a schema shared with somebody else's project. `public`
-- and `extensions` follow it because that is where an installation puts
-- PostGIS and pgcrypto — Supabase uses `extensions`, a local cluster uses
-- `public`, and naming both means the same migration runs in either.
set search_path = orbit, public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Installed into `extensions` where that schema exists (Supabase) and `public`
-- otherwise (a local cluster). Never into `orbit`: an extension is not Orbit's
-- to own, and dropping the schema should not take PostGIS out with it. Each is
-- a no-op when the extension is already installed, wherever it happens to live,
-- which is the usual case on a project that is already carrying other work.
do $$
declare
  v_home text := case
    when exists (select 1 from pg_namespace where nspname = 'extensions')
      then 'extensions' else 'public' end;
  v_ext  text;
begin
  -- `vector` is installed because the environment bootstrap expects it.
  -- Nothing in this schema uses it: decision 10 says no pgvector. See
  -- docs/decisions-log.md.
  foreach v_ext in array array['pgcrypto', 'postgis', 'vector'] loop
    if not exists (select 1 from pg_extension where extname = v_ext) then
      execute format('create extension %I with schema %I', v_ext, v_home);
    end if;
  end loop;
end $$;

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

grant usage on schema orbit to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth shim
-- ---------------------------------------------------------------------------
-- On a bare Postgres cluster this creates what Supabase would have provided.
-- On Supabase it must do nothing at all, and *not being allowed to* is the
-- normal case: the `auth` schema and `auth.uid()` belong to
-- `supabase_auth_admin`, so replacing the function or granting on the schema
-- raises `permission denied for schema auth` even as the `postgres` user.
--
-- That used to abort the whole migration — the file stopped at auth.uid() and
-- nothing after it ran — and `docs/deploy.md` carried a workaround telling you
-- to re-run with ON_ERROR_STOP=0 and read the errors. A migration that only
-- applies if you already know which of its failures are expected is not a
-- migration, so each step is guarded twice instead: skipped when the platform
-- already provides it, and caught if the grant is refused anyway.
--
-- Never `create or replace`: Supabase's own auth.uid() reads exactly the same
-- GUCs, so if one exists it is already correct and overwriting it would be
-- replacing a working platform function with a copy.
create schema if not exists auth;

do $shim$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    raise notice 'auth.uid() already exists — leaving the platform''s own in place';
  else
    -- Reads the same GUC Supabase's PostgREST sets. Our own connection pool
    -- sets it per request; see src/lib/db/index.ts.
    execute $ddl$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$
    $ddl$;
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role'
  ) then
    raise notice 'auth.role() already exists — leaving the platform''s own in place';
  else
    execute $ddl$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
      $body$
    $ddl$;
  end if;

  -- Already granted on Supabase, and not ours to grant there.
  begin
    grant usage on schema auth to anon, authenticated, service_role;
  exception when insufficient_privilege then
    raise notice 'no privilege to grant on schema auth — the platform owns it, which is expected';
  end;
exception when insufficient_privilege then
  raise notice 'no privilege to create the auth shim — the platform provides it, which is expected';
end $shim$;

-- ---------------------------------------------------------------------------
-- Enums and the helper functions every policy calls
-- ---------------------------------------------------------------------------
-- These used to live in a schema of their own called `app`, which separated
-- "a helper" from "a table" at every call site. They sit beside the tables now
-- because a schema named `app` is the kind of name another project in the same
-- Supabase database claims first, and `create schema if not exists app` would
-- have succeeded against it — attaching Orbit's policy helpers to somebody
-- else's schema, quietly. One schema is the stronger boundary, and no helper
-- name collides with a table name.

-- Enums -------------------------------------------------------------------
do $$ begin
  create type orbit.space_kind as enum ('personal', 'household', 'work', 'project');
exception when duplicate_object then null; end $$;

do $$ begin
  create type orbit.member_role as enum ('owner', 'admin', 'member', 'viewer', 'free_busy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type orbit.visibility as enum ('space', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type orbit.task_status as enum ('todo', 'doing', 'blocked', 'done', 'dropped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type orbit.priority as enum ('none', 'low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type orbit.entity_kind as enum (
    'task', 'note', 'person', 'event', 'place', 'travel_leg', 'rule', 'space'
  );
exception when duplicate_object then null; end $$;

-- Membership helpers ------------------------------------------------------
-- SECURITY DEFINER so policies on space_members do not recurse into themselves.

create or replace function orbit.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, pg_temp
as $$
  select exists (
    select 1
    from orbit.space_members m
    where m.space_id = p_space_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function orbit.space_role(p_space_id uuid)
returns orbit.member_role
language sql
stable
security definer
set search_path = orbit, pg_temp
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
create or replace function orbit.can_read_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, pg_temp
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
create or replace function orbit.can_write_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, pg_temp
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

create or replace function orbit.is_space_admin(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = orbit, pg_temp
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
create or replace function orbit.touch_updated_at()
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
create or replace function orbit.apply_standard_rls(
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
    v_owner_mod := ' and (owner_id = auth.uid() or orbit.is_space_admin(space_id))';
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
    'create policy %I on orbit.%I for select to authenticated using (orbit.can_read_space(space_id)%s)',
    p_table || '_select', p_table, v_read_extra);

  execute format(
    'create policy %I on orbit.%I for insert to authenticated with check (orbit.can_write_space(space_id)%s)',
    p_table || '_insert', p_table, v_owner_ins);

  execute format(
    'create policy %I on orbit.%I for update to authenticated using (orbit.can_write_space(space_id)%s) with check (orbit.can_write_space(space_id)%s)',
    p_table || '_update', p_table, v_owner_mod, v_owner_mod);

  execute format(
    'create policy %I on orbit.%I for delete to authenticated using (orbit.can_write_space(space_id)%s)',
    p_table || '_delete', p_table, v_owner_mod);

  execute format('grant select, insert, update, delete on orbit.%I to authenticated', p_table);
end $$;

-- Convenience: standard columns every space-scoped table carries.
-- Written out per table rather than generated, so the DDL stays greppable.
