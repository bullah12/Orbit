-- 0009_entity_space.sql
--
-- Which space does an entity live in?
--
-- Several features need this before they can act: linking a note to a task has
-- to refuse a link across a space boundary, and the move UI (Phase 1 onward)
-- has to resolve the source space for kinds other than `task`. Writing that
-- lookup in the application would mean the application deciding which space an
-- item belongs to, which is exactly the arbitration RLS exists to keep out of
-- the client.
--
-- SECURITY INVOKER, deliberately: the lookup runs under the caller's policies,
-- so an entity the caller cannot read resolves to no rows rather than to a
-- space id. That makes it safe to call with an id supplied by a form.

-- Everything below lives in the `orbit` schema. The search_path names it
-- first so an unqualified CREATE cannot land in a schema this project
-- shares with somebody else's work, and names `public` and `extensions`
-- after it because that is where an installation puts PostGIS and pgcrypto:
-- Supabase uses `extensions`, a local cluster uses `public`.
set search_path = orbit, public, extensions, pg_catalog;


create or replace function orbit.entity_space(
  p_entity_kind orbit.entity_kind,
  p_entity_id   uuid
)
returns table (space_id uuid)
language plpgsql
stable
security invoker
set search_path to orbit, pg_temp
as $$
declare
  v_table text;
begin
  v_table := case p_entity_kind
    when 'task'       then 'tasks'
    when 'note'       then 'notes'
    when 'person'     then 'people'
    when 'event'      then 'events'
    when 'place'      then 'places'
    when 'travel_leg' then 'travel_legs'
    when 'rule'       then 'rules'
    else null
  end;

  if v_table is null then
    return;
  end if;

  return query execute format(
    'select t.space_id from orbit.%I t where t.id = $1', v_table
  ) using p_entity_id;
end;
$$;

comment on function orbit.entity_space(orbit.entity_kind, uuid) is
  'The space an entity belongs to, or no rows if the caller cannot read it. '
  'SECURITY INVOKER so RLS decides, not the caller.';

grant execute on function orbit.entity_space(orbit.entity_kind, uuid) to authenticated;
