# Tests

`rls_isolation_test.sql` is a pgTAP suite covering the properties that, if broken, are a
privacy breach rather than a bug:

- a shared-space member sees a shared event and **no trace** of a private note linked to
  it — no row, no count, no aggregate, no full-text hit, no id probe
- failing to link to an invisible entity is indistinguishable from failing to link to a
  non-existent one, down to the errcode and the PL/pgSQL `CONTEXT` line
- denormalised space columns on `links` are trigger-derived, so a client cannot spoof them
- a `free_busy` member cannot read `events` or `event_occurrences` at all, sees exactly
  one anonymous block through `app.busy_blocks`, and that view has no `title` column
- shared person facts are visible to both members; `person_state` is visible to neither
  but its owner
- a journal entry cannot be bulk-moved into a shared space, but can be shared explicitly
- leaving a space revokes access immediately and the fork survives

## Running

```sh
supabase test db
```

## What has and hasn't been executed

The migrations have been applied end to end against Postgres 16 and the assertions above
were verified by hand-run SQL, with PostGIS and pgvector shimmed out (neither is available
in the authoring sandbox; the shim replaces `geography`/`vector` columns with domains and
downgrades the GiST/HNSW indexes to btree). That exercise found and fixed four real bugs:
a non-immutable generated column, extensions unresolvable from the default `search_path`,
unique constraints that were not space-scoped, and a fork pass that silently matched no
rows.

**The pgTAP suite itself has not been run** — pgTAP was not installable in that sandbox.
Treat the plan count and pgTAP helper signatures as unverified until `supabase test db`
runs green locally; the underlying properties they assert are verified.
