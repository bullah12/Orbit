set search_path = public, extensions;

-- ============================================================================
-- Orbit 0075 — entity-space resolution, link/tagging integrity, move guards
--
-- Everything here is SECURITY DEFINER on purpose. When I move a note from
-- Personal to Shared, the denormalised space columns on link rows must ALL be
-- updated — including links to entities I cannot see. If these ran as the
-- invoker, RLS would silently skip those rows and leave a stale space_id
-- behind, which is precisely the leak the design exists to prevent.
-- ============================================================================

create or replace function app.entity_space(et entity_type, eid uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare s uuid;
begin
  case et
    when 'person'        then select space_id into s from people        where id = eid and deleted_at is null;
    when 'group'         then select space_id into s from groups        where id = eid and deleted_at is null;
    when 'event'         then select space_id into s from events        where id = eid and deleted_at is null;
    when 'task'          then select space_id into s from tasks         where id = eid and deleted_at is null;
    when 'note'          then select space_id into s from notes         where id = eid and deleted_at is null;
    when 'place'         then select space_id into s from places        where id = eid and deleted_at is null;
    when 'project'       then select space_id into s from projects      where id = eid and deleted_at is null;
    when 'interaction'   then select space_id into s from interactions  where id = eid and deleted_at is null;
    when 'talking_point' then select space_id into s from talking_points where id = eid and deleted_at is null;
    when 'attachment'    then select space_id into s from attachments   where id = eid and deleted_at is null;
    when 'saved_filter'  then select space_id into s from saved_filters where id = eid and deleted_at is null;
  end case;
  return s;   -- null for both "does not exist" and "deleted": indistinguishable by design
end;
$$;

-- Populate the denormalised space columns on links, ignoring whatever the
-- client sent. A non-existent target and an invisible target both resolve to
-- null and produce the identical error, so links cannot be used to probe for
-- the existence of rows in someone else's space.
create or replace function app.set_link_spaces()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  new.source_space_id := app.entity_space(new.source_type, new.source_id);
  new.target_space_id := app.entity_space(new.target_type, new.target_id);

  -- "Does not exist" and "exists but you cannot write it" are raised from the
  -- SAME statement, deliberately. Two separate RAISEs would differ in errcode
  -- and in the line number PL/pgSQL reports in CONTEXT, and either is enough to
  -- turn a failed insert into an existence oracle.
  if new.source_space_id is null
     or new.target_space_id is null
     or not (new.source_space_id = any(app.writable_space_ids()))
     or not (new.target_space_id = any(app.writable_space_ids()))
  then
    raise exception 'Cannot link: one or both entities do not exist'
      using errcode = 'foreign_key_violation';
  end if;

  new.space_id := new.source_space_id;
  return new;
end;
$$;

create trigger links_set_spaces before insert or update of source_id, target_id, source_type, target_type
  on links for each row execute function app.set_link_spaces();

create or replace function app.set_tagging_spaces()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  new.entity_space_id := app.entity_space(new.entity_type, new.entity_id);
  select space_id into new.tag_space_id from tags where id = new.tag_id and deleted_at is null;

  if new.entity_space_id is null or new.tag_space_id is null then
    raise exception 'Cannot tag: entity or tag does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if not (new.entity_space_id = any(app.writable_space_ids())
          and new.tag_space_id = any(app.readable_space_ids())) then
    raise exception 'Cannot tag: entity or tag does not exist'
      using errcode = 'insufficient_privilege';
  end if;

  new.space_id := new.entity_space_id;
  return new;
end;
$$;

create trigger taggings_set_spaces before insert or update of entity_id, entity_type, tag_id
  on taggings for each row execute function app.set_tagging_spaces();

create or replace function app.set_group_member_spaces()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  select space_id into new.person_space_id from people where id = new.person_id and deleted_at is null;
  select space_id into new.group_space_id  from groups where id = new.group_id  and deleted_at is null;
  if new.person_space_id is null or new.group_space_id is null then
    raise exception 'Cannot add to group: person or group does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if not (new.person_space_id = any(app.writable_space_ids())
          and new.group_space_id = any(app.writable_space_ids())) then
    raise exception 'Cannot add to group: person or group does not exist'
      using errcode = 'insufficient_privilege';
  end if;
  new.space_id := new.group_space_id;
  return new;
end;
$$;

create trigger group_members_set_spaces before insert or update of person_id, group_id
  on group_members for each row execute function app.set_group_member_spaces();

create or replace function app.set_attendee_spaces()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  select space_id into new.event_space_id from events where id = new.event_id;
  if new.person_id is not null then
    select space_id into new.person_space_id from people where id = new.person_id;
  else
    new.person_space_id := null;
  end if;
  new.space_id := new.event_space_id;
  return new;
end;
$$;

create trigger attendees_set_spaces before insert or update of event_id, person_id
  on event_attendees for each row execute function app.set_attendee_spaces();

-- ----------------------------------------------------------------------------
-- Space moves: propagate to every denormalised copy.
-- ----------------------------------------------------------------------------

create or replace function app.propagate_space_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare et entity_type := tg_argv[0]::entity_type;
begin
  if new.space_id is not distinct from old.space_id then
    return new;
  end if;

  update links set source_space_id = new.space_id, space_id = new.space_id
    where source_type = et and source_id = new.id;
  update links set target_space_id = new.space_id
    where target_type = et and target_id = new.id;
  update taggings set entity_space_id = new.space_id, space_id = new.space_id
    where entity_type = et and entity_id = new.id;
  update attachments set space_id = new.space_id
    where entity_type = et and entity_id = new.id;

  if et = 'person' then
    update group_members set person_space_id = new.space_id where person_id = new.id;
    update event_attendees set person_space_id = new.space_id where person_id = new.id;
    update tasks set waiting_on_person_space_id = new.space_id where waiting_on_person_id = new.id;
    update person_fields set space_id = new.space_id where person_id = new.id;
    update person_dates  set space_id = new.space_id where person_id = new.id;
    -- person_state / interactions / talking_points deliberately do NOT move:
    -- sharing a person shares the facts, never my read on them.
  elsif et = 'group' then
    update group_members set group_space_id = new.space_id, space_id = new.space_id where group_id = new.id;
  elsif et = 'event' then
    update event_attendees set event_space_id = new.space_id, space_id = new.space_id where event_id = new.id;
    update event_occurrences set space_id = new.space_id where event_id = new.id;
  end if;

  insert into activity_log (space_id, actor_id, entity_type, entity_id, action, summary)
  values (new.space_id, (select auth.uid()), et, new.id, 'moved_space',
          format('moved from %s to %s', old.space_id, new.space_id));
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Never shareable by accident.
--
-- Daily notes, sensitive rows and locked rows cannot be moved into a shared
-- space by a bulk operation. They can be shared, but only one at a time and
-- only through app.share_item_explicitly(), which sets the session flag.
-- ----------------------------------------------------------------------------

create or replace function app.guard_sensitive_space_move()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  is_protected boolean := false;
begin
  if new.space_id is not distinct from old.space_id then return new; end if;
  if (select kind from spaces where id = new.space_id) <> 'shared' then return new; end if;

  is_protected :=
       coalesce(to_jsonb(new) ->> 'is_daily', 'false')::boolean
    or coalesce(to_jsonb(new) ->> 'is_locked', 'false')::boolean
    or coalesce(to_jsonb(new) ->> 'is_sensitive', 'false')::boolean;

  if is_protected and coalesce(current_setting('app.explicit_share', true), 'off') <> 'on' then
    raise exception
      'This item is journal, locked or sensitive. It can only be shared individually and explicitly.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function app.share_item_explicitly(
  p_entity_type entity_type, p_entity_id uuid, p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, pg_temp
as $$
begin
  if not (p_space_id = any(app.writable_space_ids())) then
    raise exception 'Not a member of the target space' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.explicit_share', 'on', true);   -- transaction-local
  case p_entity_type
    when 'note'  then update notes  set space_id = p_space_id where id = p_entity_id;
    when 'task'  then update tasks  set space_id = p_space_id where id = p_entity_id;
    when 'person' then update people set space_id = p_space_id where id = p_entity_id;
    when 'place' then update places set space_id = p_space_id where id = p_entity_id;
    when 'event' then update events set space_id = p_space_id where id = p_entity_id;
    when 'group' then update groups set space_id = p_space_id where id = p_entity_id;
    else raise exception 'Unsupported entity type for explicit share';
  end case;
  perform set_config('app.explicit_share', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- "Name exactly what becomes visible."
--
-- Backs the confirmation sheet on every move-to-shared: returns the item plus
-- everything linked to it that would move or become inferable, flagging what is
-- blocked because it is journal/locked/sensitive.
-- ----------------------------------------------------------------------------

create or replace function app.space_move_preview(p_entity_type entity_type, p_entity_id uuid)
returns table (
  entity_type entity_type,
  entity_id   uuid,
  label       text,
  relationship text,
  blocked     boolean,
  blocked_reason text
)
language sql
stable
security invoker
set search_path = public, app, pg_temp
as $$
  with related as (
    select l.target_type as et, l.target_id as eid, l.link_type::text as rel
      from links l
     where l.source_type = p_entity_type and l.source_id = p_entity_id and l.deleted_at is null
    union
    select l.source_type, l.source_id, l.link_type::text
      from links l
     where l.target_type = p_entity_type and l.target_id = p_entity_id and l.deleted_at is null
  )
  select r.et, r.eid,
         coalesce(n.title, p.display_name, t.title, e.title, g.name, pl.name, '(untitled)'),
         r.rel,
         coalesce(n.is_daily or n.is_locked or n.is_sensitive, false),
         case when n.is_daily then 'journal entry'
              when n.is_locked then 'locked'
              when n.is_sensitive then 'marked sensitive' end
    from related r
    left join notes  n  on r.et = 'note'   and n.id  = r.eid
    left join people p  on r.et = 'person' and p.id  = r.eid
    left join tasks  t  on r.et = 'task'   and t.id  = r.eid
    left join events e  on r.et = 'event'  and e.id  = r.eid
    left join groups g  on r.et = 'group'  and g.id  = r.eid
    left join places pl on r.et = 'place'  and pl.id = r.eid;
$$;
