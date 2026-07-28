# Orbit — Phase Plan

Strict order. Each phase must be shippable — usable, demoable, not broken — before
the next one starts. Work in vertical slices that run.

---

## Phase 0 — Private task and note app, with sharing already real

**Stopping here is a good outcome.** It leaves a private tasks + notes app where
spaces, membership, and the space indicator are genuinely working, not mocked.

- [x] Schema: all tables, RLS on all of them, `app.*` helper functions
- [x] `scripts/db-reset.sh` — idempotent, from zero
- [x] pgTAP `rls_isolation_test.sql` green, run by `scripts/db-test.sh`
- [x] `pnpm seed` — 2 users, household space, ~40 people, ~200 events, ~80 tasks,
      ~30 notes, ~15 places, Birmingham-flavoured
- [x] RLS-scoped data access from the app (no service role at request time)
- [x] Tasks: list, smart lists, create, complete, edit
- [x] Notes: list, read, create, edit, links to entities
- [x] Space indicator on every row and compose surface
- [x] `app.space_move_preview()` behind every move confirmation
- [x] Dark mode, UK conventions, neutral chrome

## Phase 1 — People

- [x] Person records, contacts, important dates — create, edit, add and remove
- [x] Same-person linking: two records, linked permanently, never collapsed —
      shown from both sides, and the far side stays hidden when its space is
- [x] Person detail: linked notes, tasks, events, places
- [x] Birthdays and anniversaries surfaced on Today
- [x] Create, edit and link a person from the UI
- [x] Move a person between spaces, behind `app.space_move_preview()`

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
