-- rls_isolation_test.sql
--
-- The load-bearing test. Everything else in Orbit assumes the database refuses
-- to hand out rows the caller should not see. This proves it, from the outside,
-- as the `authenticated` role — the same role the application connects as.
--
-- Run with: ./scripts/db-test.sh
--
-- Add a case here whenever you add a table. The structural checks at the end
-- will fail on their own if you add a table without space_id/owner_id or with a
-- unique constraint that does not lead with space_id, but they cannot tell you
-- whether your *policy* is right. Write the isolation case too.

begin;

set client_min_messages = warning;
create extension if not exists pgtap;

select plan(52);

-- ===========================================================================
-- Fixtures. Built as the table owner, so RLS does not apply to the setup.
-- ===========================================================================
create schema tests;

-- Switch the acting user. Role stays `authenticated`; only the claim changes,
-- which is exactly what happens between two HTTP requests in production.
create function tests.act_as(p_user uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.as_owner() returns void
language plpgsql
as $$
begin
  execute 'reset role';
end $$;

-- The acting role must be able to call the switcher, or it can never switch
-- away from itself.
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- People -------------------------------------------------------------------
insert into public.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com',   'Alice Okonkwo'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',     'Bob Whitmore'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com',   'Carol Reeves'),
  ('44444444-4444-4444-4444-444444444444', 'mallory@example.com', 'Mallory Vance');

-- Spaces -------------------------------------------------------------------
insert into public.spaces (id, owner_id, name, kind, short_label, colour, icon) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Alice', 'personal', 'Alice', 'indigo', 'user'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Home', 'household', 'Home', 'emerald', 'house'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Bob', 'personal', 'Bob', 'amber', 'user');

insert into public.space_members (space_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'member'),
  -- Carol is a free/busy participant of Home: she may see that the space exists
  -- and when it is busy, and nothing else.
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'free_busy'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'owner');
-- Mallory is a member of nothing.

-- Content ------------------------------------------------------------------
insert into public.tasks (id, space_id, owner_id, title, visibility) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Renew passport', 'space'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Book boiler service', 'space'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Birthday present for Bob', 'private'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'Put the bins out', 'space');

-- A locked task: no plaintext, ciphertext lives in encrypted_blobs.
insert into public.tasks (id, space_id, owner_id, title, body_md, is_locked) values
  ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', '', '', true);

insert into public.encrypted_blobs (space_id, owner_id, entity_kind, entity_id, ciphertext, nonce)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'task', 'bbbbbbbb-0000-0000-0000-000000000005', 'Y2lwaGVy', 'bm9uY2U=');

insert into public.notes (id, space_id, owner_id, title, body_md) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Boiler service notes', 'Worcester Bosch, serviced annually.');

insert into public.events (id, space_id, owner_id, title, starts_at, ends_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Dentist',
   '2026-08-03 09:00+01', '2026-08-03 09:30+01');

insert into public.people (id, space_id, owner_id, display_name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Dr Iqbal'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Dr Iqbal');

-- ===========================================================================
-- 1. RLS is on, everywhere
-- ===========================================================================
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public'
     and tablename <> 'spatial_ref_sys'
     and not rowsecurity),
  0,
  'every application table has RLS enabled'
);

select isnt(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and tablename <> 'spatial_ref_sys'),
  0,
  'there are application tables to check (guards against a vacuous pass)'
);

select is(
  (select count(*)::int from pg_tables t
   where t.schemaname = 'public'
     and t.tablename <> 'spatial_ref_sys'
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = t.tablename
     )),
  0,
  'every application table has at least one policy'
);

-- ===========================================================================
-- 2. Reading tasks
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.tasks), 5,
  'alice sees all five tasks across her two spaces');

select is((select count(*)::int from public.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 4,
  'alice sees four tasks in Home, including her own private one');

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 3,
  'bob sees three tasks in Home — alice''s private task is hidden from him');

select is((select count(*)::int from public.tasks
           where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 0,
  'bob cannot read a private task by id either');

select is((select count(*)::int from public.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'bob sees nothing in alice''s personal space');

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is((select count(*)::int from public.tasks), 0,
  'mallory, a member of nothing, sees no tasks at all');

select is((select count(*)::int from public.notes), 0, 'mallory sees no notes');
select is((select count(*)::int from public.events), 0, 'mallory sees no events');
select is((select count(*)::int from public.people), 0, 'mallory sees no people');
select is((select count(*)::int from public.spaces), 0, 'mallory sees no spaces');

-- ===========================================================================
-- 3. free_busy is availability-only (decision 3)
-- ===========================================================================
select tests.act_as('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.tasks), 0,
  'a free_busy participant sees no tasks');

select is((select count(*)::int from public.events), 0,
  'a free_busy participant sees no events — not even the titles');

select is((select count(*)::int from public.notes), 0,
  'a free_busy participant sees no notes');

select is((select count(*)::int from public.spaces), 1,
  'a free_busy participant can see that the space exists, to render its indicator');

select tests.as_owner();
insert into public.free_busy_shares (space_id, owner_id, grantee_id)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from app.free_busy_blocks(
    'aaaaaaaa-0000-0000-0000-000000000002',
    '2026-08-01 00:00+01', '2026-08-05 00:00+01')),
  1,
  'a free_busy participant gets anonymous blocks through app.free_busy_blocks()');

select is(
  (select count(*)::int from app.free_busy_blocks(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-08-01 00:00+01', '2026-08-05 00:00+01')),
  0,
  'free_busy blocks are not readable for a space with no grant');

-- ===========================================================================
-- 4. Writing
-- ===========================================================================
select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into public.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'Sneaky')$$,
  '42501',
  null,
  'bob cannot insert a task into a space he is not a member of'
);

select throws_ok(
  $$insert into public.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'Forged owner')$$,
  '42501',
  null,
  'bob cannot insert a task attributed to alice'
);

select lives_ok(
  $$insert into public.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '22222222-2222-2222-2222-222222222222', 'Descale the kettle')$$,
  'bob can insert his own task into a space he belongs to'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$insert into public.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'From a free_busy member')$$,
  '42501',
  null,
  'a free_busy participant cannot write content'
);

-- An UPDATE that matches no visible row is not an error; it changes nothing.
-- That distinction matters: the client must not be able to tell the row exists.
select tests.act_as('22222222-2222-2222-2222-222222222222');

update public.tasks set title = 'Hijacked'
 where id = 'bbbbbbbb-0000-0000-0000-000000000003';

select tests.as_owner();
select is(
  (select title from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000003'),
  'Birthday present for Bob',
  'bob''s update of a private task silently affected nothing'
);

-- ===========================================================================
-- 5. Item shares cannot become a back door
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into public.item_shares (space_id, owner_id, entity_kind, entity_id, grantee_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'task',
            'bbbbbbbb-0000-0000-0000-000000000002',
            '44444444-4444-4444-4444-444444444444')$$,
  '42501',
  null,
  'an item cannot be shared with someone who is not a member of its space'
);

select lives_ok(
  $$insert into public.item_shares (space_id, owner_id, entity_kind, entity_id, grantee_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'task',
            'bbbbbbbb-0000-0000-0000-000000000002',
            '22222222-2222-2222-2222-222222222222')$$,
  'an item can be shared with an existing member of its space'
);

-- ===========================================================================
-- 6. Same-person linking (decision 4)
-- ===========================================================================
select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into public.person_links
      (space_id, owner_id, person_a_id, person_b_id, person_b_space)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '22222222-2222-2222-2222-222222222222',
            'eeeeeeee-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'bob cannot link a person into a space he cannot write to'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.person_links
      (space_id, owner_id, person_a_id, person_b_id, person_b_space)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111',
            'eeeeeeee-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'alice, who can write both spaces, can link the two Dr Iqbal records'
);

select is(
  (select count(*)::int from public.people where display_name = 'Dr Iqbal'),
  2,
  'linking leaves two records — it never collapses or merges them'
);

-- Read the link from each side. This is what the person detail page does, and
-- it is where a careless join would leak the far record's name.
select tests.act_as('22222222-2222-2222-2222-222222222222');

-- The link row lives in Home; person_b is the Home record, person_a is the one
-- in Alice's personal space. Bob is in Home and not in Alice's space.
select is(
  (select count(*)::int from public.person_links
   where person_a_id = 'eeeeeeee-0000-0000-0000-000000000002'
      or person_b_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  1,
  'bob, a member of Home, can see that the Home record is linked to something'
);

select is(
  (select count(*)::int
   from public.person_links l
   join public.people far on far.id = l.person_a_id
   where l.person_b_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  0,
  'but resolving the far record returns nothing — he is not in that space'
);

select is(
  (select count(*)::int from public.person_links
   where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'and a link stored in a space he cannot read is invisible entirely'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int
   from public.person_links l
   join public.people far on far.id = l.person_a_id
   where l.person_b_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  1,
  'alice, who is in both spaces, resolves the far record from the near side'
);

-- ===========================================================================
-- 7. Locked items stay out of search (decision 1)
-- ===========================================================================
select tests.as_owner();

-- Scoped to the fixture space on purpose: these tests run against a seeded
-- database, and the seed has its own boiler task. A global count here would
-- pass or fail depending on the seed, which is not what is being tested.
select is(
  (select count(*)::int from public.tasks
   where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     and not is_locked
     and to_tsvector('english', title || ' ' || body_md) @@ plainto_tsquery('english', 'boiler')),
  1,
  'unlocked tasks are searchable');

select is(
  (select count(*)::int from public.tasks where is_locked and (title <> '' or body_md <> '')),
  0,
  'no locked task carries plaintext the search index could reach');

select throws_ok(
  $$insert into public.tasks (space_id, owner_id, title, is_locked)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'Leaked title', true)$$,
  '23514',
  null,
  'a locked task cannot be written with a plaintext title'
);

-- ===========================================================================
-- 8. No "who viewed what", ever
-- ===========================================================================
select throws_ok(
  $$insert into public.activity_log (space_id, owner_id, entity_kind, entity_id, action)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'task',
            'bbbbbbbb-0000-0000-0000-000000000002', 'viewed')$$,
  '23514',
  null,
  'the activity log refuses to record a view'
);

-- ===========================================================================
-- 9. space_move_preview
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from app.space_move_preview(
     'task', 'bbbbbbbb-0000-0000-0000-000000000002',
     'aaaaaaaa-0000-0000-0000-000000000001')
   where change = 'loses' and profile_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'moving a Home task to Alice''s personal space reports that bob loses access');

select is(
  (select count(*)::int from app.space_move_preview(
     'task', 'bbbbbbbb-0000-0000-0000-000000000002',
     'aaaaaaaa-0000-0000-0000-000000000001')
   where change = 'keeps' and profile_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'and that alice keeps it');

select is(
  (select count(*)::int from app.space_move_preview(
     'task', 'bbbbbbbb-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002')
   where change = 'gains' and profile_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'moving the other way reports that bob gains access');

select is(
  (select count(*)::int from app.space_move_preview(
     'task', 'bbbbbbbb-0000-0000-0000-000000000002',
     'aaaaaaaa-0000-0000-0000-000000000001')
   where profile_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'a free_busy participant is not listed as gaining or losing content access');

select throws_ok(
  $$select * from app.space_move_preview(
      'task', 'bbbbbbbb-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'previewing a move into a space you cannot write to is refused'
);

-- ===========================================================================
-- 9b. app.entity_space — SECURITY INVOKER, so RLS decides
--
-- Note linking calls this to refuse a link across a space boundary. If it ever
-- became SECURITY DEFINER it would hand a space id for an item the caller
-- cannot read, which is a membership disclosure.
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select space_id from app.entity_space('task', 'bbbbbbbb-0000-0000-0000-000000000002')),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'entity_space resolves the space of an item you can read');

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from app.entity_space('task', 'bbbbbbbb-0000-0000-0000-000000000002')),
  0,
  'and returns nothing at all to an outsider');

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from app.entity_space('task', 'bbbbbbbb-0000-0000-0000-000000000003')),
  0,
  'a private task in a shared space is invisible to entity_space too');

-- A note cannot be linked to something in another space: the insert selects the
-- target's space through entity_space and matches it against the note's.
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int
   from public.notes n
   where n.id = 'cccccccc-0000-0000-0000-000000000001'
     and exists (select 1 from app.entity_space('task', 'bbbbbbbb-0000-0000-0000-000000000001') es
                 where es.space_id = n.space_id)),
  0,
  'linking a Home note to a task in Alice''s personal space matches nothing');

-- ===========================================================================
-- 9c. The outsider sees zero — every table, not a chosen few
--
-- This is the case that catches a table shipped without a policy. It runs over
-- *every* table in `public` rather than a hand-written list, so a new table is
-- covered the moment it exists. Mallory is a member of nothing; the seeded
-- data belongs to other people; therefore every count must be zero.
--
-- `profiles` is excluded because a person can always read their own row, which
-- is the one thing here that is not space-scoped.
-- ===========================================================================
select tests.as_owner();

create function tests.tables_visible_to_me() returns text
language plpgsql
as $$
declare
  r record;
  n bigint;
  bad text[] := '{}';
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('spatial_ref_sys', 'profiles')
    order by tablename
  loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    if n > 0 then bad := bad || format('%s(%s)', r.tablename, n); end if;
  end loop;
  return coalesce(array_to_string(bad, ', '), '');
end $$;

-- How many tables actually hold rows for the *owner*. Without this, a database
-- that failed to seed would pass the check above vacuously.
create function tests.tables_with_rows() returns text
language plpgsql
as $$
declare
  r record;
  n bigint;
  empty text[] := '{}';
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'spatial_ref_sys'
    order by tablename
  loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    if n = 0 then empty := empty || r.tablename; end if;
  end loop;
  return coalesce(array_to_string(empty, ', '), '');
end $$;

grant execute on all functions in schema tests to authenticated;

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is(
  tests.tables_visible_to_me(),
  '',
  'the outsider sees zero rows in every table in the database'
);

select tests.as_owner();

-- The seeded tables that are legitimately empty today. This is a *ledger*, not
-- a pass: when a phase starts filling one of these, delete it from the list and
-- the outsider check above stops being vacuous for that table. If you add a
-- table and it appears here, you have shipped a table nothing writes to.
select is(
  tests.tables_with_rows(),
  'activity_log, ai_runs, attachments, calendar_sync_state, note_versions, '
  'notification_deliveries, person_relationships, place_visits, '
  'recurrence_rules, rule_runs, space_invites, sync_cursors, travel_legs, '
  'travel_sessions',
  'every table the outsider check covers holds seeded rows, except the known-empty ledger'
);

-- ===========================================================================
-- 10. Structural invariants — these catch a careless new table
-- ===========================================================================
select tests.as_owner();

select is(
  (select coalesce(string_agg(t.tablename, ', ' order by t.tablename), '')
   from pg_tables t
   where t.schemaname = 'public'
     -- profiles is not space-scoped; spaces IS the space; space_members is the
     -- membership grant itself and is keyed by (space_id, user_id).
     and t.tablename not in ('profiles', 'spaces', 'space_members', 'spatial_ref_sys')
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.tablename
         and c.column_name = 'space_id')),
  '',
  'every space-scoped table has a space_id column'
);

select is(
  (select coalesce(string_agg(t.tablename, ', ' order by t.tablename), '')
   from pg_tables t
   where t.schemaname = 'public'
     and t.tablename not in ('profiles', 'spaces', 'space_members', 'spatial_ref_sys')
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.tablename
         and c.column_name = 'owner_id')),
  '',
  'every space-scoped table has an owner_id column'
);

select is(
  (select coalesce(string_agg(con.conname, ', ' order by con.conname), '')
   from pg_constraint con
   join pg_class cl on cl.oid = con.conrelid
   join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and con.contype = 'u'
     and cl.relname not in ('profiles', 'spaces')
     and (select attname from pg_attribute
          where attrelid = con.conrelid and attnum = con.conkey[1]) <> 'space_id'),
  '',
  'every unique constraint leads with space_id'
);

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and column_name ilike '%viewed%'),
  0,
  'no column anywhere records that something was viewed'
);

select * from finish();
rollback;
