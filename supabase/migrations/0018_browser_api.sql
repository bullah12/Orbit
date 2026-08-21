-- 0018_browser_api.sql — the narrow PostgREST surface used by the browser app.
--
-- Browser-facing tables and RPC wrappers stay together in `orbit`; privileged
-- implementation functions stay in the unexposed `app` schema. Every wrapper
-- is SECURITY INVOKER, so the authenticated caller's JWT and the existing
-- RLS/underlying function checks remain the authority.

create or replace function orbit.ensure_account()
returns jsonb
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select jsonb_build_object(
    'profile', result.profile,
    'spaces_created', result.spaces_created
  )
  from app.ensure_account() result
$$;

create or replace function orbit.ensure_default_spaces()
returns integer
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select app.ensure_default_spaces()
$$;

create or replace function orbit.create_space(
  p_name text,
  p_short_label text default null,
  p_kind text default 'personal',
  p_colour text default 'slate',
  p_icon text default 'circle'
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select app.create_space(p_name, p_short_label, p_kind, p_colour, p_icon)
$$;

create or replace function orbit.invite_preview(p_token text)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select to_jsonb(result) from app.space_invite(p_token, 'preview'::text) result
$$;

create or replace function orbit.invite_accept(p_token text)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select to_jsonb(result) from app.space_invite(p_token, 'accept'::text) result
$$;

create or replace function orbit.invite_decline(p_token text)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select to_jsonb(result) from app.space_invite(p_token, 'decline'::text) result
$$;

create or replace function orbit.space_move_preview(
  p_entity_kind text,
  p_entity_id uuid,
  p_target_space_id uuid
)
returns table (
  change text,
  profile_id uuid,
  display_name text,
  role text,
  reason text
)
language sql
stable
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select result.change,
         result.profile_id,
         result.display_name,
         result.role::text,
         result.reason
  from app.space_move_preview(
    p_entity_kind::app.entity_kind,
    p_entity_id,
    p_target_space_id
  ) result
$$;

create or replace function orbit.free_busy_blocks(
  p_space_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, all_day boolean)
language sql
stable
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select * from app.free_busy_blocks(p_space_id, p_from, p_to)
$$;

create or replace function orbit.free_busy_recurring(
  p_space_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  rrule text,
  rule_until timestamptz,
  exdates text[]
)
language sql
stable
security invoker
set search_path = pg_catalog, orbit, app, pg_temp
as $$
  select * from app.free_busy_recurring(p_space_id, p_from, p_to)
$$;

revoke execute on function orbit.ensure_account() from public;
revoke execute on function orbit.ensure_default_spaces() from public;
revoke execute on function orbit.create_space(text, text, text, text, text) from public;
revoke execute on function orbit.invite_preview(text) from public;
revoke execute on function orbit.invite_accept(text) from public;
revoke execute on function orbit.invite_decline(text) from public;
revoke execute on function orbit.space_move_preview(text, uuid, uuid) from public;
revoke execute on function orbit.free_busy_blocks(uuid, timestamptz, timestamptz) from public;
revoke execute on function orbit.free_busy_recurring(uuid, timestamptz, timestamptz) from public;

grant execute on function orbit.ensure_account() to authenticated;
grant execute on function orbit.ensure_default_spaces() to authenticated;
grant execute on function orbit.create_space(text, text, text, text, text) to authenticated;
grant execute on function orbit.invite_preview(text) to authenticated;
grant execute on function orbit.invite_accept(text) to authenticated;
grant execute on function orbit.invite_decline(text) to authenticated;
grant execute on function orbit.space_move_preview(text, uuid, uuid) to authenticated;
grant execute on function orbit.free_busy_blocks(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function orbit.free_busy_recurring(uuid, timestamptz, timestamptz) to authenticated;
