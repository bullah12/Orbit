# Orbit

A personal life operating system: calendar, tasks, notes, contacts and places in one app,
where every item can be linked to every other item — and where sharing with one other
person is part of the foundation rather than a later feature.

**Status: design review.** No application code yet. This repository currently holds the
architecture decision record, the schema, and the phase plan, pending sign-off.

## Read in this order

| | |
|---|---|
| [`docs/open-questions.md`](docs/open-questions.md) | Questions that change the work, with recommendations. **Start here.** |
| [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md) | Stack, offline sync, calendar auth, space isolation, concurrent editing |
| [`docs/phase-plan.md`](docs/phase-plan.md) | What's in and out of each phase |
| [`supabase/migrations/`](supabase/migrations/) | The schema |
| [`supabase/tests/rls_isolation_test.sql`](supabase/tests/rls_isolation_test.sql) | The tests that matter most |

## The two ideas the design is built around

**The link graph.** One polymorphic `links` table is the spine. A note is about a person,
a person attends an event, an event happens at a place, a task blocks an event. Every
detail screen shows what's connected.

**Spaces.** Every row belongs to exactly one space — Personal by default, Shared by
explicit action. Visibility is a pure function of space membership, enforced in Postgres
row-level security, in one place, applied identically to every table.

And the requirement underneath both: **links must not leak.** If a shared event is linked
to a private note, the other member sees the event and no trace of the note — no greyed
row, no count, no "1 hidden item". `links` denormalises the space of both endpoints so
that the row simply does not exist for anyone who cannot see both ends, which makes
counts, aggregates and existence probes safe by construction rather than one at a time.

## Migrations

```
20260101000000_extensions_and_types.sql   extensions, enums, column conventions
20260101000100_spaces_and_helpers.sql     spaces, membership, shares, the RLS core
20260101000200_graph.sql                  tags, taggings, links, attachments
20260101000300_people.sql                 shared facts vs per-member private state
20260101000400_groups_places.sql          groups, smart groups, places, travel
20260101000500_calendar.sql               calendars, events, occurrences, busy blocks
20260101000600_tasks.sql                  tasks, contexts, recurrence, chore rotation
20260101000700_notes.sql                  notes, Yjs state, embeddings, integrations
20260101000750_entity_triggers.sql        entity-space resolution and leak prevention
20260101000800_rls.sql                    policies applied uniformly to every table
20260101000900_offboarding_and_gdpr.sql   leave-and-fork, erasure, export
```

```sh
supabase start && supabase db reset   # apply
supabase test db                      # run the RLS negative tests
```
