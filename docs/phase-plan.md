# Orbit — Phase Plan

Strict order. Each phase must be shippable — usable, demoable, not broken — before
the next one starts. Work in vertical slices that run.

---

## Phase 0 — Private task and note app, with sharing already real

**Stopping here is a good outcome.** It leaves a private tasks + notes app where
spaces, membership, and the space indicator are genuinely working, not mocked.

- [ ] Schema: all tables, RLS on all of them, `app.*` helper functions
- [ ] `scripts/db-reset.sh` — idempotent, from zero
- [ ] pgTAP `rls_isolation_test.sql` green, run by `scripts/db-test.sh`
- [ ] `pnpm seed` — 2 users, household space, ~40 people, ~200 events, ~80 tasks,
      ~30 notes, ~15 places, Birmingham-flavoured
- [ ] RLS-scoped data access from the app (no service role at request time)
- [ ] Tasks: list, smart lists, create, complete, edit
- [ ] Notes: list, read, create, edit, links to entities
- [ ] Space indicator on every row and compose surface
- [ ] `app.space_move_preview()` behind every move confirmation
- [ ] Dark mode, UK conventions, neutral chrome

## Phase 1 — People

- Person records, contacts, important dates
- Same-person linking: two records, linked permanently, never collapsed
- Person detail: linked notes, tasks, events, places
- Birthdays and anniversaries surfaced on Today

## Phase 2 — Calendar

- Events, attendees, recurrence
- Day / week / month views, merged across spaces
- `free_busy` participants render as anonymous blocks in the merged calendar
- ICS import (fixture-backed fake by default)
- Google Calendar behind the same interface, no credentials required to run
- Today: quiet "N events yesterday, no notes" row. That is the whole feature.

## Phase 3 — Places and Travel

- Places, visits, geocoding behind an interface
- Travel legs, travel time estimates behind an interface
- Travel Mode: manual + calendar-derived only. No background location, and we do
  not request the permission.

## Phase 4 — Rules engine

- Declarative rules: trigger, condition, action
- Dry-run preview before enabling; `rule_runs` audit trail
- Heavy test coverage — this is a bug farm

## Phase 5 — Search, capture, and AI

- Server-side search across everything **except** locked items
- Natural-language capture, parsed locally, never over the network
- AI features off by default, per-feature opt-in, plain-language disclosure of
  what leaves the device

## Phase 6 — Sync and offline

- Sync cursors, conflict handling, optimistic local writes
- Test coverage second only to RLS

---

## Standing rules

- No streaks, badges, gamification, or guilt. Ever.
- No "who viewed what" tracking. Ever.
- Category colour is the only strong colour, and never appears without an icon and
  a label.
- Calm and dense. Neutral chrome. Full dark mode. UK conventions throughout.
