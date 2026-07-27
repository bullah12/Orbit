set search_path = public, extensions;

-- ============================================================================
-- Orbit 0009 — Leaving, forking, erasure, export
--
-- Relationships end. This app must never become leverage in one, so the exit
-- is built in migration nine rather than year two:
--
--   app.fork_space_to_personal()  take a full copy of shared content with you
--   app.leave_space()             fork (optionally) then revoke, immediately
--   app.erase_person()            UK GDPR erasure across every linked table
--   app.export_space()            complete, human-readable, no lock-in
--
-- Revocation is instant everywhere because visibility is derived from
-- space_members.status. The moment status flips to 'left', every readable_
-- space_ids() call on every device stops returning that space, the sync
-- engine's buckets are recomputed, and local copies are purged on next
-- connect. There is no "revoked" flag the client could ignore.
-- ============================================================================

-- Order matters: parents before children, so FK rewrites always find their map.
create table app.cloneable_tables (
  ord         int primary key,
  table_name  text not null unique,
  -- Extra predicate for rows that span two spaces. A link from a shared event
  -- to my partner's private note lives in the shared space, but forking it
  -- would hand the leaver an edge pointing at a row they must never see — so
  -- edges are cloned only when BOTH endpoints are inside the forked space.
  extra_where text
);
insert into app.cloneable_tables (ord, table_name, extra_where) values
  (10,'tags',null), (20,'projects',null), (30,'categories',null), (40,'places',null),
  (50,'people',null), (60,'groups',null), (70,'calendars',null), (80,'events',null),
  (90,'tasks',null), (100,'notes',null),
  (110,'person_fields',null), (120,'person_dates',null), (130,'person_relations',null),
  (140,'addresses',null),
  (150,'group_members','person_space_id = $1 and group_space_id = $1'),
  (160,'event_attendees','event_space_id = $1 and (person_space_id is null or person_space_id = $1)'),
  (170,'event_occurrences',null), (180,'category_rules',null), (190,'task_contexts',null),
  (200,'attachments',null),
  (210,'taggings','entity_space_id = $1 and tag_space_id = $1'),
  (220,'links','source_space_id = $1 and target_space_id = $1'),
  (230,'saved_filters',null);

-- (table, column) pairs that reference a cloned id and must be remapped.
create table app.clone_fk_map (
  table_name  text not null,
  column_name text not null,
  primary key (table_name, column_name)
);
insert into app.clone_fk_map (table_name, column_name) values
  ('people','same_as_person_id'),
  ('person_fields','person_id'), ('person_dates','person_id'),
  ('person_relations','person_a'), ('person_relations','person_b'),
  ('groups','parent_id'),
  ('group_members','group_id'), ('group_members','person_id'),
  ('places','recommended_by_person_id'),
  ('calendars','default_category_id'),
  ('events','calendar_id'), ('events','place_id'), ('events','category_id'),
  ('events','recurrence_parent_id'), ('events','source_task_id'),
  ('event_attendees','event_id'), ('event_attendees','person_id'),
  ('event_occurrences','event_id'),
  ('category_rules','category_id'),
  ('tasks','project_id'), ('tasks','parent_task_id'),
  ('tasks','waiting_on_person_id'), ('tasks','scheduled_event_id'),
  ('task_contexts','task_id'),
  ('taggings','tag_id'), ('taggings','entity_id'),
  ('links','source_id'), ('links','target_id'),
  ('attachments','entity_id');

create or replace function app.fork_space_to_personal(p_space_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_user   uuid := coalesce(p_user_id, (select auth.uid()));
  v_target uuid;
  r        record;
  cols     text;
  fk       record;
begin
  -- Defence in depth. This is SECURITY DEFINER and takes a user id, so anyone
  -- who acquires EXECUTE on it could otherwise fork a space into a third
  -- party's personal space. The membership check below validates p_user_id's
  -- membership, not the caller's, so it is not sufficient on its own.
  -- session_user, not current_user: inside a definer function current_user is
  -- always the owner.
  if p_user_id is not null
     and p_user_id is distinct from (select auth.uid())
     and session_user not in ('postgres', 'service_role') then
    raise exception 'Cannot fork a space on behalf of another user'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from space_members
                 where space_id = p_space_id and user_id = v_user and status = 'active') then
    raise exception 'Not a member of this space' using errcode = 'insufficient_privilege';
  end if;

  select s.id into v_target
  from spaces s join space_members m on m.space_id = s.id
  where s.kind = 'personal' and m.user_id = v_user;

  create temp table id_map (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- Pass 1: allocate new ids and copy rows verbatim (FKs still point at originals).
  for r in select table_name, extra_where from app.cloneable_tables order by ord loop
    execute format(
      'insert into id_map (old_id, new_id) select id, gen_random_uuid()
       from %I where space_id = $1 and %s',
      r.table_name, coalesce(r.extra_where, 'true')) using p_space_id;

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = r.table_name::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id','space_id','owner_id')
      and a.attgenerated = '';

    execute format(
      'insert into %1$I (id, space_id, owner_id, %2$s)
       select m.new_id, $2, $3, %2$s from %1$I t join id_map m on m.old_id = t.id
       where t.space_id = $1',
      r.table_name, cols) using p_space_id, v_target, v_user;
  end loop;

  -- Pass 2: rewrite intra-space FKs onto the cloned ids.
  --
  -- Scoped by id_map membership, NOT by space_id: the insert triggers on
  -- links/taggings/group_members set space_id from the entity they pointed at,
  -- which during pass 1 is still the original in the OLD space. Keying on
  -- space_id here silently matched nothing.
  for fk in select * from app.clone_fk_map loop
    execute format(
      'update %1$I t set %2$I = m.new_id from id_map m
       where t.id in (select new_id from id_map) and t.%2$I = m.old_id',
      fk.table_name, fk.column_name);
  end loop;

  -- Denormalised space columns are recomputed, never copied. Everything cloned
  -- is now in v_target by definition, so this is unconditional.
  update links set source_space_id = v_target, target_space_id = v_target, space_id = v_target
   where id in (select new_id from id_map);
  update taggings set entity_space_id = v_target, tag_space_id = v_target, space_id = v_target
   where id in (select new_id from id_map);
  update group_members set person_space_id = v_target, group_space_id = v_target, space_id = v_target
   where id in (select new_id from id_map);
  update event_attendees set event_space_id = v_target, space_id = v_target,
         person_space_id = case when person_id is null then null else v_target end
   where id in (select new_id from id_map);
  update tasks set waiting_on_person_space_id =
         case when waiting_on_person_id is null then null else v_target end
   where id in (select new_id from id_map);

  -- Any nullable reference that escaped the forked space is severed rather than
  -- left dangling at a row the leaver cannot see.
  for fk in
    select m.table_name, m.column_name from app.clone_fk_map m
    join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = m.table_name
     and c.column_name = m.column_name and c.is_nullable = 'YES'
  loop
    execute format(
      'update %1$I t set %2$I = null
       where t.id in (select new_id from id_map)
         and t.%2$I is not null
         and t.%2$I not in (select new_id from id_map)',
      fk.table_name, fk.column_name);
  end loop;

  -- My private read on a shared person must follow that person into the fork,
  -- or leaving would orphan every cadence, talking point and interaction I ever
  -- recorded about people we knew together.
  update person_state ps   set person_id = m.new_id from id_map m
   where ps.user_id = v_user and ps.person_id = m.old_id;
  update interactions i    set person_id = m.new_id from id_map m
   where i.owner_id = v_user and i.person_id = m.old_id;
  update talking_points tp set person_id = m.new_id from id_map m
   where tp.owner_id = v_user and tp.person_id = m.old_id;

  insert into activity_log (space_id, actor_id, entity_type, entity_id, action, summary)
  values (p_space_id, v_user, 'note', p_space_id, 'forked_space',
          'Took a personal copy of shared content on leaving');

  return v_target;
end;
$$;

create or replace function app.leave_space(p_space_id uuid, p_take_a_copy boolean default true)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if (select kind from spaces where id = p_space_id) = 'personal' then
    raise exception 'You cannot leave your personal space';
  end if;

  if p_take_a_copy then
    perform app.fork_space_to_personal(p_space_id, v_user);
  end if;

  update space_members
     set status = 'left', left_at = now(), updated_at = now()
   where space_id = p_space_id and user_id = v_user;

  -- If the leaver was the last member, the space and its contents go with them.
  if not exists (select 1 from space_members
                 where space_id = p_space_id and status = 'active') then
    delete from spaces where id = p_space_id;
  end if;
end;
$$;

-- Either member may remove the other. Symmetric by design: there is no role
-- that can trap someone in a shared space.
create or replace function app.revoke_member(p_space_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not (p_space_id = any(app.owned_space_ids())) then
    raise exception 'Only a space owner can revoke membership'
      using errcode = 'insufficient_privilege';
  end if;
  update space_members
     set status = 'revoked', left_at = now(), updated_at = now()
   where space_id = p_space_id and user_id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- UK GDPR: one action deletes a person and everything linked to them.
--
-- Where the person is in a shared space both members are controllers, so the
-- erasure is a hard delete in the shared space and propagates to every member's
-- devices via the same bucket recomputation as revocation.
-- ----------------------------------------------------------------------------

create or replace function app.erase_person(p_person_id uuid)
returns table (table_name text, rows_deleted bigint)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_space uuid;
  n bigint;
begin
  select space_id into v_space from people where id = p_person_id;
  if v_space is null or not (v_space = any(app.writable_space_ids())) then
    raise exception 'Person not found' using errcode = 'insufficient_privilege';
  end if;

  delete from links where (source_type = 'person' and source_id = p_person_id)
                       or (target_type = 'person' and target_id = p_person_id);
  get diagnostics n = row_count; table_name := 'links'; rows_deleted := n; return next;

  delete from taggings where entity_type = 'person' and entity_id = p_person_id;
  get diagnostics n = row_count; table_name := 'taggings'; rows_deleted := n; return next;

  delete from attachments where entity_type = 'person' and entity_id = p_person_id;
  get diagnostics n = row_count; table_name := 'attachments'; rows_deleted := n; return next;

  delete from interactions where person_id = p_person_id;
  get diagnostics n = row_count; table_name := 'interactions'; rows_deleted := n; return next;

  delete from talking_points where person_id = p_person_id;
  get diagnostics n = row_count; table_name := 'talking_points'; rows_deleted := n; return next;

  -- person_state rows belong to EVERY member, including the other person's
  -- private copy. Erasure is not partial.
  delete from person_state where person_id = p_person_id;
  get diagnostics n = row_count; table_name := 'person_state'; rows_deleted := n; return next;

  delete from addresses where owner_type = 'person' and owner_ref = p_person_id;
  get diagnostics n = row_count; table_name := 'addresses'; rows_deleted := n; return next;

  delete from event_attendees where person_id = p_person_id;
  get diagnostics n = row_count; table_name := 'event_attendees'; rows_deleted := n; return next;

  update tasks set waiting_on_person_id = null, waiting_on_person_space_id = null
   where waiting_on_person_id = p_person_id;

  delete from people where id = p_person_id;
  get diagnostics n = row_count; table_name := 'people'; rows_deleted := n; return next;

  insert into activity_log (space_id, actor_id, entity_type, entity_id, action, summary)
  values (v_space, (select auth.uid()), 'person', p_person_id, 'erased', 'GDPR erasure');
end;
$$;

-- Complete export. JSON here; the Edge Function fans this out to Markdown,
-- .ics and .vcf so that the export is human-readable as well as complete.
create or replace function app.export_space(p_space_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, app, pg_temp
as $$
declare
  result jsonb := '{}'::jsonb;
  r record;
  chunk jsonb;
begin
  if not (p_space_id = any(app.readable_space_ids())) then
    raise exception 'Space not found' using errcode = 'insufficient_privilege';
  end if;
  for r in select table_name from app.cloneable_tables order by ord loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %I t where space_id = $1',
                   r.table_name)
      into chunk using p_space_id;
    result := result || jsonb_build_object(r.table_name, chunk);
  end loop;
  -- Personal-space companions to a shared person record travel with the export.
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into chunk from person_state t;
  result := result || jsonb_build_object('person_state', chunk);
  return result;
end;
$$;

revoke all on function app.fork_space_to_personal(uuid, uuid) from public;
grant execute on function app.leave_space(uuid, boolean)   to authenticated;
grant execute on function app.revoke_member(uuid, uuid)    to authenticated;
grant execute on function app.erase_person(uuid)           to authenticated;
grant execute on function app.export_space(uuid)           to authenticated;
grant execute on function app.share_item_explicitly(entity_type, uuid, uuid) to authenticated;
grant execute on function app.space_move_preview(entity_type, uuid) to authenticated;
