-- 0013 — a recurring event is busy time too (edge 35)
--
-- The bug, stated exactly. `app.free_busy_blocks()` filters on the *stored*
-- row:
--
--     and e.starts_at < p_to and e.ends_at > p_from
--
-- A repeating event is stored once, at its DTSTART, and expanded on read. A
-- weekly stand-up that began in March therefore has `starts_at` in March, does
-- not overlap "this week", and is dropped — so a `free_busy` grantee saw none
-- of somebody's recurring commitments at all. Observed: Priya has five
-- `Team stand-up` occurrences at 10:30 in a week; Danny, who has `free_busy`
-- on that space, saw four busy blocks and none of them was the stand-up.
--
-- The direction of the error is the safe one — it shows *less*, never more —
-- but the consequence is that an availability view says somebody is free when
-- they are not, which is the one thing that view exists to answer. Decision 3
-- settled free/busy by name, so this is a correctness bug in a settled feature.
--
-- The readable path has always got this right: `listCalendarItems` fetches a
-- recurring row whenever the *series* could still be running and then expands
-- it with `expandRecurrence` in `src/lib/recurrence.ts`.
--
-- ---------------------------------------------------------------------------
-- Why this is two functions rather than expansion in SQL
-- ---------------------------------------------------------------------------
--
-- The obvious fix is to expand the rule here, so the function keeps returning
-- nothing but instants. It was rejected: RFC 5545 expansion is COUNT, UNTIL,
-- INTERVAL, BYDAY with an nth, BYMONTHDAY including -1, EXDATE, and wall-clock
-- time across a DST boundary. `src/lib/recurrence.ts` implements all of that
-- and is heavily tested. A second implementation in PL/pgSQL would be a second
-- answer to "which occurrences exist", and the two would disagree — visibly,
-- as busy blocks that do not match the owner's own calendar.
--
-- So expansion stays in one place and this returns the rule for the app to
-- expand. That does mean a grantee's session can obtain the rule text, where
-- before it could not, and that is a real departure from a recorded position
-- ("the shape of somebody's week is content"). The argument for it is in
-- `docs/decisions-log.md`. In short: what is *rendered* is unchanged — a
-- `BusyBlock` in `src/lib/queries/events.ts` has no field a rule could live in,
-- so there is no path from here to a screen — and the alternative is two
-- implementations of recurrence, which is a worse risk than a rule string
-- passing through the query layer that already holds every event title for the
-- owner.
--
-- Both functions keep the property that matters: SECURITY DEFINER, and each
-- re-checks the grant itself rather than trusting the caller.

-- ---------------------------------------------------------------------------
-- app.free_busy_blocks() — now one-offs only
-- ---------------------------------------------------------------------------
--
-- `and e.recurrence_rule_id is null` is the only change. Without it a recurring
-- row whose DTSTART happens to fall inside the window would be returned here
-- *and* expanded by the companion below, and the anchor occurrence would be
-- drawn twice.
create or replace function app.free_busy_blocks(
  p_space_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, all_day boolean)
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select e.starts_at, e.ends_at, e.all_day
  from orbit.events e
  where e.space_id = p_space_id
    and e.status <> 'cancelled'
    and e.recurrence_rule_id is null
    and e.starts_at < p_to
    and e.ends_at > p_from
    and (
      app.can_read_space(p_space_id)
      or exists (
        select 1 from orbit.free_busy_shares s
        where s.space_id = p_space_id
          and s.grantee_id = auth.uid()
          and s.revoked_at is null
          and (s.starts_on is null or s.starts_on <= p_to::date)
          and (s.ends_on is null or s.ends_on >= p_from::date)
      )
    )
  order by e.starts_at
$$;

-- ---------------------------------------------------------------------------
-- app.free_busy_recurring() — the anchors and rules the app expands
-- ---------------------------------------------------------------------------
--
-- The window test is the series test, matching the readable query exactly: a
-- rule is fetched whenever it could still be producing occurrences, and which
-- of them land in the window is decided by expansion, not by SQL.
--
-- Still no title, no category, no attendees, no id. A caller learns that
-- something repeats and when — which is what a busy block *is* — and nothing
-- about what it is.
create or replace function app.free_busy_recurring(
  p_space_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at   timestamptz,
  all_day   boolean,
  rrule     text,
  rule_until timestamptz,
  exdates   text[]
)
language sql
stable
security definer
set search_path = orbit, public, pg_temp
as $$
  select
    e.starts_at,
    e.ends_at,
    e.all_day,
    r.rrule,
    r.until,
    coalesce(r.exdates, '{}')::text[]
  from orbit.events e
  join orbit.recurrence_rules r on r.id = e.recurrence_rule_id
  where e.space_id = p_space_id
    and e.status <> 'cancelled'
    and e.starts_at < p_to
    and (r.until is null or r.until > p_from)
    and (
      app.can_read_space(p_space_id)
      or exists (
        select 1 from orbit.free_busy_shares s
        where s.space_id = p_space_id
          and s.grantee_id = auth.uid()
          and s.revoked_at is null
          and (s.starts_on is null or s.starts_on <= p_to::date)
          and (s.ends_on is null or s.ends_on >= p_from::date)
      )
    )
  order by e.starts_at
$$;

-- The same grant shape as every other SECURITY DEFINER function in this schema:
-- execute is given to `authenticated` and taken from PUBLIC, so it is not
-- reachable by an unauthenticated role that happens to find the name.
revoke execute on function app.free_busy_recurring(uuid, timestamptz, timestamptz) from public;
grant execute on function app.free_busy_recurring(uuid, timestamptz, timestamptz) to authenticated;

-- 0004 granted free_busy_blocks to `authenticated` without revoking from PUBLIC.
-- Tightened here to match, while this file is already touching it.
revoke execute on function app.free_busy_blocks(uuid, timestamptz, timestamptz) from public;
grant execute on function app.free_busy_blocks(uuid, timestamptz, timestamptz) to authenticated;
