-- 0016_adopt_existing_accounts.sql — accounts that existed before Orbit did.
--
-- 0012 creates a profile when an auth user is created. 0015 gives that profile
-- two spaces. Both are triggers on `insert into auth.users`, and a trigger
-- cannot fire for a row that is already there.
--
-- That is not a rare case, it is the *ordinary* one for a real project. Supabase
-- Auth exists before Orbit's migrations are applied to it: people sign up, or
-- are invited from the dashboard, or are carried over from something else, and
-- then the schema arrives. Every one of those accounts can sign in — the
-- provider falls back to the JWT's own claims so the app renders and says who
-- you are — and then nothing works, because `auth.uid()` names a profile that
-- does not exist and every policy in the database correctly sees a stranger.
--
-- What that looked like: signing in fine, seeing nothing at all, and
--
--     There is no profile for the signed-in account (c9905550-…).
--
-- when trying to make a space. The message was accurate and useless: it named
-- the thing that was missing and offered no way to get it.
--
-- So: adopt them. One function that finds accounts with no profile and no
-- spaces and gives them both, callable three ways —
--
--   * automatically, when such an account next loads a page (`app.ensure_account`)
--   * over the whole project, by an operator (`app.provision_missing_accounts`)
--   * once, at the bottom of this file, for everybody who is already waiting
--
-- ---------------------------------------------------------------------------
-- Where the email comes from, and why not from a parameter
-- ---------------------------------------------------------------------------
--
-- A profile needs an email, and the obvious design — let the application pass
-- the one it just verified — is a privilege escalation. `orbit.profiles.email`
-- is what `app.space_invite()` matches `invited_email` against, so anybody who
-- could choose their own profile email could redeem an invitation addressed to
-- somebody else. And a function granted to `authenticated` is callable by
-- anyone holding a JWT, not only by this application's server.
--
-- So the email is never an argument. It is read, in order, from:
--
--   1. `request.jwt.claims ->> 'email'` — signed by the issuer when the caller
--      is PostgREST, and set by `asUser()` from a session this server verified
--      with GoTrue when the caller is the Next app. Neither can be chosen by
--      the person holding the token.
--   2. `auth.users`, by id. Correct by definition, and available to a definer
--      function owned by the migration role. Guarded, because a project may not
--      grant it.
--   3. `<uuid>@no-email.invalid`, the same placeholder 0012 uses for a
--      phone-only signup. The account works; only invitation-by-address does
--      not, until a real claim turns up and replaces it.

-- ---------------------------------------------------------------------------
-- The JWT's claims, safely.
-- ---------------------------------------------------------------------------
create or replace function app.jwt_claims()
returns jsonb
language plpgsql
stable
as $$
declare
  v_raw text := current_setting('request.jwt.claims', true);
begin
  if v_raw is null or btrim(v_raw) = '' then return '{}'::jsonb; end if;
  return v_raw::jsonb;
exception when others then
  -- A claims string that is not JSON is somebody else's bug, not a reason to
  -- refuse to make a profile.
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------------------
-- Who a given account is, as far as the database can honestly tell.
--
-- Internal: it reads `auth.users`, which nothing outside this schema may do.
-- ---------------------------------------------------------------------------
create or replace function app.identity_of(p_user uuid)
returns table (email text, display_name text, source text)
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_claims jsonb := app.jwt_claims();
  v_email  text;
  v_meta   jsonb;
begin
  -- 1. The token, but only when it is the token for *this* account. A claims
  --    blob naming somebody else is not evidence about p_user.
  if (v_claims ->> 'sub') = p_user::text then
    v_email := nullif(btrim(coalesce(v_claims ->> 'email', '')), '');
    v_meta  := coalesce(v_claims -> 'user_metadata', '{}'::jsonb);
  else
    v_meta := '{}'::jsonb;
  end if;

  -- 2. auth.users. Wrapped, because a project may not grant the owner of this
  --    function anything on that table, and a missing grant must degrade to a
  --    working account rather than a failed sign-in.
  if v_email is null then
    begin
      select nullif(btrim(coalesce(u.email, '')), ''),
             coalesce(u.raw_user_meta_data, '{}'::jsonb)
        into v_email, v_meta
      from auth.users u
      where u.id = p_user;
    exception when insufficient_privilege or undefined_table then
      null;
    end;
  end if;

  source := case
    when v_email is null then 'placeholder'
    when (v_claims ->> 'sub') = p_user::text and (v_claims ? 'email') then 'token'
    else 'auth.users'
  end;

  -- 3. The placeholder, per 0012.
  email := coalesce(v_email, p_user::text || '@no-email.invalid');

  -- The same order `displayNameFrom()` implements in src/lib/auth/session.ts.
  display_name := left(coalesce(
    nullif(btrim(coalesce(v_meta ->> 'display_name', '')), ''),
    nullif(btrim(coalesce(v_meta ->> 'displayName', '')), ''),
    nullif(btrim(coalesce(v_meta ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(v_meta ->> 'name', '')), ''),
    nullif(split_part(email, '@', 1), ''),
    email
  ), 120);

  return next;
end $$;

revoke execute on function app.identity_of(uuid) from public;

-- ---------------------------------------------------------------------------
-- Give an account a profile, if it has none.
--
-- Returns what happened rather than raising, because both callers want to carry
-- on: the per-request one has a page to render, and the project-wide one has
-- the rest of the list to get through. 0012's trigger keeps raising on a
-- collision — at sign-up there is a person waiting for an answer.
-- ---------------------------------------------------------------------------
create or replace function app.claim_profile(p_user uuid)
returns text
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_id      text;
  v_email   text;
  v_name    text;
  v_source  text;
  v_clash   uuid;
begin
  if p_user is null then return 'no_account'; end if;

  if exists (select 1 from orbit.profiles p where p.id = p_user) then
    -- Already here. One repair while we are looking: a profile carrying the
    -- placeholder address gets the real one as soon as a token proves it. This
    -- is the only path that ever changes an existing profile's email, it only
    -- ever runs for the account named in the token, and it never overwrites an
    -- address somebody actually has.
    select i.email, i.source into v_email, v_source from app.identity_of(p_user) i;
    if v_source = 'token' then
      update orbit.profiles p
         set email = v_email
       where p.id = p_user
         and p.email like '%@no-email.invalid'
         and not exists (select 1 from orbit.profiles o where o.email = v_email and o.id <> p_user);
      if found then return 'email_repaired'; end if;
    end if;
    return 'exists';
  end if;

  select i.email, i.display_name into v_email, v_name from app.identity_of(p_user) i;

  select p.id into v_clash from orbit.profiles p where p.email = v_email;
  if v_clash is not null then
    -- Deliberately not adopted into the existing profile. That profile owns
    -- spaces, tasks and a calendar, and handing them to whoever happens to hold
    -- an account with a matching address is the worst reading of "same email,
    -- same person". 0012 makes the same argument at greater length.
    return 'email_taken';
  end if;

  insert into orbit.profiles (id, email, display_name) values (p_user, v_email, v_name);
  return 'created';
end $$;

revoke execute on function app.claim_profile(uuid) from public;

-- ---------------------------------------------------------------------------
-- The per-request repair.
--
-- Called by the application whenever it reads an empty space list, which is
-- true exactly once for an adopted account and never again. Everything it does
-- is a no-op the second time.
-- ---------------------------------------------------------------------------
create or replace function app.ensure_account()
returns table (profile text, spaces_created integer)
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    profile := 'no_account';
    spaces_created := 0;
    return next;
    return;
  end if;

  profile := app.claim_profile(v_uid);

  if profile = 'email_taken' then
    raise exception
      using
        errcode = 'unique_violation',
        message = format(
          'Another profile already uses the email address on this account (%s), so a profile could not be made for it.',
          (select i.email from app.identity_of(v_uid) i)),
        hint =
          'Seeded profiles are development data. Either delete the profile holding that address, '
          'or change the address on one of the two accounts.';
  end if;

  spaces_created := app.provision_default_spaces(v_uid);
  return next;
end $$;

revoke execute on function app.ensure_account() from public;
grant execute on function app.ensure_account() to authenticated;

-- 0015's function, now a thin caller so the application and its tests keep the
-- name they already use. It gained the ability to make the profile too, which
-- is the whole of this migration from the app's point of view.
create or replace function app.ensure_default_spaces()
returns integer
language sql
security definer
set search_path = orbit, public, pg_temp
as $$
  select spaces_created from app.ensure_account()
$$;

revoke execute on function app.ensure_default_spaces() from public;
grant execute on function app.ensure_default_spaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a space no longer refuses an account with no profile.
--
-- It was the right refusal when a missing profile meant identity had come
-- apart. It is the wrong one now that a missing profile is an ordinary, fixable
-- state — so it fixes it and carries on. Everything else about the function is
-- 0015's.
-- ---------------------------------------------------------------------------
create or replace function app.create_space(
  p_name        text,
  p_short_label text default null,
  p_kind        text default 'personal',
  p_colour      text default 'slate',
  p_icon        text default 'circle'
)
returns uuid
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_first boolean;
begin
  if v_uid is null then
    raise exception 'You have to be signed in to create a space.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Adopts the account if this is its first sight of Orbit. Raises, with a
  -- sentence about the collision, only in the one case nobody can automate.
  perform app.ensure_account();

  v_first := not exists (
    select 1 from orbit.space_members m
    where m.user_id = v_uid and m.status = 'active'
  );

  return app.new_space(
    v_uid, p_name, p_short_label, p_kind, p_colour, p_icon, false, v_first);
end $$;

revoke execute on function app.create_space(text, text, text, text, text) from public;
grant execute on function app.create_space(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The whole project at once, for an operator.
--
--   select * from app.provision_missing_accounts();          -- inspect
--   select * from app.provision_missing_accounts(false);     -- and fix
--
-- Inspect by default. A function that changes every account in a project the
-- moment somebody types its name, to see what it would do, is a function that
-- gets run once by accident.
--
-- It returns a row per account it looked at, so the answer to "who is in a bad
-- state and why" is a result set rather than a log line. Deliberately NOT
-- granted to `authenticated`: it acts on everybody, and nothing in the
-- application ever needs it. Run it as the owner, from the SQL editor or a
-- migration.
-- ---------------------------------------------------------------------------
create or replace function app.provision_missing_accounts(p_dry_run boolean default true)
returns table (
  user_id uuid,
  email   text,
  profile text,
  spaces  integer
)
language plpgsql
security definer
set search_path = orbit, public, pg_temp
as $$
declare
  v_row     record;
  v_has_users boolean := true;
begin
  -- Accounts in Supabase Auth with no profile here. Guarded: a project that
  -- does not let this function read auth.users still gets the second half,
  -- which is the profiles-without-spaces case and needs no such grant.
  begin
    perform 1 from auth.users limit 1;
  exception when insufficient_privilege or undefined_table then
    v_has_users := false;
    raise notice
      'auth.users is not readable here, so accounts with no profile cannot be found. '
      'Profiles that exist but have no spaces are still handled.';
  end;

  if v_has_users then
    for v_row in
      select u.id
      from auth.users u
      where not exists (select 1 from orbit.profiles p where p.id = u.id)
      order by u.created_at
    loop
      user_id := v_row.id;
      select i.email into email from app.identity_of(v_row.id) i;

      if p_dry_run then
        profile := 'would_create';
        spaces  := 2;
      else
        profile := app.claim_profile(v_row.id);
        spaces  := case when profile in ('created', 'exists', 'email_repaired')
                        then app.provision_default_spaces(v_row.id)
                        else 0 end;
      end if;
      return next;
    end loop;
  end if;

  -- Profiles that exist but are in no space: the state 0015 backfilled once,
  -- repeated here so one function is the answer to "make every account whole".
  for v_row in
    select p.id, p.email
    from orbit.profiles p
    where not exists (
      select 1 from orbit.space_members m
      where m.user_id = p.id and m.status = 'active'
    )
    order by p.created_at
  loop
    user_id := v_row.id;
    email   := v_row.email;
    profile := 'exists';
    spaces  := case when p_dry_run then 2 else app.provision_default_spaces(v_row.id) end;
    return next;
  end loop;
end $$;

revoke execute on function app.provision_missing_accounts(boolean) from public;

-- ---------------------------------------------------------------------------
-- Everybody who is already waiting.
-- ---------------------------------------------------------------------------
do $$
declare
  v_made integer := 0;
  v_taken integer := 0;
  v_row   record;
begin
  for v_row in select * from app.provision_missing_accounts(false) loop
    if v_row.profile = 'email_taken' then
      v_taken := v_taken + 1;
      raise warning
        'Account % could not be given a profile: the address % already belongs to another profile.',
        v_row.user_id, v_row.email;
    else
      v_made := v_made + v_row.spaces;
    end if;
  end loop;

  if v_made > 0 then
    raise notice 'Adopted accounts that predate Orbit: % spaces created.', v_made;
  end if;
  if v_taken > 0 then
    raise notice '% account(s) need a decision about a duplicate email address.', v_taken;
  end if;
end $$;
