-- adopt_existing_accounts_test.sql
--
-- Accounts that existed in Supabase Auth before Orbit's migrations reached the
-- project. No trigger ever fired for them, so they have no profile, and every
-- policy correctly treats them as strangers: they sign in, see nothing, and get
-- "There is no profile for the signed-in account (…)" if they try to make a
-- space.
--
-- The interesting half is not that adoption works. It is *where the email comes
-- from*. `orbit.profiles.email` is what `app.space_invite()` matches
-- `invited_email` against, so an account able to choose its own address could
-- redeem an invitation addressed to somebody else — and every function granted
-- to `authenticated` is callable by anyone holding a JWT, not only by this
-- application. So the address is never an argument, and the assertions below
-- pin that: a token can only speak for the account it names, and it can never
-- take an address another profile already holds.
--
-- Run with: ./scripts/db-test.sh adopt_existing

begin;

set client_min_messages = warning;
create extension if not exists pgtap;

select plan(23);

create schema tests;

create function tests.act_as(p_user uuid, p_claims jsonb default null) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    coalesce(p_claims, jsonb_build_object('sub', p_user))::text,
    true);
  execute 'set local role authenticated';
end $$;

create function tests.as_table_owner() returns void
language plpgsql
as $$
begin
  execute 'reset role';
end $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- An account that predates Orbit: the auth.users row exists and the trigger
-- never ran for it. Disabling the trigger for the insert is exactly that state,
-- rather than an approximation of it.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c9905550-0000-0000-0000-00000000000a', 'early@example.com',
   '{"display_name": "Early Bird"}'::jsonb),
  ('c9905550-0000-0000-0000-00000000000b', 'quiet@example.com', '{}'::jsonb);
alter table auth.users enable trigger on_auth_user_created;

-- And somebody who arrived the ordinary way, to collide with later.
insert into orbit.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'taken@example.com', 'Already Here');

-- ===========================================================================
-- The state the bug report described.
-- ===========================================================================
select is(
  (select count(*)::int from orbit.profiles p
   where p.id = 'c9905550-0000-0000-0000-00000000000a'),
  0,
  'an account that predates the migrations has no profile, which is the whole bug');

-- ===========================================================================
-- Inspecting, which is what the function does unless told otherwise.
-- ===========================================================================
select is(
  (select count(*)::int from app.provision_missing_accounts()
   where profile = 'would_create'),
  2,
  'provision_missing_accounts() finds both accounts');

select is(
  (select email from app.provision_missing_accounts()
   where user_id = 'c9905550-0000-0000-0000-00000000000a'),
  'early@example.com',
  'and reports the address it would use, read from auth.users');

-- Scoped to these two accounts: the suite runs against the seeded database,
-- these assertions run as the table owner, and the seeded outsider genuinely
-- has no spaces — so a global count would be measuring the seed.
select is(
  (select count(*)::int from orbit.profiles p
   where p.id in ('c9905550-0000-0000-0000-00000000000a',
                  'c9905550-0000-0000-0000-00000000000b')),
  0,
  'and changes nothing — inspecting is the default, so a stray call is harmless');

-- ===========================================================================
-- Fixing.
-- ===========================================================================
select is(
  (select sum(r.spaces)::int from app.provision_missing_accounts(false) r
   where r.user_id in ('c9905550-0000-0000-0000-00000000000a',
                       'c9905550-0000-0000-0000-00000000000b')),
  4,
  'provision_missing_accounts(false) gives both accounts two spaces each');

select is(
  (select p.display_name from orbit.profiles p
   where p.id = 'c9905550-0000-0000-0000-00000000000a'),
  'Early Bird',
  'the display name comes from the auth user metadata, in the same order the app uses');

select is(
  (select p.display_name from orbit.profiles p
   where p.id = 'c9905550-0000-0000-0000-00000000000b'),
  'quiet',
  'and falls back to the local part of the address when there is no metadata');

select is(
  (select array_agg(s.name order by s.is_default desc, s.name)
   from orbit.spaces s where s.owner_id = 'c9905550-0000-0000-0000-00000000000a'),
  array['Personal', 'Work'],
  'an adopted account gets the same two spaces a new one does');

select is(
  (select count(*)::int from orbit.spaces s
   where s.owner_id = 'c9905550-0000-0000-0000-00000000000a' and s.protected),
  1,
  'including the protected one, so the guarantee is not for new accounts only');

select is(
  (select count(*)::int from app.provision_missing_accounts(false)),
  0,
  'and running it again finds nobody left to fix, seeded accounts included');

-- ===========================================================================
-- The per-request repair, which is what actually rescues somebody mid-session.
-- ===========================================================================
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('c9905550-0000-0000-0000-00000000000c', 'late@example.com');
alter table auth.users enable trigger on_auth_user_created;

select tests.act_as('c9905550-0000-0000-0000-00000000000c');

select is(
  (select app.ensure_default_spaces()),
  2,
  'a signed-in account with no profile is adopted the next time a page reads its spaces');

select is(
  (select p.email from orbit.profiles p
   where p.id = 'c9905550-0000-0000-0000-00000000000c'),
  'late@example.com',
  'with the address read from auth.users, since this token carries none');

-- The reported error, gone. It refused before rather than fixing anything.
select tests.as_table_owner();
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('c9905550-0000-0000-0000-00000000000d', 'maker@example.com');
alter table auth.users enable trigger on_auth_user_created;

select tests.act_as('c9905550-0000-0000-0000-00000000000d');

select lives_ok(
  $$select app.create_space('Weekend cottage')$$,
  'creating a space no longer refuses an account that has no profile yet');

select is(
  (select count(*)::int from orbit.spaces s
   where s.owner_id = 'c9905550-0000-0000-0000-00000000000d'),
  3,
  'it gets Personal, Work, and the space it actually asked for');

-- ===========================================================================
-- Where the address may come from. This is the security-relevant part.
-- ===========================================================================
select tests.act_as(
  'c9905550-0000-0000-0000-00000000000e',
  '{"sub": "c9905550-0000-0000-0000-00000000000e", "email": "token@example.com",
    "user_metadata": {"display_name": "From The Token"}}'::jsonb);

select is(
  (select app.ensure_default_spaces()),
  2,
  'an account with no auth.users row at all is adopted from its token');

select is(
  (select p.email || ' / ' || p.display_name from orbit.profiles p
   where p.id = 'c9905550-0000-0000-0000-00000000000e'),
  'token@example.com / From The Token',
  'and the token is where the address and the name come from');

-- A token is evidence about the account it names and no other. Claims naming
-- somebody else must not be read as identity for this user.
select tests.act_as(
  'c9905550-0000-0000-0000-00000000000f',
  '{"sub": "c9905550-0000-0000-0000-00000000000e", "email": "token@example.com"}'::jsonb);

-- `identity_of` is internal, so this reads it as the owner. The claims are the
-- ones set above and the check being proved lives inside the function, not in
-- who called it.
select tests.as_table_owner();

select is(
  (select i.email from app.identity_of('c9905550-0000-0000-0000-00000000000f') i),
  'c9905550-0000-0000-0000-00000000000f@no-email.invalid',
  'a claims blob naming a different subject is not evidence about this account');

-- The collision. Not adopted into the existing profile, which owns spaces and a
-- calendar — the same argument 0012 makes at greater length.
select tests.act_as(
  'c9905550-0000-0000-0000-000000000010',
  '{"sub": "c9905550-0000-0000-0000-000000000010", "email": "taken@example.com"}'::jsonb);

select throws_ok(
  $$select app.ensure_default_spaces()$$,
  '23505',
  null,
  'a token naming an address another profile already holds is refused, loudly');

-- Read as the owner: `profiles_select` would hide the other profile from this
-- caller, and "I cannot see it" is not the same claim as "it is unchanged".
select tests.as_table_owner();

select is(
  (select p.id from orbit.profiles p where p.email = 'taken@example.com'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'and the profile that holds it is untouched — no account is ever adopted into another');

-- ===========================================================================
-- The placeholder, and the one repair that overwrites an email.
-- ===========================================================================
select tests.as_table_owner();
insert into orbit.profiles (id, email, display_name) values
  ('c9905550-0000-0000-0000-000000000011',
   'c9905550-0000-0000-0000-000000000011@no-email.invalid', 'Placeholder Person'),
  ('c9905550-0000-0000-0000-000000000012', 'real@example.com', 'Real Address');

select tests.act_as(
  'c9905550-0000-0000-0000-000000000011',
  '{"sub": "c9905550-0000-0000-0000-000000000011", "email": "atlast@example.com"}'::jsonb);
select app.ensure_default_spaces();

select is(
  (select p.email from orbit.profiles p where p.id = 'c9905550-0000-0000-0000-000000000011'),
  'atlast@example.com',
  'a placeholder address is replaced once a token proves a real one');

select tests.act_as(
  'c9905550-0000-0000-0000-000000000012',
  '{"sub": "c9905550-0000-0000-0000-000000000012", "email": "different@example.com"}'::jsonb);
select app.ensure_default_spaces();

select is(
  (select p.email from orbit.profiles p where p.id = 'c9905550-0000-0000-0000-000000000012'),
  'real@example.com',
  'but a real address is never overwritten, whatever a token says');

-- ===========================================================================
-- Who may call what.
-- ===========================================================================
select tests.act_as('c9905550-0000-0000-0000-00000000000a');

select throws_ok(
  $$select * from app.provision_missing_accounts(false)$$,
  '42501',
  null,
  'the project-wide function is not callable by a signed-in user — it acts on everybody');

select lives_ok(
  $$select app.ensure_account()$$,
  'while the one that acts only on the caller is exactly what they may call');

select * from finish();
rollback;
