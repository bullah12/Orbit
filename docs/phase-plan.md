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

- [x] Server-side search across tasks, notes, people, events and places — one
      box, five kinds, every result carrying its space indicator. The five
      partial GIN indexes were already there and all say `where not is_locked`;
      each query repeats that predicate so the planner uses it
- [x] Locked items are absent by construction, not by a filter: a locked row is
      constrained to an empty title and body, so there is no plaintext to
      match. The page says how many were not searched rather than being quietly
      short
- [x] `src/lib/search.ts` is pure — query normalisation, a word-aligned snippet
      with a crude English stem so a search for "bins" emboldens the "bin bags"
      Postgres actually matched, and a merge that promotes the first result of
      every kind ahead of the second of any kind. 50 Vitest cases
- [x] Natural-language capture, parsed **locally**, in `src/lib/capture/` — one
      import (the date helpers) and a test that reads the source back and fails
      if a `fetch`, an `import()` or an AI provider ever appears in it
- [x] UK phrasing: "a week on Tuesday", "next Friday at half three" meaning
      15:30, DD/MM never MM/DD, "quarter to five", "tomorrow morning". 99
      Vitest cases, with instants pinned on both sides of both 2026 clock
      changes and an all-day capture asserted at 23 and 25 hours
- [x] `/capture` reads the line back before creating anything: one chip per
      phrase it consumed, saying what it took it to mean
- [x] AI off by default, per feature and per space, each row stating in plain
      language what would leave the device; the provider that would answer is
      named, and whether it is a fake
- [x] A locked item never reaches an AI path — refused *first*, before consent
      is looked at, in a pure evaluator (`src/lib/ai.ts`), asserted in Vitest
      and driven through the running app
- [x] `ai_runs` out of the pgTAP known-empty ledger, with a row for every
      attempt including every refusal, and never any content
- [x] The real `AiProvider` — the Anthropic Messages API, **written, never
      run**

## Phase 6 — Sync and offline

- [x] Sync cursors — `sync_cursors` keyed (space_id, device_id, entity_kind),
      seeded deliberately behind, advanced forward only, rewound only on
      purpose. Out of the pgTAP known-empty ledger, with isolation cases from
      the partner's and the free/busy participant's side
- [x] Conflict handling in a pure module, `src/lib/sync/conflict.ts`, with its
      tests written before any UI. **There is no silent last-write-wins**: a
      field both sides changed is held with both values kept; disjoint fields
      merge; a replay is a duplicate, not a conflict; a deleted or newly locked
      or moved row is refused by name. The client clock orders nothing
- [x] Optimistic local writes — an edit applies on screen immediately, is
      marked *not sent yet*, survives a reload, and either lands or surfaces
      the conflict by name. `/sync` shows the queue, the conflicts and both
      answers, with the space indicator on every row
- [x] A queued write goes through `asUser` like every other one. There is no
      elevated path for catching up, and the applier reads the row `for update`
      and writes it in the same transaction
- [x] Push local edits back to a provider — `CalendarProvider.pushEvent`, the
      fake accepting one honestly, Google's conditional `If-Match` write
      **written, never run**. `events.is_dirty` is now cleared, and `'push'` is
      written to `calendar_sync_state.direction`
- [x] A UI for creating a recurring event — `rruleFromForm` builds a small
      honest subset and refuses rather than guesses. Still one row plus an
      RRULE, never expanded copies
- [x] Test coverage second only to RLS — 51 Vitest cases in `tests/sync.test.ts`,
      12 more for the repeat builder, 6 for the provider's write side, 7 new
      pgTAP assertions, and 49 smoke checks driving the whole sequence
      including a real conflict

---

## Standing rules

- No streaks, badges, gamification, or guilt. Ever.
- No "who viewed what" tracking. Ever.
- Category colour is the only strong colour, and never appears without an icon and
  a label.
- Calm and dense. Neutral chrome. Full dark mode. UK conventions throughout.
