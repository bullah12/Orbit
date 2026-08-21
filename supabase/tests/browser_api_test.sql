-- browser_api_test.sql — the exposed browser wrappers preserve existing RLS.

begin;

set client_min_messages = warning;
create extension if not exists pgtap;

select plan(22);

create schema tests;

create function tests.act_as(p_user uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user)::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.as_owner() returns void
language plpgsql
as $$ begin execute 'reset role'; end $$;

create function tests.invite_hash(p_token text) returns text
language sql immutable
as $$ select encode(digest(p_token, 'sha256'), 'hex') $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into orbit.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice-api@example.com', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'bob-api@example.com', 'Bob'),
  ('33333333-3333-3333-3333-333333333333', 'carol-api@example.com', 'Carol'),
  ('44444444-4444-4444-4444-444444444444', 'mallory-api@example.com', 'Mallory');

insert into orbit.spaces (id, owner_id, name, kind, colour, icon, short_label) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Home', 'household', 'orange', 'home', 'Home'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Project', 'project', 'slate', 'circle', 'Project');

insert into orbit.space_members (space_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'free_busy'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner');

insert into orbit.tasks (id, space_id, owner_id, title) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Home task');

insert into orbit.events (space_id, owner_id, title, starts_at, ends_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Private title', '2026-08-19 09:00+00', '2026-08-19 10:00+00');

insert into orbit.free_busy_shares (space_id, owner_id, grantee_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

insert into orbit.space_invites (space_id, owner_id, token_hash, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', tests.invite_hash('api-invite'), 'member');

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok($$select orbit.ensure_account()$$, 'account repair wrapper is callable by an authenticated user');
select lives_ok($$select orbit.ensure_default_spaces()$$, 'default-space wrapper is callable by an authenticated user');
select lives_ok($$select orbit.create_space('Browser space')$$, 'space creation wrapper creates atomically');
select is((select count(*)::int from orbit.spaces where name = 'Browser space'), 1, 'created space is visible to its creator');
select is((select count(*)::int from orbit.space_members m join orbit.spaces s on s.id = m.space_id where s.name = 'Browser space' and m.user_id = auth.uid()), 1, 'created space includes only the caller as initial member');

select is((orbit.invite_preview('api-invite') ->> 'status'), 'already_member', 'invite preview delegates without exposing the invite table');
select is((select count(*)::int from orbit.search('Home')), 1, 'search returns readable matching records');

select is((select count(*)::int from orbit.space_move_preview('task', 'aaaaaaaa-1000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')), 2, 'move preview returns only content-capable membership changes');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from orbit.events), 0, 'free-busy caller still cannot read event rows');
select is((select count(*)::int from orbit.free_busy_blocks('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-19 00:00+00', '2026-08-20 00:00+00')), 1, 'free-busy wrapper returns an anonymous block');

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is((select count(*)::int from orbit.free_busy_blocks('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-19 00:00+00', '2026-08-20 00:00+00')), 0, 'outsider cannot widen free-busy results');
select is((select count(*)::int from orbit.free_busy_recurring('aaaaaaaa-0000-0000-0000-000000000001', '2026-08-19 00:00+00', '2026-08-20 00:00+00')), 0, 'outsider cannot obtain recurring free-busy rules');
select is(jsonb_array_length(orbit.dashboard('2026-08-19 00:00+00', '2026-08-20 00:00+00') -> 'tasks'), 0, 'outsider cannot widen dashboard task results');
select is((select count(*)::int from orbit.search('Home')), 0, 'outsider cannot widen search results');
select throws_ok($$select * from orbit.space_move_preview('task', 'aaaaaaaa-1000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')$$, 'P0002', null, 'outsider cannot inspect a move');
select is((orbit.invite_preview('no-such-token') ->> 'status'), 'unknown', 'unknown invite does not reveal whether a space exists');

select tests.as_owner();

select ok(has_schema_privilege('authenticated', 'orbit', 'USAGE'), 'authenticated has orbit schema usage');
select is((select count(*)::int from information_schema.routine_privileges where specific_schema = 'orbit' and routine_name in ('ensure_account', 'ensure_default_spaces', 'create_space', 'invite_preview', 'invite_accept', 'invite_decline', 'space_move_preview', 'free_busy_blocks', 'free_busy_recurring', 'dashboard', 'search') and grantee = 'PUBLIC' and privilege_type = 'EXECUTE'), 0, 'PUBLIC can execute no browser wrapper');
select is((select count(*)::int from information_schema.routine_privileges where specific_schema = 'orbit' and routine_name in ('ensure_account', 'ensure_default_spaces', 'create_space', 'invite_preview', 'invite_accept', 'invite_decline', 'space_move_preview', 'free_busy_blocks', 'free_busy_recurring', 'dashboard', 'search') and grantee = 'anon' and privilege_type = 'EXECUTE'), 0, 'anonymous users can execute no browser wrapper');
select is((select count(*)::int from information_schema.routines where routine_schema = 'orbit' and routine_name in ('ensure_account', 'ensure_default_spaces', 'create_space', 'invite_preview', 'invite_accept', 'invite_decline', 'space_move_preview', 'free_busy_blocks', 'free_busy_recurring', 'dashboard', 'search') and security_type <> 'INVOKER'), 0, 'every browser wrapper is SECURITY INVOKER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'orbit' and p.proname in ('ensure_account', 'ensure_default_spaces', 'create_space', 'invite_preview', 'invite_accept', 'invite_decline', 'space_move_preview', 'free_busy_blocks', 'free_busy_recurring', 'dashboard', 'search') and array_to_string(p.proconfig, ',') like '%public%'), 0, 'browser wrapper search paths contain no public schema');
select is((select count(*)::int from information_schema.routines where routine_schema = 'orbit' and routine_name in ('ensure_account', 'ensure_default_spaces', 'create_space', 'invite_preview', 'invite_accept', 'invite_decline', 'space_move_preview', 'free_busy_blocks', 'free_busy_recurring', 'dashboard', 'search')), 11, 'orbit exposes exactly the eleven reviewed browser wrappers');

select * from finish();
rollback;
