-- space_creation_test.sql
--
-- The first thing a real account does. Migration 0014 exists because it could
-- not be done at all: a fresh profile owns no space, `space_members_insert`
-- asks whether you are an admin of the space you are joining, and the creator
-- of a one-statement-old space is not an admin of it. So creating a space is a
-- SECURITY DEFINER function, and a definer function is exactly the kind of
-- thing that has to be tested from the outside — it runs with the table
-- owner's rights and the only thing keeping it honest is its own body.
--
-- Run with: ./scripts/db-test.sh space_creation

begin;

set client_min_messages = warning;
create extension if not exists pgtap;

select plan(19);

-- ===========================================================================
-- Fixtures. Two profiles and no spaces at all — the state a real deployment is
-- in the moment after its first two people sign up.
-- ===========================================================================
create schema tests;

create function tests.act_as(p_user uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute 'set local role authenticated';
end $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into orbit.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'nadia@example.com', 'Nadia Fell'),
  ('22222222-2222-2222-2222-222222222222', 'omar@example.com',  'Omar Bright');

-- ===========================================================================
-- The chicken and egg this migration exists to break.
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from orbit.spaces),
  0,
  'a new account starts in no space at all, which is why capture had nowhere to write');

-- The two plain inserts, in the order an application would try them. The first
-- is allowed by `spaces_insert`; the second is refused, and that refusal is the
-- whole reason for app.create_space().
insert into orbit.spaces (id, owner_id, name, kind, short_label, colour, icon)
values ('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'Orphan', 'personal', 'Orphan', 'slate', 'circle');

select throws_ok(
  $$insert into orbit.space_members (space_id, user_id, role)
    values ('cccccccc-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'owner')$$,
  '42501',
  null,
  'the creator of a brand new space cannot add themselves to it by hand');

delete from orbit.spaces where id = 'cccccccc-0000-0000-0000-000000000001';

-- ===========================================================================
-- What the function does instead.
-- ===========================================================================
select lives_ok(
  $$select app.create_space('Fell household', null, 'household', 'emerald', 'house')$$,
  'app.create_space() makes the space and the membership together');

select is(
  (select count(*)::int from orbit.spaces),
  1,
  'and the space is one the creator can see');

select is(
  (select m.role::text from orbit.space_members m
   where m.user_id = '11111111-1111-1111-1111-111111111111'),
  'owner',
  'they are its owner');

select is(
  (select m.status from orbit.space_members m
   where m.user_id = '11111111-1111-1111-1111-111111111111'),
  'active',
  'and active, so every policy keyed on membership lets them through');

select is(
  (select s.owner_id from orbit.spaces s limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner_id is auth.uid(), which the caller has no parameter to influence');

select is(
  (select s.is_default from orbit.spaces s limit 1),
  true,
  'the first space is the default one, so every compose surface preselects it');

-- The point of all of it: a write that RLS refused a moment ago now succeeds.
insert into orbit.tasks (space_id, owner_id, title)
select s.id, '11111111-1111-1111-1111-111111111111', 'Put the bins out'
from orbit.spaces s limit 1;

select is(
  (select count(*)::int from orbit.tasks where title = 'Put the bins out'),
  1,
  'and with a space in hand, capture has somewhere to write');

-- ===========================================================================
-- Second and subsequent spaces.
-- ===========================================================================
select lives_ok(
  $$select app.create_space('Work')$$,
  'a second space needs no arguments beyond its name');

select is(
  (select count(*)::int from orbit.spaces where is_default),
  1,
  'and it does not become the default — that stays where it was');

select is(
  (select s.kind::text from orbit.spaces s where s.name = 'Work'),
  'personal',
  'an unstated kind is personal');

-- ===========================================================================
-- What it refuses.
-- ===========================================================================
select throws_ok(
  $$select app.create_space('   ')$$,
  '23514',
  null,
  'a blank name is refused rather than creating a space called nothing');

select throws_ok(
  $$select app.create_space('Holiday', null, 'holiday')$$,
  '23514',
  null,
  'a kind that is not in app.space_kind is refused');

select is(
  (select char_length(s.short_label) from orbit.spaces s
   where s.name = 'Fell household'),
  12,
  'a long name is trimmed to the short label constraint rather than failing the insert');

-- ===========================================================================
-- Isolation. A definer function must not become a way into somebody else's
-- spaces, or a way to make one in their name.
-- ===========================================================================
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.spaces),
  0,
  'somebody else still sees none of it');

select lives_ok(
  $$select app.create_space('Omar')$$,
  'and can make one of their own, from the same empty start');

select is(
  (select count(*)::int from orbit.space_members m
   where m.user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'and creating their own space adds nobody else to anything');

select is(
  (select s.owner_id from orbit.spaces s where s.name = 'Omar'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'the new space belongs to whoever called, and to nobody they might have named');

select * from finish();
rollback;
