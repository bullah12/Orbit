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
      instants, whether a journey fits the gap, derivation, sessions, and where a
      trip stands — with 55 Vitest cases including both 2026 clock changes
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
- [x] Heavy test coverage — 78 Vitest cases in `tests/rules.test.ts`, 7 new
      pgTAP assertions from both sides of the membership, 41 smoke checks
      driving the whole sequence through the running app
- [x] A condition **and an action** are each edited where they sit. Session 8
      rebuilt the action form so its one box knows which parameter it is
      setting — `ACTION_PARAMS` per kind — which is what made reusing it per
      row possible; order matters more for an action, because actions are
      applied in order
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
- [x] A UI for creating **and editing** a recurring event — `rruleFromForm`
      builds a small honest subset and refuses rather than guesses;
      `repeatFormFromRrule` (session 8) reads a stored rule back into it and
      returns null for any rule the form cannot express, so an ordinary
      `BYDAY=3TH` is shown in words rather than silently narrowed. One
      occurrence can be skipped and put back, which is the first use of
      `recurrence_rules.exdates` from the UI. Still one row plus an RRULE,
      never expanded copies
- [x] Test coverage second only to RLS — 59 Vitest cases in `tests/sync.test.ts`,
      28 more for the repeat builder and the occurrence naming, 6 for the
      provider's write side, 7 new pgTAP assertions, and 62 smoke checks driving
      the whole sequence including a real conflict
- [x] The queue and the cursors are the same device and the page says so
      (session 8): a label in a cookie ties the browser's `localStorage` queue
      to one row in `devices` per space, and the browser's own `online` event
      flushes the queue once — a listener, never a retry

## Phase 7 — Real accounts and space invites

Not a seventh phase of the product: Phases 0–6 built Orbit and are complete.
This is the step that makes what they built usable by somebody who is not a
seeded row — it adds one migration, one new provider, and two screens, and
changes nothing about how anything already here works.

- [x] A second `AuthProvider`, `supabase`, selected by `AUTH_PROVIDER=supabase`.
      It verifies the session server-side against GoTrue's REST API and hands
      the JWT's `sub` to the **existing** `asUser()`. No SDK, no service-role
      client, no local signature checking, and not one line of
      `src/lib/queries/` changed. **Written, never run** — there is no project
      and no credential here
- [x] `AUTH_PROVIDER=dev` remains the default and remains fully working: 692
      Vitest tests and 382 smoke checks still run with zero credentials
- [x] Sign-in, sign-up, sign-out and magic-link callback screens, from the
      tokens already in `globals.css`. Email and password, and a link. **No
      OAuth providers** — each is console configuration nobody here can verify
- [x] The dev user switcher is unreachable whenever `AUTH_PROVIDER` is not
      `dev`: the sidebar renders an account panel instead, `switchUser` refuses
      on the same condition, and a second server started with the real provider
      asserts both in smoke
- [x] Migration 0012 — a trigger on `auth.users` insert creating the matching
      `public.profiles` row **with the same id**, which is what `auth.uid()`
      will be. The `profiles_email_key` collision raises naming the address and
      the existing profile rather than hitting the constraint. Seeded data is
      development data and a real deployment starts empty
- [x] `public.space_invites` gets rows at last, with **no schema change**: an
      admin creates an invitation with a role, an expiry and an optional
      address; the raw token is shown once and only its SHA-256 hash is stored
- [x] Redeeming goes through `app.space_invite(token, action)` — one
      SECURITY DEFINER function doing preview, accept and decline behind one set
      of checks, because the person redeeming is by definition not a member yet.
      `revoke execute … from public`, granted to `authenticated` alone. No
      policy was loosened and no service-role client was added
- [x] Every refusal is a sentence: expired, already used, addressed to somebody
      else, never issued, already a member. None of them is a 403 and none is a
      500
- [x] Revoking expires the invitation and keeps the row; removing a member sets
      `space_members.status = 'left'` rather than deleting. `free_busy` is
      offerable and is exercised end to end
- [x] `space_invites` out of the pgTAP known-empty ledger. plan(83) → plan(106)
- [x] `output: 'standalone'`, a Dockerfile that builds it, and `docs/deploy.md`
      as commands somebody can follow — migration order, the three gotchas and
      the `prepare: false` pooler note. **Nothing was deployed and no account
      was created**

## Session 10 — the review, and the phone

Not a phase, and it does not become one. Phases 0–6 built Orbit, Phase 7 made it
usable by somebody who is not a seeded row, and this made it usable on the device
a household organiser is actually held in. It added no table and no migration.

`docs/design-review.md` is the review, its evidence, and the plan; items 1–6 and
part of 8 were built. What was deliberately not built, and why, is in that file
under "What was built, and what was not" and in `docs/STATUS.md` under edges 32
and 33.

- [x] A `viewport` export, a manifest, a bottom tab bar and a drawer below `md`,
      and rows that keep the title on screen. Ten smoke checks at 390×844
- [x] `aria-current` on every navigation surface, carried by weight and a raised
      surface rather than by hue
- [x] Today queries events at last, with a range switch, a summary strip whose
      numbers are the lists beneath them, and an agenda with the now-line
- [x] The six stylesheet utilities adopted in `74789ce` and never used are spent
- [x] Assignment on the row, and `/tasks/mine` — the first query ever written
      against `tasks_assignee_idx`
- [x] The calendar opens at now, the now-line is `--accent`, and category colour
      is on the left edge only
- [x] Keyboard shortcuts, with the rules in a pure module and tested
- [ ] A manual light/dark override and a settings page — **blocked on a
      deliberate decision about `globals.css`**, not on effort
- [ ] A service worker, which the manifest turned from a nicety into a gap

---

## Standing rules

- No streaks, badges, gamification, or guilt. Ever.
- No "who viewed what" tracking. Ever.
- Category colour is the only strong colour, and never appears without an icon and
  a label.
- Calm and dense. Neutral chrome. Full dark mode. UK conventions throughout.

---

## Session 11 — one schema

Not a phase and not a feature. Orbit was written for a database it had to
itself; this makes it installable into a Supabase project that is already
carrying other work, which is the deployment it actually has to survive.

- [x] Everything Orbit owns is in **one schema, `orbit`** — 41 tables, six
      enums, and every helper the policies call. `public` gets nothing and the
      `app` schema is gone rather than renamed
- [x] The only object created outside it is the `auth.users` trigger in 0012,
      which is unavoidable, and a test asserts it stays the only one
- [x] Extensions go to `extensions` where that schema exists and `public` where
      it does not — never into `orbit`, which a bare `create extension` would
      have done once `orbit` led the search_path
- [x] `orbit.space_invite()` hashes with `sha256()` from `pg_catalog` rather
      than pgcrypto's `digest()`, which its own pinned `search_path` could not
      reach — **a bug in the never-run authentication path, found by moving it**
- [x] `tests/schema.test.ts` holds the invariant, and found three misses in the
      change that reading the files by eye had not
- [x] The five commands stay green: 106/106 pgTAP, clean build, clean typecheck,
      744 Vitest tests, 402/402 smoke
