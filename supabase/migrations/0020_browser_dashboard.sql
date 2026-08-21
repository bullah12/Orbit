-- 0020_browser_dashboard.sql — one RLS-scoped request for the measured Today fan-out.
--
-- The direct client required three route requests (tasks, events, important
-- dates). This SECURITY INVOKER wrapper changes only transport shape: every
-- select still runs as the signed-in caller against the existing policies.

create or replace function orbit_api.dashboard(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, orbit, app, pg_temp
as $$
  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.due_on nulls last, t.updated_at desc)
      from orbit.tasks t
      where t.status in ('todo', 'doing', 'blocked')
        and t.due_on <= p_to::date
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        to_jsonb(e) || jsonb_build_object(
          'recurrence_rules', case when r.id is null then null else to_jsonb(r) end
        ) order by e.starts_at
      )
      from orbit.events e
      left join orbit.recurrence_rules r on r.id = e.recurrence_rule_id
      where e.status <> 'cancelled'
        and e.starts_at < p_to
        and (
          (e.recurrence_rule_id is null and e.ends_at > p_from)
          or (e.recurrence_rule_id is not null and (r.until is null or r.until > p_from))
        )
    ), '[]'::jsonb),
    'dates', coalesce((
      select jsonb_agg(
        to_jsonb(d) || jsonb_build_object(
          'people', jsonb_build_object('display_name', p.display_name)
        ) order by extract(month from d.on_date), extract(day from d.on_date)
      )
      from orbit.person_dates d
      join orbit.people p on p.id = d.person_id
    ), '[]'::jsonb)
  )
$$;

revoke execute on function orbit_api.dashboard(timestamptz, timestamptz) from public;
grant execute on function orbit_api.dashboard(timestamptz, timestamptz) to authenticated;

comment on function orbit_api.dashboard(timestamptz, timestamptz) is
  'RLS-scoped Today payload added after measuring three direct route requests.';
