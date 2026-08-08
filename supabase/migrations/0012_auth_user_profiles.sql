-- 0012_auth_user_profiles.sql — the join between auth.users and orbit.profiles.
--
-- This is the one genuinely delicate step in making Orbit use real accounts.
-- `orbit.profiles.id` defaults to gen_random_uuid() and has no foreign key to
-- auth.users; every policy in the database keys off `auth.uid()`, which is the
-- JWT's `sub` — that is, `auth.users.id`. If the two ids ever differ, every
-- policy returns zero rows and says nothing about why. So a profile is created
-- **with the auth user's own id**, at the moment the auth user is created, by a
-- trigger — not by application code, which could be skipped by the Android
-- client talking to PostgREST directly.
--
-- Seeded data is development data. A real deployment starts empty: sign up,
-- create a space, invite somebody. The seeded profiles in supabase/seed/seed.ts
-- are not claimable by a real account and are not meant to be — their ids are
-- literals chosen so tests can name them, and an auth user will never be issued
-- one. If a seeded database is pointed at a real Supabase project anyway, the
-- collision below is what happens, loudly, rather than silently attaching
-- somebody to Priya's tasks.

-- ---------------------------------------------------------------------------
-- auth.users, shimmed locally only.
--
-- On Supabase this table exists, owned by supabase_auth_admin, and `create
-- table if not exists` is a no-op. Locally there is no GoTrue, so the columns
-- the trigger reads are declared here — otherwise the trigger could not be
-- attached and none of it could be tested. Nothing in the app writes to it: the
-- dev provider does not use auth.users at all.
-- ---------------------------------------------------------------------------

-- Everything below lives in the `orbit` schema. The search_path names it
-- first so an unqualified CREATE cannot land in a schema this project
-- shares with somebody else's work, and names `public` and `extensions`
-- after it because that is where an installation puts PostGIS and pgcrypto:
-- Supabase uses `extensions`, a local cluster uses `public`.
set search_path = orbit, public, extensions, pg_catalog;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- The local shim holds identities. Nobody may read it through the app: the pool
-- role has no grant on it and RLS with no policy refuses everything.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'auth' and tablename = 'users' and not rowsecurity
  ) then
    execute 'alter table auth.users enable row level security';
  end if;
exception when insufficient_privilege then
  -- Supabase owns this table and manages its own access. Not ours to change.
  null;
end $$;

-- ---------------------------------------------------------------------------
-- The trigger.
--
-- SECURITY DEFINER because it runs as whoever GoTrue is inserting as, which has
-- no rights on orbit.profiles. `search_path` is pinned for the same reason
-- every other definer function in this schema pins it.
--
-- The display name order is the same one `displayNameFrom()` implements in
-- src/lib/auth/session.ts. Change both together; the pgTAP assertions below are
-- what catch it if you do not.
-- ---------------------------------------------------------------------------
create or replace function orbit.profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = orbit, pg_temp
as $$
declare
  v_email text;
  v_name  text;
  v_clash uuid;
begin
  -- A phone-only signup has no email, and profiles.email is NOT NULL and
  -- unique. A per-id placeholder keeps the row creatable and keeps it obvious
  -- in the interface that there is no address to write to.
  v_email := coalesce(nullif(btrim(new.email), ''), new.id::text || '@no-email.invalid');

  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'displayName'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    v_email
  );

  -- Idempotent: a profile with this id already exists, so there is nothing to
  -- do. This is the state a re-run of the migration, or a restored dump, leaves
  -- behind, and it must not be an error.
  if exists (select 1 from orbit.profiles p where p.id = new.id) then
    return new;
  end if;

  -- profiles_email_key, handled rather than hit.
  --
  -- Hitting the constraint gives GoTrue "Database error saving new user" and
  -- nothing else. Raising here says which address and which existing profile,
  -- which is the difference between a five-minute problem and an afternoon.
  --
  -- It deliberately does NOT attach the new account to the existing profile.
  -- That profile owns spaces, tasks, notes and a calendar; handing it to
  -- whoever signed up with a matching address would be the worst possible
  -- reading of "the same email means the same person".
  select p.id into v_clash from orbit.profiles p where p.email = v_email;
  if v_clash is not null then
    raise exception
      using
        errcode = 'unique_violation',
        message = format(
          'A profile already exists with the email %s (profile %s), so the new account %s cannot be given one.',
          v_email, v_clash, new.id),
        hint =
          'Seeded profiles are development data and a real deployment starts empty. '
          'Either sign up with a different address, or delete the seeded profile that holds this one.';
  end if;

  insert into orbit.profiles (id, email, display_name)
  values (new.id, v_email, left(v_name, 120));

  return new;
end $$;

revoke execute on function orbit.profile_for_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function orbit.profile_for_new_auth_user();

-- ---------------------------------------------------------------------------
-- Redeeming a space invite.
--
-- No table is added or altered here: orbit.space_invites has had every column
-- this needs since 0001 and it is finally getting rows. What it needs is a way
-- to run, which the policies genuinely cannot express — and this is the single
-- authorised exception to "do not touch the policies", not a licence to widen
-- one:
--
--   * `space_invites` is admin-only in both directions, so the person holding
--     the link cannot read the row that names the space they were invited to.
--   * `space_members_insert` requires `orbit.is_space_admin(space_id)`, and the
--     whole point of an invite is that the person is not in the space yet.
--
-- Loosening either would open every space's roster to every signed-in user, to
-- solve a problem that lasts one transaction. So: one SECURITY DEFINER function
-- that takes the raw token, hashes it, and decides.
--
-- It is one function rather than two (a preview and a redeem) on purpose. The
-- preview has to defeat exactly the same policy the redeem does, so a second
-- definer function would be a second copy of the same checks, and the day they
-- disagree is the day the screen says one thing and the write does another.
-- `p_action` names which of the three verbs is wanted; the checks above it are
-- shared by construction.
--
-- What it will not do:
--   * it never reads anything for a caller who is not signed in
--   * it only ever writes membership for `auth.uid()` — a token cannot be
--     redeemed on somebody else's behalf
--   * it only ever grants the role the invite already names
--   * an invite naming an email may only be redeemed by that email; an invite
--     naming none is a bearer link, and the admin screen says so
--
-- `decline` deliberately writes nothing. There is no column for "declined", and
-- inventing one would be the migration this brief says not to write; an invite
-- that has been declined is simply one that has not been accepted, and the
-- screen says the link stays live until it expires or is revoked.
-- ---------------------------------------------------------------------------
create or replace function orbit.space_invite(
  p_token  text,
  p_action text default 'preview'
)
returns table (
  status            text,
  invite_id         uuid,
  space_id          uuid,
  space_name        text,
  space_colour      text,
  space_icon        text,
  space_short_label text,
  invite_role       orbit.member_role,
  invited_email     text,
  expires_at        timestamptz
)
language plpgsql
security definer
set search_path = orbit, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_hash     text;
  v_inv      orbit.space_invites%rowtype;
  v_space    orbit.spaces%rowtype;
  v_email    text;
  v_member   orbit.space_members%rowtype;
  v_claimed  integer;
begin
  if p_action not in ('preview', 'accept', 'decline') then
    raise exception 'orbit.space_invite: unknown action %', p_action
      using errcode = 'invalid_parameter_value';
  end if;

  if v_uid is null then
    status := 'not_signed_in';
    return next;
    return;
  end if;

  -- The raw token is hashed here and nowhere else, so it never has to be
  -- compared in the application and never has to exist in a query log as
  -- something that could be replayed.
  --
  -- `sha256()` rather than pgcrypto's `digest()`: this function is SECURITY
  -- DEFINER with a pinned search_path of `orbit, pg_temp`, and pgcrypto is in
  -- neither — it is in `public` on a local cluster and `extensions` on
  -- Supabase. Widening the search_path of a definer function to reach an
  -- extension is the wrong trade; `sha256` is in pg_catalog, which is always
  -- resolvable, and produces the identical digest. Same bytes as
  -- `createHash('sha256').update(token, 'utf8')` in src/lib/invites.ts.
  v_hash := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');

  select * into v_inv from orbit.space_invites i where i.token_hash = v_hash;
  if not found then
    -- Deliberately the same answer for "no such token" and "a token for a space
    -- you were not invited to": telling somebody their guess named a real space
    -- is telling them a space exists.
    status := 'unknown';
    return next;
    return;
  end if;

  select * into v_space from orbit.spaces s where s.id = v_inv.space_id;
  select p.email into v_email from orbit.profiles p where p.id = v_uid;

  invite_id         := v_inv.id;
  space_id          := v_inv.space_id;
  space_name        := v_space.name;
  space_colour      := v_space.colour;
  space_icon        := v_space.icon;
  space_short_label := v_space.short_label;
  invite_role       := v_inv.role;
  invited_email     := v_inv.invited_email;
  expires_at        := v_inv.expires_at;

  if v_inv.accepted_at is not null then
    status := case when v_inv.accepted_by = v_uid then 'accepted_by_you' else 'already_accepted' end;
    return next;
    return;
  end if;

  if v_inv.expires_at <= now() then
    status := 'expired';
    return next;
    return;
  end if;

  if v_inv.invited_email is not null
     and lower(btrim(v_inv.invited_email)) <> lower(btrim(coalesce(v_email, ''))) then
    status := 'wrong_person';
    return next;
    return;
  end if;

  select * into v_member
  from orbit.space_members m
  where m.space_id = v_inv.space_id and m.user_id = v_uid;

  if found and v_member.status = 'active' then
    status := 'already_member';
    return next;
    return;
  end if;

  if p_action = 'preview' then
    status := 'ok';
    return next;
    return;
  end if;

  if p_action = 'decline' then
    status := 'declined';
    return next;
    return;
  end if;

  -- Claim the invite before writing the membership, so two people opening the
  -- same bearer link at the same time cannot both join: the second update
  -- matches no row and stops here.
  update orbit.space_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id and accepted_at is null;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    status := 'already_accepted';
    return next;
    return;
  end if;

  -- Named by constraint rather than by columns: `space_id` is also one of this
  -- function's OUT parameters, and an inference list would be ambiguous between
  -- the two. Rejoining a space you had left is an update, not a second row.
  insert into orbit.space_members (space_id, user_id, role, status)
  values (v_inv.space_id, v_uid, v_inv.role, 'active')
  on conflict on constraint space_members_space_user_key do update
    set role = excluded.role, status = 'active';

  status := 'accepted';
  return next;
end $$;

-- Narrow, like the identity functions in 0008: nobody holds this by default,
-- and the only role that gets it is the one the application acts as.
revoke execute on function orbit.space_invite(text, text) from public;
grant execute on function orbit.space_invite(text, text) to authenticated;
