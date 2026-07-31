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

select plan(106);

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
insert into orbit.profiles (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com',   'Alice Okonkwo'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',     'Bob Whitmore'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com',   'Carol Reeves'),
  ('44444444-4444-4444-4444-444444444444', 'mallory@example.com', 'Mallory Vance');

-- Spaces -------------------------------------------------------------------
insert into orbit.spaces (id, owner_id, name, kind, short_label, colour, icon) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Alice', 'personal', 'Alice', 'indigo', 'user'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Home', 'household', 'Home', 'emerald', 'house'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Bob', 'personal', 'Bob', 'amber', 'user');

insert into orbit.space_members (space_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'member'),
  -- Carol is a free/busy participant of Home: she may see that the space exists
  -- and when it is busy, and nothing else.
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'free_busy'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'owner');
-- Mallory is a member of nothing.

-- Content ------------------------------------------------------------------
insert into orbit.tasks (id, space_id, owner_id, title, visibility) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Renew passport', 'space'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Book boiler service', 'space'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Birthday present for Bob', 'private'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'Put the bins out', 'space');

-- A locked task: no plaintext, ciphertext lives in encrypted_blobs.
insert into orbit.tasks (id, space_id, owner_id, title, body_md, is_locked) values
  ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', '', '', true);

insert into orbit.encrypted_blobs (space_id, owner_id, entity_kind, entity_id, ciphertext, nonce)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'task', 'bbbbbbbb-0000-0000-0000-000000000005', 'Y2lwaGVy', 'bm9uY2U=');

insert into orbit.notes (id, space_id, owner_id, title, body_md) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Boiler service notes', 'Worcester Bosch, serviced annually.');

insert into orbit.events (id, space_id, owner_id, title, starts_at, ends_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Dentist',
   '2026-08-03 09:00+01', '2026-08-03 09:30+01');

-- Recurrence rules. One in the shared space, one in Alice's own — a repeat is
-- one row plus a rule, never expanded copies, so the *rule* is the thing that
-- leaks if its policy is wrong.
insert into orbit.recurrence_rules (id, space_id, owner_id, rrule, dtstart) values
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'FREQ=WEEKLY;BYDAY=MO', '2026-08-03 09:00+01'),
  ('ffffffff-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'FREQ=MONTHLY;BYMONTHDAY=31', '2026-08-31 18:00+01');

insert into orbit.people (id, space_id, owner_id, display_name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Dr Iqbal'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Dr Iqbal');

-- Places and travel. One of each in the shared space and one of each in
-- Alice's own, so every assertion below is "the partner sees exactly the shared
-- one" rather than "the partner sees something".
--
-- Where somebody goes, and when they left to get there, is content. A free/busy
-- participant gets times from app.free_busy_blocks() and nothing else — so
-- Carol must see none of these four tables, not a redacted version of them.
insert into orbit.places (id, space_id, owner_id, name, postcode) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Community centre', 'B14 7SB'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Alice''s lock-up', 'B18 6HQ');

insert into orbit.place_visits (id, space_id, owner_id, place_id, source, arrived_at) values
  ('a2a2a2a2-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001',
   'manual', '2026-08-03 10:00+01'),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000002',
   'manual', '2026-08-03 14:00+01');

insert into orbit.travel_sessions
  (id, space_id, owner_id, title, source, starts_at, ends_at) values
  ('a3a3a3a3-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Weekend away', 'manual',
   '2026-08-07 08:00+01', '2026-08-09 18:00+01'),
  ('a3a3a3a3-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Alice alone', 'manual',
   '2026-08-14 08:00+01', '2026-08-15 18:00+01');

insert into orbit.travel_legs
  (id, space_id, owner_id, session_id, from_place_id, to_place_id, mode,
   depart_at, arrive_at, duration_minutes) values
  ('a4a4a4a4-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'a3a3a3a3-0000-0000-0000-000000000001',
   'a1a1a1a1-0000-0000-0000-000000000001', null, 'car',
   '2026-08-07 08:00+01', '2026-08-07 09:30+01', 90),
  ('a4a4a4a4-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'a3a3a3a3-0000-0000-0000-000000000002',
   'a1a1a1a1-0000-0000-0000-000000000002', null, 'train',
   '2026-08-14 08:00+01', '2026-08-14 11:00+01', 180);

-- Rules, their runs and their notifications — Phase 4.
--
-- A rule is a program that rewrites somebody's tasks unattended, and its runs
-- record the titles of everything it looked at. Both are strictly more than
-- "busy", so Carol must see neither. Two of each: one in the shared space, one
-- in Alice's own.
insert into orbit.rules (id, space_id, owner_id, name, slug, trigger, conditions, actions) values
  ('a5a5a5a5-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Shared rule', 'shared-rule',
   '{"kind":"task.created"}'::jsonb, '[]'::jsonb,
   '[{"kind":"task.set_priority","priority":"high"}]'::jsonb),
  ('a5a5a5a5-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Alice''s own rule', 'alices-own-rule',
   '{"kind":"schedule","cron":"0 7 * * *"}'::jsonb, '[]'::jsonb,
   '[{"kind":"notify"}]'::jsonb);

insert into orbit.rule_runs
  (id, space_id, owner_id, rule_id, is_dry_run, trigger_kind, matched, effects) values
  ('a6a6a6a6-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'a5a5a5a5-0000-0000-0000-000000000001',
   true, 'task.created', true,
   '[{"entity":"x","title":"Shared task","matched":true,"skipped":null,"reason":"Matched, 1 change.","changes":[]}]'::jsonb),
  ('a6a6a6a6-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'a5a5a5a5-0000-0000-0000-000000000002',
   false, 'schedule', false, '[]'::jsonb);

insert into orbit.notification_deliveries
  (id, space_id, owner_id, channel, status, provider) values
  ('a7a7a7a7-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'push', 'sent', 'push:fake'),
  ('a7a7a7a7-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'push', 'queued', 'push:fake');

-- AI runs — Phase 5.
--
-- One in the shared space and one in Alice's own, and one of them is a refusal.
-- A refusal row is the record that a feature was asked to read something and
-- declined; it names the entity it declined to read and holds none of its
-- content, which is exactly why it must still be space-scoped like everything
-- else. Carol sees neither: "an AI feature ran over Alice's notes" is strictly
-- more than "Alice is busy".
-- Consent is personal, not space-wide: the policy is `owner_id = auth.uid()`.
-- Alice's consent lives in the space she shares with Bob, which is exactly the
-- case where a space-wide grant would have leaked it.
insert into orbit.ai_feature_consents
  (id, space_id, owner_id, feature, is_enabled, data_leaves_device, consented_at) values
  ('a9a9a9a9-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'note_summary', true,
   'The note text is sent to the model provider.', now());

insert into orbit.ai_runs
  (id, space_id, owner_id, feature, provider, model, entity_kind, status, error) values
  ('a8a8a8a8-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'note_summary', 'ai:fake', 'fake-local',
   'note', 'ok', null),
  ('a8a8a8a8-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'note_summary', 'ai:fake', null,
   'note', 'refused', 'that item is locked');

-- Devices and sync cursors — Phase 6.
--
-- A cursor says how far a named device has caught up in a named space. That is
-- not content, and it is tempting to treat it as bookkeeping — but "Alice's
-- laptop last read the Home tasks four minutes ago" is a fact about Alice, and
-- a cursor in a space you are not in is a fact about a space you cannot see.
-- So it is space-scoped like everything else, and asserted from both sides of
-- the membership and from the free/busy side, exactly as `ai_runs` was.
insert into orbit.devices (id, space_id, owner_id, label, platform) values
  ('acacacac-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Alice — laptop', 'web'),
  ('acacacac-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Alice — laptop', 'web');

insert into orbit.sync_cursors
  (id, space_id, owner_id, device_id, entity_kind, cursor_at, last_sync_at) values
  ('adadadad-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'acacacac-0000-0000-0000-000000000001',
   'task', '2026-07-27 08:00+01', '2026-07-27 08:00+01'),
  ('adadadad-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'acacacac-0000-0000-0000-000000000002',
   'task', '2026-07-27 08:00+01', '2026-07-27 08:00+01');

-- ===========================================================================
-- 1. RLS is on, everywhere
-- ===========================================================================
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'orbit'
     and not rowsecurity),
  0,
  'every application table has RLS enabled'
);

select isnt(
  (select count(*)::int from pg_tables
   where schemaname = 'orbit'),
  0,
  'there are application tables to check (guards against a vacuous pass)'
);

select is(
  (select count(*)::int from pg_tables t
   where t.schemaname = 'orbit'
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'orbit' and p.tablename = t.tablename
     )),
  0,
  'every application table has at least one policy'
);

-- ===========================================================================
-- 2. Reading tasks
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select is((select count(*)::int from orbit.tasks), 5,
  'alice sees all five tasks across her two spaces');

select is((select count(*)::int from orbit.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 4,
  'alice sees four tasks in Home, including her own private one');

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is((select count(*)::int from orbit.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 3,
  'bob sees three tasks in Home — alice''s private task is hidden from him');

select is((select count(*)::int from orbit.tasks
           where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 0,
  'bob cannot read a private task by id either');

select is((select count(*)::int from orbit.tasks
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'bob sees nothing in alice''s personal space');

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is((select count(*)::int from orbit.tasks), 0,
  'mallory, a member of nothing, sees no tasks at all');

select is((select count(*)::int from orbit.notes), 0, 'mallory sees no notes');
select is((select count(*)::int from orbit.events), 0, 'mallory sees no events');
select is((select count(*)::int from orbit.people), 0, 'mallory sees no people');
select is((select count(*)::int from orbit.spaces), 0, 'mallory sees no spaces');

-- ===========================================================================
-- 3. free_busy is availability-only (decision 3)
-- ===========================================================================
select tests.act_as('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from orbit.tasks), 0,
  'a free_busy participant sees no tasks');

select is((select count(*)::int from orbit.events), 0,
  'a free_busy participant sees no events — not even the titles');

select is((select count(*)::int from orbit.notes), 0,
  'a free_busy participant sees no notes');

select is((select count(*)::int from orbit.spaces), 1,
  'a free_busy participant can see that the space exists, to render its indicator');

select tests.as_owner();
insert into orbit.free_busy_shares (space_id, owner_id, grantee_id)
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

-- A recurrence rule is a fact about somebody's week: how often, and from when.
-- It must be no more visible than the event that carries it.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.recurrence_rules),
  1,
  'the partner sees the shared space''s recurrence rule and not the private one');

select is(
  (select rrule from orbit.recurrence_rules),
  'FREQ=WEEKLY;BYDAY=MO',
  'and the one they see is the shared one');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from orbit.recurrence_rules),
  0,
  'a free_busy participant sees no recurrence rules — the shape of a week is content');

-- Places and travel, from both sides of the membership.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.places
   where id in ('a1a1a1a1-0000-0000-0000-000000000001',
                'a1a1a1a1-0000-0000-0000-000000000002')),
  1,
  'the partner sees the shared place and not the one in Alice''s own space');

select is(
  (select count(*)::int from orbit.place_visits
   where id in ('a2a2a2a2-0000-0000-0000-000000000001',
                'a2a2a2a2-0000-0000-0000-000000000002')),
  1,
  'and the shared visit only — where somebody went is content, not availability');

select is(
  (select count(*)::int from orbit.travel_legs
   where id in ('a4a4a4a4-0000-0000-0000-000000000001',
                'a4a4a4a4-0000-0000-0000-000000000002')),
  1,
  'and the shared journey only');

select is(
  (select count(*)::int from orbit.travel_sessions
   where id in ('a3a3a3a3-0000-0000-0000-000000000001',
                'a3a3a3a3-0000-0000-0000-000000000002')),
  1,
  'and the shared trip only');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from orbit.places),
  0,
  'a free_busy participant sees no places — an address is content');

select is(
  (select count(*)::int from orbit.place_visits),
  0,
  'and no visits: when you were somewhere is more than when you were busy');

select is(
  (select count(*)::int from orbit.travel_legs),
  0,
  'and no journeys');

select is(
  (select count(*)::int from orbit.travel_sessions),
  0,
  'and no trips — that you are away is not the same as that you are busy');

-- Rules and their audit trail, from both sides of the membership.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.rules
   where id in ('a5a5a5a5-0000-0000-0000-000000000001',
                'a5a5a5a5-0000-0000-0000-000000000002')),
  1,
  'the partner sees the rule in the shared space and not the one in Alice''s own');

select is(
  (select count(*)::int from orbit.rule_runs
   where id in ('a6a6a6a6-0000-0000-0000-000000000001',
                'a6a6a6a6-0000-0000-0000-000000000002')),
  1,
  'and only the run belonging to it — a run names every task it looked at');

select is(
  (select count(*)::int from orbit.notification_deliveries
   where id in ('a7a7a7a7-0000-0000-0000-000000000001',
                'a7a7a7a7-0000-0000-0000-000000000002')),
  1,
  'and only the delivery in the shared space');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from orbit.rules),
  0,
  'a free_busy participant sees no rules — a rule is a program over content');

select is(
  (select count(*)::int from orbit.rule_runs),
  0,
  'and no runs: a run records the titles of everything the rule considered');

select is(
  (select count(*)::int from orbit.notification_deliveries),
  0,
  'and no notification deliveries');

select is(
  (select count(*)::int from orbit.ai_runs),
  0,
  'and no AI runs — that a feature ran over somebody''s notes is more than "busy"');

select is(
  (select count(*)::int from orbit.sync_cursors),
  0,
  'and no sync cursors — how far a device has caught up is more than "busy"');

select is(
  (select count(*)::int from orbit.devices),
  0,
  'and no devices — whose laptop reads this space is not availability');

-- AI, from the partner's side. Both directions matter: the run row, and the
-- consent row that would have allowed it.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from orbit.ai_runs
   where id in ('a8a8a8a8-0000-0000-0000-000000000001',
                'a8a8a8a8-0000-0000-0000-000000000002')),
  1,
  'the partner sees the AI run in the shared space and not the one in Alice''s own');

select is(
  (select count(*)::int from orbit.ai_runs
   where id = 'a8a8a8a8-0000-0000-0000-000000000001' and status = 'refused'),
  0,
  'and the run they see is the one that happened, not the refusal from elsewhere');

-- The run is visible in the shared space; the *consent* behind it is not. What
-- somebody agreed to send is theirs, even to a person they share a space with.
select is(
  (select count(*)::int from orbit.ai_feature_consents
   where id = 'a9a9a9a9-0000-0000-0000-000000000001'),
  0,
  'but not the consent behind it — what somebody agreed to send is personal');

-- Consent is per space, and it is a *grant*: writing one into a space you are
-- not in would be granting yourself permission to send somebody else's notes.
select throws_ok(
  $$insert into orbit.ai_feature_consents
      (space_id, owner_id, feature, is_enabled, data_leaves_device, consented_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'note_summary', true,
            'everything', now())$$,
  '42501',
  null,
  'the partner cannot consent to an AI feature inside a space they are not in');

-- The same shape for the run itself: a row claiming a run happened in a space
-- you cannot read is a claim about content you cannot see.
select throws_ok(
  $$insert into orbit.ai_runs (space_id, owner_id, feature, provider, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'note_summary', 'ai:fake', 'ok')$$,
  '42501',
  null,
  'nor record an AI run inside one');

-- Sync cursors, from the partner's side. A cursor is not private *within* a
-- space — "the laptop is three days behind on Home tasks" is a question a
-- household should be able to answer — but it stops at the space boundary like
-- everything else.
select is(
  (select count(*)::int from orbit.sync_cursors
   where id in ('adadadad-0000-0000-0000-000000000001',
                'adadadad-0000-0000-0000-000000000002')),
  1,
  'the partner sees the sync cursor in the shared space and not the one in Alice''s own');

select is(
  (select count(*)::int from orbit.devices
   where id in ('acacacac-0000-0000-0000-000000000001',
                'acacacac-0000-0000-0000-000000000002')),
  1,
  'and the device behind it, on the same terms — the shared one only');

-- A queued write is still a write, and so is the cursor that says it landed.
-- There is no elevated path for catching up: a device writing a cursor into a
-- space it is not in is claiming to have read that space.
select throws_ok(
  $$insert into orbit.sync_cursors (space_id, owner_id, device_id, entity_kind, cursor_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222',
            'acacacac-0000-0000-0000-000000000002', 'task', now())$$,
  '42501',
  null,
  'the partner cannot record a sync cursor inside a space they are not in');

select throws_ok(
  $$insert into orbit.devices (space_id, owner_id, label)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'Bob — phone')$$,
  '42501',
  null,
  'nor register a device there');

-- Catching up is a *read* of the space, and it moves the cursor. If the cursor
-- could be dragged forward from outside, a device could be told it is up to
-- date on a space it has never read.
update orbit.sync_cursors set cursor_at = now()
 where id = 'adadadad-0000-0000-0000-000000000002';

select tests.as_owner();
select is(
  (select cursor_at from orbit.sync_cursors
   where id = 'adadadad-0000-0000-0000-000000000002'),
  '2026-07-27 08:00+01'::timestamptz,
  'and dragging a cursor forward in a space they cannot see silently affects nothing');
select tests.act_as('22222222-2222-2222-2222-222222222222');

-- A rule cannot be pointed at another space. The FK is to spaces, so the write
-- that matters is the one where space_id says one thing and the rule's own
-- policy says another: the partner writing a rule into Alice's private space.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into orbit.rules (space_id, owner_id, name, slug, trigger)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'Reach', 'reach',
            '{"kind":"task.created"}'::jsonb)$$,
  '42501',
  null,
  'the partner cannot create a rule inside a space they are not in');

-- ===========================================================================
-- 4. Writing
-- ===========================================================================
select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into orbit.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'Sneaky')$$,
  '42501',
  null,
  'bob cannot insert a task into a space he is not a member of'
);

select throws_ok(
  $$insert into orbit.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'Forged owner')$$,
  '42501',
  null,
  'bob cannot insert a task attributed to alice'
);

select lives_ok(
  $$insert into orbit.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '22222222-2222-2222-2222-222222222222', 'Descale the kettle')$$,
  'bob can insert his own task into a space he belongs to'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$insert into orbit.tasks (space_id, owner_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'From a free_busy member')$$,
  '42501',
  null,
  'a free_busy participant cannot write content'
);

-- An UPDATE that matches no visible row is not an error; it changes nothing.
-- That distinction matters: the client must not be able to tell the row exists.
select tests.act_as('22222222-2222-2222-2222-222222222222');

update orbit.tasks set title = 'Hijacked'
 where id = 'bbbbbbbb-0000-0000-0000-000000000003';

select tests.as_owner();
select is(
  (select title from orbit.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000003'),
  'Birthday present for Bob',
  'bob''s update of a private task silently affected nothing'
);

-- ===========================================================================
-- 5. Item shares cannot become a back door
-- ===========================================================================
select tests.act_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into orbit.item_shares (space_id, owner_id, entity_kind, entity_id, grantee_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'task',
            'bbbbbbbb-0000-0000-0000-000000000002',
            '44444444-4444-4444-4444-444444444444')$$,
  '42501',
  null,
  'an item cannot be shared with someone who is not a member of its space'
);

select lives_ok(
  $$insert into orbit.item_shares (space_id, owner_id, entity_kind, entity_id, grantee_id)
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
  $$insert into orbit.person_links
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
  $$insert into orbit.person_links
      (space_id, owner_id, person_a_id, person_b_id, person_b_space)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111',
            'eeeeeeee-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'alice, who can write both spaces, can link the two Dr Iqbal records'
);

select is(
  (select count(*)::int from orbit.people where display_name = 'Dr Iqbal'),
  2,
  'linking leaves two records — it never collapses or merges them'
);

-- Read the link from each side. This is what the person detail page does, and
-- it is where a careless join would leak the far record's name.
select tests.act_as('22222222-2222-2222-2222-222222222222');

-- The link row lives in Home; person_b is the Home record, person_a is the one
-- in Alice's personal space. Bob is in Home and not in Alice's space.
select is(
  (select count(*)::int from orbit.person_links
   where person_a_id = 'eeeeeeee-0000-0000-0000-000000000002'
      or person_b_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  1,
  'bob, a member of Home, can see that the Home record is linked to something'
);

select is(
  (select count(*)::int
   from orbit.person_links l
   join orbit.people far on far.id = l.person_a_id
   where l.person_b_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  0,
  'but resolving the far record returns nothing — he is not in that space'
);

select is(
  (select count(*)::int from orbit.person_links
   where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'and a link stored in a space he cannot read is invisible entirely'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int
   from orbit.person_links l
   join orbit.people far on far.id = l.person_a_id
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
  (select count(*)::int from orbit.tasks
   where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     and not is_locked
     and to_tsvector('english', title || ' ' || body_md) @@ plainto_tsquery('english', 'boiler')),
  1,
  'unlocked tasks are searchable');

select is(
  (select count(*)::int from orbit.tasks where is_locked and (title <> '' or body_md <> '')),
  0,
  'no locked task carries plaintext the search index could reach');

select throws_ok(
  $$insert into orbit.tasks (space_id, owner_id, title, is_locked)
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
  $$insert into orbit.activity_log (space_id, owner_id, entity_kind, entity_id, action)
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
   from orbit.notes n
   where n.id = 'cccccccc-0000-0000-0000-000000000001'
     and exists (select 1 from app.entity_space('task', 'bbbbbbbb-0000-0000-0000-000000000001') es
                 where es.space_id = n.space_id)),
  0,
  'linking a Home note to a task in Alice''s personal space matches nothing');

-- ===========================================================================
-- 9c. The outsider sees zero — every table, not a chosen few
--
-- This is the case that catches a table shipped without a policy. It runs over
-- *every* table in `orbit` rather than a hand-written list, so a new table is
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
    where schemaname = 'orbit'
      and tablename <> 'profiles'
    order by tablename
  loop
    execute format('select count(*) from orbit.%I', r.tablename) into n;
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
    where schemaname = 'orbit'
    order by tablename
  loop
    execute format('select count(*) from orbit.%I', r.tablename) into n;
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

-- The tables that are legitimately empty after a fresh seed. This is a
-- *ledger*, not a pass: the outsider check above cannot fail on an empty table,
-- so anything listed here is a gap in that coverage rather than a guarantee.
--
-- The assertion is deliberately a subset check, not equality. A ledger table
-- filling up is fine and must not fail the suite — using the app writes to
-- activity_log, and the whole point of this file is that it runs against the
-- live database. What must never happen is a table *outside* the ledger being
-- empty: that means either the seed did not run, or you have shipped a table
-- nothing writes to and whose policy is therefore untested.
select is(
  (select coalesce(string_agg(t, ', ' order by t), '')
   from unnest(string_to_array(tests.tables_with_rows(), ', ')) as t
   where t <> ''
     -- `space_invites` left this ledger in session 9: the seed now writes one
     -- pending invite, so the outsider check above is no longer vacuous for it.
     -- Two tables remain, both deliberately unused with a paragraph each in
     -- docs/decisions-log.md.
     and t <> all (array[
       'attachments', 'person_relationships'
     ])),
  '',
  'every table outside the known-empty ledger holds rows, so the outsider check is not vacuous'
);

-- ===========================================================================
-- 10. Structural invariants — these catch a careless new table
-- ===========================================================================
select tests.as_owner();

select is(
  (select coalesce(string_agg(t.tablename, ', ' order by t.tablename), '')
   from pg_tables t
   where t.schemaname = 'orbit'
     -- profiles is not space-scoped; spaces IS the space; space_members is the
     -- membership grant itself and is keyed by (space_id, user_id).
     and t.tablename not in ('profiles', 'spaces', 'space_members')
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'orbit' and c.table_name = t.tablename
         and c.column_name = 'space_id')),
  '',
  'every space-scoped table has a space_id column'
);

select is(
  (select coalesce(string_agg(t.tablename, ', ' order by t.tablename), '')
   from pg_tables t
   where t.schemaname = 'orbit'
     and t.tablename not in ('profiles', 'spaces', 'space_members')
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'orbit' and c.table_name = t.tablename
         and c.column_name = 'owner_id')),
  '',
  'every space-scoped table has an owner_id column'
);

select is(
  (select coalesce(string_agg(con.conname, ', ' order by con.conname), '')
   from pg_constraint con
   join pg_class cl on cl.oid = con.conrelid
   join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'orbit'
     and con.contype = 'u'
     and cl.relname not in ('profiles', 'spaces')
     and (select attname from pg_attribute
          where attrelid = con.conrelid and attnum = con.conkey[1]) <> 'space_id'),
  '',
  'every unique constraint leads with space_id'
);

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'orbit' and column_name ilike '%viewed%'),
  0,
  'no column anywhere records that something was viewed'
);

-- ===========================================================================
-- 11. auth.users → orbit.profiles (migration 0012)
--
-- The delicate one. `profiles.id` must equal the JWT's `sub` or every policy in
-- this file returns zero rows and says nothing about why. The trigger is what
-- makes them equal, so it gets assertions rather than trust.
-- ===========================================================================
select tests.as_owner();

select is(
  (select count(*)::int from pg_trigger
   where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
     and not tgisinternal),
  1,
  'a trigger on auth.users insert creates the profile');

insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'newcomer@example.com',
   '{"display_name": "Nadia Ferreira"}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'quiet.person@example.com', '{}'::jsonb);

select is(
  (select p.id from orbit.profiles p where p.id = '55555555-5555-5555-5555-555555555555'),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'a new auth user gets a profile with the same id — which is what auth.uid() will be');

select is(
  (select p.display_name from orbit.profiles p
   where p.id = '55555555-5555-5555-5555-555555555555'),
  'Nadia Ferreira',
  'and the display name comes from the sign-up form, via raw_user_meta_data');

select is(
  (select p.display_name from orbit.profiles p
   where p.id = '66666666-6666-6666-6666-666666666666'),
  'quiet.person',
  'with no metadata it falls back to the email local part, never to an empty name');

-- profiles_email_key, handled rather than hit. The seeded profiles are dev
-- data and a real deployment starts empty; if the two are ever mixed, this is
-- what happens — loudly, and naming the address.
select throws_ok(
  $$insert into auth.users (id, email)
    values ('77777777-7777-7777-7777-777777777777', 'alice@example.com')$$,
  '23505',
  null,
  'an account whose email already belongs to a profile is refused, not silently attached to it');

-- ===========================================================================
-- 12. Space invites — app.space_invite, the one SECURITY DEFINER exception
--
-- `space_invites` is admin-only in both directions and `space_members_insert`
-- requires being an admin already, so redeeming an invite is a thing the
-- policies cannot express: the person doing it is, by definition, not in the
-- space yet. That is what the function is for, and these are the assertions
-- that keep it from becoming a way in for anybody else.
-- ===========================================================================
select tests.as_owner();

create function tests.invite_hash(p_token text) returns text
language sql immutable as $$ select encode(digest(p_token, 'sha256'), 'hex') $$;
grant execute on function tests.invite_hash(text) to authenticated;

-- Alice is an owner of Home, so the policy lets her create one.
select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into orbit.space_invites (space_id, owner_id, token_hash, role, invited_email)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   tests.invite_hash('open-token'), 'member', null),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   tests.invite_hash('for-carol'), 'member', 'carol@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   tests.invite_hash('stale-token'), 'free_busy', null);

update orbit.space_invites set expires_at = now() - interval '1 day'
where token_hash = tests.invite_hash('stale-token');

select is(
  (select count(*)::int from orbit.space_invites
   where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  3,
  'an admin of a space can create an invite in it, and read it back');

-- Bob is an ordinary member of Home. Inviting people is not an ordinary
-- member's job, and the policy is what says so.
select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into orbit.space_invites (space_id, owner_id, token_hash, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '22222222-2222-2222-2222-222222222222', 'deadbeef', 'member')$$,
  '42501',
  null,
  'a member who is not an admin cannot create an invite');

-- Mallory is a member of nothing and holds a token she was not given.
select tests.act_as('44444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from orbit.space_invites),
  0,
  'the person holding the link cannot read the invite row itself — which is why the function exists');

select is(
  (select i.status from app.space_invite('open-token', 'preview') i),
  'ok',
  'but the function shows her which space and which role the link is for');

select is(
  (select i.space_name from app.space_invite('open-token', 'preview') i),
  'Home',
  'named, so nobody accepts an invitation to a space they cannot see');

select is(
  (select i.status from app.space_invite('no-such-token', 'preview') i),
  'unknown',
  'a token nobody issued is "unknown" — a sentence, not an error and not a hint that a space exists');

select is(
  (select i.status from app.space_invite('stale-token', 'accept') i),
  'expired',
  'an expired invite is refused by name, whatever verb is asked for');

select is(
  (select i.status from app.space_invite('for-carol', 'accept') i),
  'wrong_person',
  'an invite addressed to somebody else cannot be redeemed by whoever holds the link');

select is(
  (select count(*)::int from orbit.space_members m
   where m.user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'and trying it made her a member of nothing');

select is(
  (select i.status from app.space_invite('open-token', 'accept') i),
  'accepted',
  'a bearer invite she does hold is accepted');

select tests.as_owner();

select is(
  (select m.role::text || ' ' || m.status from orbit.space_members m
   where m.user_id = '44444444-4444-4444-4444-444444444444'
     and m.space_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'member active',
  'with exactly the role the invite named, and no other');

select is(
  (select i.accepted_by from orbit.space_invites i
   where i.token_hash = tests.invite_hash('open-token')),
  '44444444-4444-4444-4444-444444444444'::uuid,
  'the invite records who accepted it, so an admin can see the link was used');

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is(
  (select i.status from app.space_invite('open-token', 'accept') i),
  'accepted_by_you',
  'a second accept is refused rather than being a second join');

select is(
  (select count(*)::int from orbit.space_members m
   where m.user_id = '44444444-4444-4444-4444-444444444444'),
  1,
  'and there is still exactly one membership');

select is(
  (select count(*)::int from orbit.tasks t
   where t.id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'having joined, she sees the space''s shared content');

select is(
  (select count(*)::int from orbit.tasks t
   where t.id = 'bbbbbbbb-0000-0000-0000-000000000003'),
  0,
  'and joining is not a way into somebody''s private rows');

-- Revoking. `space_invites` has no `revoked_at` column and this brief adds no
-- migration, so an admin revokes by expiring: the token stops working and the
-- row stays as a record of what was offered.
select tests.act_as('11111111-1111-1111-1111-111111111111');

update orbit.space_invites set expires_at = now()
where token_hash = tests.invite_hash('for-carol');

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select i.status from app.space_invite('for-carol', 'accept') i),
  'expired',
  'an invite revoked by its admin stops working for the person it was addressed to');

-- Removing a member. `space_members.status` already has 'left', so nothing is
-- deleted: the row is the record that they were once here.
select tests.act_as('11111111-1111-1111-1111-111111111111');

update orbit.space_members set status = 'left'
where space_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  and user_id = '44444444-4444-4444-4444-444444444444';

select tests.act_as('44444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from orbit.tasks t
   where t.space_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'a member set to left sees zero rows again, without the row being deleted');

select * from finish();
rollback;
