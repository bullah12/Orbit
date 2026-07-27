-- ============================================================================
-- Local-only bootstrap: the parts of a Supabase project that are provided by
-- the platform rather than by our migrations.
--
-- This file is NOT a migration. It exists so the schema in supabase/migrations
-- can be applied to a bare Postgres 16 with no Supabase cloud project, which is
-- the only environment we have. On a real Supabase project every object below
-- already exists and this file must not be run.
-- ============================================================================

-- Roles PostgREST/GoTrue would create.
do $$ begin
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

create schema if not exists extensions;
create schema if not exists auth;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema auth       to authenticated, service_role;

-- GoTrue's users table, reduced to the columns anything here touches.
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- The PostgREST claim plumbing. Identical semantics to Supabase's own auth.uid().
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
