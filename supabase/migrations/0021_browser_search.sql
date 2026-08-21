-- 0021_browser_search.sql — one RLS-scoped request for global search.
-- Five parallel entity requests are combined without changing authorisation.

create or replace function orbit_api.search(p_query text, p_limit integer default 8)
returns table (id uuid, type text, title text, subtitle text, space_id uuid, path text)
language sql
stable
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  with input as (
    select btrim(coalesce(p_query, '')) as query,
           least(greatest(coalesce(p_limit, 8), 1), 20) as row_limit
  ),
  task_results as (
    select t.id, 'task'::text as type, t.title, 'Task'::text as subtitle,
           t.space_id, '/tasks/item/' || t.id::text as path
    from orbit.tasks t, input i
    where char_length(i.query) >= 2 and not t.is_locked and t.title ilike '%' || i.query || '%'
    order by t.updated_at desc limit (select row_limit from input)
  ),
  note_results as (
    select n.id, 'note'::text, coalesce(nullif(n.title, ''), 'Untitled note'),
           'Note'::text, n.space_id, '/notes/' || n.id::text
    from orbit.notes n, input i
    where char_length(i.query) >= 2 and not n.is_locked and n.title ilike '%' || i.query || '%'
    order by n.updated_at desc limit (select row_limit from input)
  ),
  person_results as (
    select p.id, 'person'::text, p.display_name, 'Person'::text,
           p.space_id, '/people/' || p.id::text
    from orbit.people p, input i
    where char_length(i.query) >= 2 and not p.is_locked and p.display_name ilike '%' || i.query || '%'
    order by p.display_name limit (select row_limit from input)
  ),
  event_results as (
    select e.id, 'event'::text, e.title, e.starts_at::text,
           e.space_id, '/calendar?event=' || e.id::text
    from orbit.events e, input i
    where char_length(i.query) >= 2 and not e.is_locked and e.title ilike '%' || i.query || '%'
    order by e.starts_at desc limit (select row_limit from input)
  ),
  place_results as (
    select p.id, 'place'::text, p.name, coalesce(p.city, 'Place'),
           p.space_id, '/places/' || p.id::text
    from orbit.places p, input i
    where char_length(i.query) >= 2 and not p.is_locked and p.name ilike '%' || i.query || '%'
    order by p.name limit (select row_limit from input)
  )
  select * from task_results
  union all select * from note_results
  union all select * from person_results
  union all select * from event_results
  union all select * from place_results
$$;

revoke execute on function orbit_api.search(text, integer) from public;
grant execute on function orbit_api.search(text, integer) to authenticated;

comment on function orbit_api.search(text, integer) is
  'RLS-scoped global search payload added after measuring five browser requests.';
