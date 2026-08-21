-- 0022_people_directory.sql — one RLS-scoped payload for the People list and map.
-- People, their optional home place, and their person tags need to arrive
-- together so switching between list and map never refetches or reveals a row
-- the caller could not read directly.

create or replace function orbit.people_directory()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select coalesce(jsonb_agg(
    to_jsonb(p) || jsonb_build_object(
      'home_place', case when pl.id is null then null else jsonb_build_object(
        'id', pl.id,
        'name', pl.name,
        'address_text', pl.address_text,
        'city', pl.city,
        'geom', case when pl.geom is null then null else public.ST_AsGeoJSON(pl.geom)::jsonb end
      ) end,
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug) order by t.name)
        from orbit.taggings tg
        join orbit.tags t on t.id = tg.tag_id
        where tg.entity_kind = 'person' and tg.entity_id = p.id
      ), '[]'::jsonb)
    ) order by p.display_name
  ), '[]'::jsonb)
  from orbit.people p
  left join orbit.places pl on pl.id = p.home_place_id
  where p.archived_at is null
$$;

revoke execute on function orbit.people_directory() from public;
grant execute on function orbit.people_directory() to authenticated;

comment on function orbit.people_directory() is
  'RLS-scoped People payload containing optional home-place geometry and person tags.';
