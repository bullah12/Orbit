-- 0010_recurrence_exdates.sql
--
-- A recurrence has exceptions: RFC 5545 EXDATE, the "not that week" of a
-- repeating event. Orbit had nowhere to put them, so an imported feed that
-- cancelled one occurrence quietly grew it back on every render.
--
-- Stored as instants rather than as text appended to the RRULE, because they
-- are queried and compared as instants and a rule string would have to be
-- re-parsed to mean anything.
--
-- Deletions belong here too, eventually: an occurrence the user drops locally
-- is the same shape as one the feed excluded. Phase 2 only writes the imported
-- ones.

alter table orbit.recurrence_rules
  add column exdates timestamptz[] not null default '{}';

comment on column orbit.recurrence_rules.exdates is
  'Instants the series skips (RFC 5545 EXDATE). Expansion is application-side; see src/lib/recurrence.ts.';
