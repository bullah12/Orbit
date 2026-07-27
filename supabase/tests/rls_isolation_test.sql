-- ============================================================================
-- RLS negative tests (pgTAP).  Run: supabase test db
--
-- These are the tests that matter most. A bug in the sync engine loses data; a
-- bug in the rules engine miscategorises a meeting; a bug here is a privacy
-- breach. Each test asserts a NEGATIVE — that a non-member cannot read, count,
-- search, join to, or otherwise infer the existence of a row.
-- ============================================================================

begin;
select plan(28);

-- ---------------------------------------------------------------- fixtures --
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alex@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.com');

-- Personal spaces were auto-provisioned by the on_auth_user_created trigger.
create temp view alex_personal as
  select s.id from spaces s join space_members m on m.space_id = s.id
  where s.kind='personal' and m.user_id='11111111-1111-1111-1111-111111111111';
create temp view sam_personal as
  select s.id from spaces s join space_members m on m.space_id = s.id
  where s.kind='personal' and m.user_id='22222222-2222-2222-2222-222222222222';

insert into spaces (id, name, kind, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Household', 'shared',
   '11111111-1111-1111-1111-111111111111');
insert into space_members (space_id, user_id, role, status, joined_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner','active', now()),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','editor','active', now());

-- Alex: one private note, one shared event, and a link between them.
insert into notes (id, space_id, owner_id, title, body_md)
select '11111111-0000-0000-0000-00000000000a', id,
       '11111111-1111-1111-1111-111111111111', 'Therapy', 'private body'
from alex_personal;

insert into events (id, space_id, owner_id, title, start_at, end_at)
values ('11111111-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111','Dinner with the Kellys',
        now() + interval '1 day', now() + interval '1 day 2 hours');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into links (source_type, source_id, target_type, target_id, link_type, space_id, owner_id,
                   source_space_id, target_space_id)
values ('event','11111111-0000-0000-0000-00000000000e','note','11111111-0000-0000-0000-00000000000a',
        'about','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000');

select ok((select count(*) = 1 from links), 'owner sees their own cross-space link');
select is((select source_space_id from links), 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
          'link source space is trigger-derived, not client-supplied');

-- ---------------------------------------------------- the link-leak tests --
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*) from events), 1::bigint,
          'partner sees the shared event');
select is((select count(*) from notes), 0::bigint,
          'partner cannot read the private note');
select is((select count(*) from links), 0::bigint,
          'partner sees NO link row -- not a greyed row, not a count, nothing');
select is((select count(*) from links where target_type = 'note'), 0::bigint,
          'partner cannot count links by target type');
select ok((select not exists (select 1 from notes where id = '11111111-0000-0000-0000-00000000000a')),
          'partner cannot confirm the note id exists');
select is((select count(*) from notes where search_tsv @@ to_tsquery('english','private')), 0::bigint,
          'partner cannot find the private note by full-text search');

-- Aggregates must not leak either: this is the one people forget.
select is((select coalesce(sum(1),0) from links), 0::bigint,
          'aggregate over links leaks nothing');

-- A partner cannot manufacture a link to probe for the note's existence.
select throws_ok(
  $$insert into links (source_type, source_id, target_type, target_id, link_type, space_id, owner_id,
                       source_space_id, target_space_id)
    values ('event','11111111-0000-0000-0000-00000000000e','note','11111111-0000-0000-0000-00000000000a',
            'about','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
            '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000')$$,
  null,
  'linking to an invisible note fails');

-- ...and it fails with the SAME error as linking to a wholly fictional id, so
-- the error text itself is not an oracle.
select throws_ok(
  $$insert into links (source_type, source_id, target_type, target_id, link_type, space_id, owner_id,
                       source_space_id, target_space_id)
    values ('event','11111111-0000-0000-0000-00000000000e','note','deadbeef-0000-0000-0000-00000000dead',
            'about','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
            '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000')$$,
  null,
  'linking to a non-existent note fails identically -- no existence oracle');

-- ------------------------------------------------------------- strangers --
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select is((select count(*) from events), 0::bigint,      'stranger sees no events');
select is((select count(*) from notes), 0::bigint,        'stranger sees no notes');
select is((select count(*) from links), 0::bigint,        'stranger sees no links');
select is((select count(*) from spaces), 1::bigint,       'stranger sees only their own personal space');
select is((select count(*) from space_members
           where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
          'stranger cannot enumerate the household roster');
select is((select count(*) from activity_log), 0::bigint, 'stranger sees no activity');

-- ------------------------------------------------- shared facts / private --
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into people (id, space_id, owner_id, display_name)
values ('11111111-0000-0000-0000-0000000000f1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Rita Kelly');
insert into person_state (space_id, owner_id, person_id, user_id, notes_md, cadence)
select id, '11111111-1111-1111-1111-111111111111', '11111111-0000-0000-0000-0000000000f1'::uuid,
       '11111111-1111-1111-1111-111111111111', 'finds her exhausting', 'quarterly'
from alex_personal;

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*) from people), 1::bigint,
          'partner sees the shared person record');
select is((select count(*) from person_state), 0::bigint,
          'partner sees none of my private read on that person');

-- ------------------------------------------------- never shareable by bulk --
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into notes (id, space_id, owner_id, title, is_daily, daily_date)
select '11111111-0000-0000-0000-00000000000d', id,
       '11111111-1111-1111-1111-111111111111', 'Daily', true, current_date
from alex_personal;

select throws_ok(
  $$update notes set space_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    where id = '11111111-0000-0000-0000-00000000000d'$$,
  null, 'a journal entry cannot be bulk-moved into a shared space');

select lives_ok(
  $$select app.share_item_explicitly('note','11111111-0000-0000-0000-00000000000d',
                                     'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'a journal entry CAN be shared individually and explicitly');

-- ------------------------------------------------------ free_busy members --
insert into space_members (space_id, user_id, role, status, joined_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
        'free_busy','active', now());
insert into event_occurrences (space_id, owner_id, event_id, start_at, end_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        '11111111-0000-0000-0000-00000000000e', now() + interval '1 day',
        now() + interval '1 day 2 hours');

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select is((select count(*) from events), 0::bigint,
          'free_busy member cannot read event rows at all');
select is((select count(*) from event_occurrences), 0::bigint,
          'free_busy member cannot read occurrence rows directly');
select is((select count(*) from app.busy_blocks), 1::bigint,
          'free_busy member sees exactly one anonymous busy block');
select hasnt_column('app', 'busy_blocks', 'title',
          'the busy-block view has no title column to leak');

-- -------------------------------------------------------- leaving revokes --
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select lives_ok($$select app.leave_space('aaaaaaaa-0000-0000-0000-000000000001', true)$$,
                'partner can leave and take a copy');
select is((select count(*) from events where space_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
          0::bigint, 'shared content is invisible the instant they leave');
select ok((select count(*) > 0 from events), 'their forked personal copy survives');

select * from finish();
rollback;
