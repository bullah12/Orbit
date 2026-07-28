-- 0008_identity_lookup.sql — the identity-provider surface.
--
-- Establishing *who the caller is* necessarily happens before RLS can help:
-- resolving a session cookie to a profile is the question "who are you?", and
-- there is no `auth.uid()` yet to answer it with.
--
-- On a real Supabase project this is Supabase Auth's job and these functions go
-- away. Locally they are the seam. They are deliberately narrow:
--
--   * two functions, both read-only
--   * five columns, none of them content
--   * execute granted to orbit_app ONLY — not to `authenticated`, which already
--     reads profiles through the policy in 0001
--
-- The alternative, granting orbit_app SELECT on public.profiles, silently
-- returns zero rows (RLS is enabled and no policy names that role) and would
-- have to be widened until it worked. This cannot be widened by accident.

create or replace function app.identity_profile(p_user_id uuid)
returns table (
  id uuid,
  email text,
  display_name text,
  timezone text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.email, p.display_name, p.timezone
  from public.profiles p
  where p.id = p_user_id
$$;

-- Used by the dev user switcher, which needs to list who you can become. A real
-- auth provider has no equivalent and would not grant this.
create or replace function app.identity_profiles()
returns table (
  id uuid,
  email text,
  display_name text,
  timezone text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.email, p.display_name, p.timezone
  from public.profiles p
  order by p.created_at
$$;

revoke execute on function app.identity_profile(uuid) from public;
revoke execute on function app.identity_profiles() from public;
