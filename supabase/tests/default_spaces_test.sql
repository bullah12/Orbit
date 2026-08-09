-- default_spaces_test.sql
--
-- Everybody starts with Personal and Work, and Personal cannot be deleted.
--
-- The second half is the interesting one. "Cannot be deleted" is a promise the
-- interface repeats — the button is absent, the server action refuses, and the
-- policy matches no row — but only one of those is a guarantee, and it is the
-- trigger. So this proves the refusal from three directions: as the space's own
-- owner through the policy, as the *table* owner past the policy entirely, and
-- as somebody trying to turn the flag off first.
--
-- Run with: ./scripts/db-test.sh default_spaces

begin;

set client_min_messages = warning;
create extension if not exists pgtap;

select plan(21);

create schema tests;

create function tests.act_as(p_user uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
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

insert into orbit.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'nadia@example.com', 'Nadia Fell'),
  ('22222222-2222-2222-2222-222222222222', 'omar@example.com',  'Omar Bright');

-- ===========================================================================
-- Signing up. The trigger on auth.users does all of it, in one transaction.
-- ===========================================================================
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'wren@example.com');

select is(
  (select count(*)::int from orbit.spaces s where s.owner_id = '33333333-3333-3333-3333-333333333333'),
  2,
  'signing up gets you two spaces, without the application being involved');

select is(
  (select array_agg(s.name order by s.is_default desc, s.name)
   from orbit.spaces s where s.owner_id = '33333333-3333-3333-3333-333333333333'),
  array['Personal', 'Work'],
  'and they are Personal and Work, in that order');

select is(
  (select s.name from orbit.spaces s
   where s.owner_id = '33333333-3333-3333-3333-333333333333' and s.is_default),
  'Personal',
  'Personal is the default, so every compose surface preselects it');

select is(
  (select s.name from orbit.spaces s
   where s.owner_id = '33333333-3333-3333-3333-333333333333' and s.protected),
  'Personal',
  'and Personal is the protected one — the place to write by default is the one that cannot go away');

select is(
  (select count(*)::int from orbit.space_members m
   where m.user_id = '33333333-3333-3333-3333-333333333333'
     and m.role = 'owner' and m.status = 'active'),
  2,
  'they own both, actively, so every policy keyed on membership lets them through');

-- ===========================================================================
-- An account that predates the migration. The application calls this when it
-- reads an empty list.
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from orbit.spaces),
  0,
  'a profile with no spaces starts with none, as it did before');

select is(
  (select app.ensure_default_spaces()),
  2,
  'app.ensure_default_spaces() makes both for the signed-in caller');

select is(
  (select count(*)::int from orbit.spaces),
  2,
  'and they are there');

select is(
  (select app.ensure_default_spaces()),
  0,
  'calling it again does nothing at all — it is safe on every render');

-- The condition is "has no space", not "has no space called Work", so a space
-- somebody deliberately deleted stays deleted.
delete from orbit.spaces where name = 'Work';

select is(
  (select app.ensure_default_spaces()),
  0,
  'and it does not recreate a Work somebody deleted, because Personal is still there');

-- ===========================================================================
-- Personal cannot be deleted. Three ways.
-- ===========================================================================
select is(
  (select count(*)::int from orbit.spaces where protected),
  1,
  'one protected space, and it is the one left standing');

delete from orbit.spaces where protected;

select is(
  (select count(*)::int from orbit.spaces where protected),
  1,
  'deleting it as its owner matches no row — the policy will not have it');

select throws_ok(
  $$update orbit.spaces set protected = false where protected$$,
  '23001',
  null,
  'and it cannot be unprotected first, which would be deleting it in two statements');

-- Past the policy entirely: the table owner, which is what a definer function
-- runs as and what a migration runs as.
select tests.as_table_owner();

select throws_ok(
  $$delete from orbit.spaces where protected$$,
  '23001',
  null,
  'the trigger refuses it for the table owner too, which is the actual guarantee');

select tests.act_as('11111111-1111-1111-1111-111111111111');

-- ===========================================================================
-- Everything else about it is ordinary.
-- ===========================================================================
select lives_ok(
  $$update orbit.spaces set name = 'Me', short_label = 'Me' where protected$$,
  'the protected space can be renamed — it is not deleteable, not frozen');

select is(
  (select s.name from orbit.spaces s where s.protected),
  'Me',
  'and the rename stuck');

select lives_ok(
  $$insert into orbit.tasks (space_id, owner_id, title)
    select s.id, '11111111-1111-1111-1111-111111111111', 'Something'
    from orbit.spaces s where s.protected$$,
  'and it takes writes like any other space');

-- ===========================================================================
-- Work is deletable, which is the other half of the promise.
-- ===========================================================================
select is(
  (select app.create_space('Work', 'Work', 'work', 'sky', 'briefcase')) is not null,
  true,
  'a space made through the ordinary route comes back');

select is(
  (select count(*)::int from orbit.spaces where name = 'Work' and protected),
  0,
  'and it is not protected — the interface has no way to make a second undeletable space');

delete from orbit.spaces where name = 'Work';

select is(
  (select count(*)::int from orbit.spaces where name = 'Work'),
  0,
  'so its owner can delete it');

-- ===========================================================================
-- And none of it reaches anybody else.
-- ===========================================================================
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.spaces),
  0,
  'somebody else sees none of it, protected or otherwise');

select * from finish();
rollback;
