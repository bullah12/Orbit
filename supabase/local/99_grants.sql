-- ============================================================================
-- Local-only: table/function grants that Supabase applies by default privilege
-- to everything created in `public`. RLS is what actually gates rows; these
-- grants only make the tables reachable by the `authenticated` role at all.
-- Run AFTER the migrations. Not a migration.
-- ============================================================================

grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage,  select                 on all sequences in schema public to authenticated;
grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all functions in schema public to authenticated;

-- Deliberately NOT `grant execute on all functions in schema app`. Migration
-- 0900 grants exactly the app functions clients may call and revokes
-- fork_space_to_personal, which is SECURITY DEFINER and takes a user id. A
-- blanket grant here would hand that back.

-- Credentials stay unreachable: only service_role, which bypasses RLS.
revoke all on integration_credentials from authenticated, anon;

-- app.busy_blocks is granted explicitly in the calendar migration; app schema
-- usage is granted there too. Nothing else in `app` is a table.
