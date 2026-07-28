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

- [x] Events, attendees, recurrence — a repeat is one row plus an RRULE,
      expanded by `src/lib/recurrence.ts`, never stored expanded
- [x] Day / week / month views, merged across spaces, Monday-first
- [x] `free_busy` participants render as anonymous blocks in the merged
      calendar, reached only through `app.free_busy_blocks()`
- [x] ICS import (fixture-backed fake by default), re-importable without
      duplicating, writing `recurrence_rules` and `event_attendees`
- [x] Google Calendar behind the same interface, no credentials required to
      run — the *interface and the pull* are exercised here against the fake;
      the Google implementation itself is **written, never run**
- [x] Today: quiet "N events yesterday, no notes" row. That is the whole
      feature. (Shipped in Phase 0.)

## Phase 3 — Places and Travel

- [x] Places: list, detail, create, edit, archive and restore; linked events,
      notes and people; the space indicator on every row and compose surface
- [x] Move a place between spaces, behind `app.space_move_preview()` — the
      fifth and last entity type, which completes that requirement
- [x] Visits, recorded by hand or marked as calendar-derived. No background
      location column, no permission request
- [x] Geocoding behind `GeocodingProvider`: the fake is the default and needs
      no network; **Nominatim written, never run** (`GEOCODING_PROVIDER=nominatim`)
- [x] Travel legs and estimates behind `TravelTimeProvider`: the fake is the
      default; **OpenRouteService written, never run**
- [x] Travel Mode: manual + calendar-derived only. A trip is started by hand or
      lifted from a multi-day event; a journey is typed in or derived from two
      events at different places. No background location, and we do not request
      the permission.
- [x] `src/lib/travel.ts` is pure and carries the maths — buffers, departure
      instants, whether a journey fits the gap, derivation, sessions — with 46
      Vitest cases including both 2026 clock changes
- [x] `place_visits`, `travel_legs` and `travel_sessions` seeded and out of the
      pgTAP known-empty ledger, with isolation cases from the partner's and the
      free/busy participant's side

## Phase 4 — Rules engine

- [x] Declarative rules: trigger, condition, action. `src/lib/rules.ts` is pure
      and holds the whole engine — four triggers, ten condition fields, ten
      operators, six actions — with the tests written before any UI reached it
- [x] Dry-run preview before enabling, naming every item and every change in a
      sentence; a rule cannot be switched on until it has been previewed, and
      any structural edit switches it off and clears the preview
- [x] `rule_runs` audit trail, dry runs included, recording every item a run
      considered and not only the ones it acted on
- [x] A rule never acts on a locked item and never across a space boundary —
      both refused in the evaluator with a stated reason, both asserted in
      Vitest, both visible in the preview
- [x] Notifications through `PushProvider`; the fake is the default and the
      real Web Push provider is **written, never run**
- [x] Heavy test coverage — 69 Vitest cases in `tests/rules.test.ts`, 7 new
      pgTAP assertions from both sides of the membership, 28 smoke checks
      driving the whole sequence through the running app
- [x] `rule_runs`, `notification_deliveries` and `note_versions` out of the
      pgTAP known-empty ledger

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
