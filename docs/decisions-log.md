# Decisions Log

Append-only. One line per decision, newest at the bottom of its section. Do not
relitigate anything here — if you depart from a decision, add a new line saying
what changed and why.

## Settled by the product owner (do not revisit)

1. **E2EE scope** — end-to-end encryption for `is_locked` items only; everything
   else is server-side at rest. Locked items are excluded from server-side search
   and from all AI paths.
2. **Partner is a light participant** — full N-member model in the data, UI
   optimised for one power user and one occasional viewer.
3. **free_busy** — policies stay as they are; only the UI changes: anonymous
   blocks in the merged calendar.
4. **Same-person linking** — two records, linked permanently, never collapsed,
   never auto-merged.
5. **Travel Mode** — manual + calendar-derived only. No background location. Do
   not request the permission.
6. **Desktop** — is the web app in a browser. No native shell.
7. **No email-in capture.**
8. **AI off by default**, per-feature opt-in, settings state what leaves the
   device. NL capture parsing is local-only and must never touch the network.
9. **No iCloud / CalDAV** — Google + `.ics` only.
10. **No post-event push prompt.** Today shows a quiet "3 events yesterday, no
    notes" row. That is the whole feature. **No pgvector.**

Standing rules: no streaks, badges, gamification or guilt. No "who viewed what"
tracking, ever.

## Session 1 — 2026-07-27

- **Branch is `claude/orbit-build-89i6ki`**, not `claude/orbit-life-os-g18nsk`. The
  task description named the latter but the session's designated branch is the
  former, and pushing elsewhere is not permitted. Same work, different name.
- **The repo was empty.** The brief says "the schema is done, 39/39 tables have
  RLS" — there was no `supabase/` directory and no `docs/`. Session 1 therefore
  *wrote* the schema rather than extending it. It is designed to match the brief's
  constraints (`space_id` + `owner_id` everywhere, RLS on every table, unique
  constraints led by `space_id`) so that from session 2 onward the "do not
  redesign it" rule applies normally.
- **Plain Postgres 16, not the Supabase CLI.** Supabase local requires Docker; the
  container has no guaranteed daemon. `0000_bootstrap.sql` creates the `auth`
  schema, `auth.uid()`, and the `anon`/`authenticated`/`service_role` roles so the
  same migrations apply unchanged to a real Supabase project later. Reversible: if
  we adopt the CLI, delete the bootstrap migration.
- **`postgres.js` over an ORM.** An ORM's fluent client invites application-side
  filtering, which is the exact failure mode RLS exists to prevent. SQL it is.
- **Single Next.js app at the repo root, not a monorepo.** Cheaper per session.
  Reversible: move `src/` into `apps/web/` later if a second deployable appears.
- **pgvector is installed but unused.** `scripts/db-reset.sh` installs it because
  the session brief says the reset needs it; decision 10 says we do not use it.
  Both are satisfied by installing the extension and referencing it nowhere.
- **Dev auth is a signed cookie naming a seeded user**, swappable behind
  `src/lib/auth/`. No OAuth, no password. `AUTH_PROVIDER=dev` is the default and
  the only implementation that exists.
- **The schema is 41 tables, not 39.** The brief's count referred to a schema
  that was not in the repository. 41 is what the domain needed; all 41 have RLS.
  Departure from the brief, recorded rather than hidden.
- **Identity lookup goes through two SECURITY DEFINER functions**
  (`app.identity_profile`, `app.identity_profiles`), not a table grant.
  Resolving a cookie to a profile happens before there is an `auth.uid()` to
  check against, so it cannot run under RLS. A plain `grant select on profiles`
  returns *zero rows* under RLS rather than erroring, which would have invited
  widening the grant until it worked. The functions cannot be widened by
  accident. `orbit_app` holds no table grants at all.
- **`apply_standard_rls()` deliberately does not use `force row level
  security`.** The table owner must bypass RLS so migrations, seeds, and pgTAP
  setup can write. Safety comes from the application connecting as
  `authenticated`, which is not the owner. If a future session ever makes the
  app connect as the owner, this stops protecting anything.
- **TypeScript pinned to 5.9.** 7.x resolved by default and Next 15's config
  loader fails on it with `Cannot read properties of undefined (reading
  'fileExists')`. Revisit when Next supports it.
- **Money is `numeric(12,2)` and dates are `date`/`timestamptz`, never text.**
  UK conventions (DD/MM/YYYY, 24h, £, Monday-first weeks) are a *formatting*
  concern and live in `src/lib/format.ts` only.

## Session 2 — 2026-07-28

- **Vitest, not Jest, and no test framework for React components.** The suite
  covers pure logic — dates, smart-list rules, Markdown, colour maths. Rendering
  is verified by driving the real app (`pnpm smoke`), which catches the things a
  shallow render cannot: whether the *server action* wrote to Postgres, and
  whether RLS holds over HTTP. Reversible: add a component runner later if a
  component grows logic worth isolating.
- **`format.ts` functions take an injectable `today`/`now`.** A date test that
  depends on the container's clock tests the container. Callers are unaffected —
  the parameter defaults to real time.
- **Smart-list rules exist twice on purpose**: as SQL in `queries/tasks.ts` for
  listing, and as pure predicates in `smartlists.ts` for the task detail page,
  the tests, and the optimistic path Phase 6 will need. Duplication accepted;
  the module comment and the test names say to change both. The alternative —
  fetching from Postgres to answer "which lists is this task in?" — costs a
  round trip on every render.
- **Markdown is a hand-written subset, not a dependency.** It parses to a typed
  tree that React renders, so raw HTML is never a node and the sanitiser
  question does not arise. Link targets are filtered to http/https/mailto and
  in-app paths. No tables, images or task lists yet — recorded as a rough edge,
  not a silent gap.
- **Contrast is a test, not a judgement.** `src/lib/colour.ts` converts oklch to
  sRGB and computes WCAG ratios from the tokens in `globals.css`. It found four
  real failures on its first run (emerald, amber, lime and orange against their
  own light chip fill, 4.31–4.51:1); those tokens were darkened. A new colour
  that reads badly now fails `pnpm test`.
- **`app.entity_space()` is SECURITY INVOKER, deliberately.** It exists so note
  linking can refuse a cross-space link. As SECURITY DEFINER it would hand back
  a space id for an item the caller cannot read, which is a membership
  disclosure. There is a pgTAP case pinning this.
- **The outsider check iterates `pg_tables` rather than listing tables.** A
  per-table hand-written case is the thing you forget. The cost is that it can
  pass vacuously on an empty table, so assertion 44 is a ledger of the tables
  that are legitimately empty today; a new table appearing there means nothing
  writes to it.
- **A third seeded profile, Sam Okafor, a member of nothing.** pgTAP proves an
  outsider sees zero; this makes the same thing provable *through the app*, in
  one click of the dev switcher. Its UUID is a literal, not a `uid()` call, so
  adding it shifted no other seeded id.
- **`pnpm smoke` is a first-class check, not a scratch script.** "Verify RLS
  through the running app, not only in pgTAP" is a standing instruction; a
  repeatable command is the only way that survives a session boundary. It is
  deliberately not wired into `pnpm test` — it needs a running server.
- **Archive before delete, everywhere it is offered.** Notes archive by default
  and can only be deleted from the archive. Tasks delete outright because a task
  is a smaller thing to lose and `status = 'dropped'` already exists for the
  reversible case. Departure from nothing in particular; recorded because the
  asymmetry is deliberate.
- **`ComposeTask` became a client component.** Categories belong to a space, so
  changing the space has to change the category list without a round trip.
  Rendering every space's categories at once and letting the server sort it out
  is how a task ends up silently uncategorised — which is exactly the bug
  session 1 recorded as rough edge 6.
- **Linking is written in canonical id order, resolved in SQL.** The table's
  check constraint requires `person_a_id < person_b_id`, so if the application
  passed the two ids in the order the user happened to click them, half the
  links would fail. `least()`/`greatest()` in the insert makes "link A to B" and
  "link B to A" produce the same row, which is also what makes the unique
  constraint mean anything.
- **Link candidates come only from spaces the caller can write.** The policy
  requires write access on both sides, so offering a candidate you cannot link
  would be offering a refusal. Same-name candidates in another space float to
  the top, because that is nearly always the intended one.
- **A person is archived, never deleted.** Tasks delete outright — `dropped`
  already exists for the reversible case and a task is a small thing to lose. A
  person carries contacts, dates, links and a history of mentions; losing that
  by accident is not recoverable, so the UI does not offer it at all.
- **The pgTAP empty-table ledger is a subset check, not equality.** The first
  version compared the empty-table list for equality, which meant that *using
  the app* failed the suite: a move writes to `activity_log`, and this file runs
  against the live database rather than a fixture. A ledger table filling up is
  good news. What must fail is a table *outside* the ledger being empty, because
  that means either the seed did not run or a table has shipped that nothing
  writes to — and the outsider check cannot fail on an empty table. Recorded
  because the equality version looked stricter and was in fact worse.
- **The seed writes one `activity_log` row.** So that table gets outsider
  coverage from a fresh seed rather than only after somebody performs a move.
  Note what is deliberately absent from it: nothing records that a thing was
  *viewed*. There is a check constraint refusing it and a test asserting so.

## Session 3 — 2026-07-28

- **The branch is `claude/orbit-build-phase-2-vu20kw`**, not
  `claude/orbit-build-8ybx2s`. The task description named session 2's branch,
  which has already been merged into `main` via PR #3; the session's designated
  branch is the former, and pushing elsewhere is not permitted. Same work,
  different name — the same thing happened in session 1.
- **Every `*_PROVIDER` value that is not known is a hard error**, not a fall
  back to the fake. `GEOCODING_PROVIDER=nominatim` fails at selection with the
  list of what exists. Quietly serving fixture data to somebody who asked for a
  real service is the exact failure the interface-plus-fake pattern exists to
  prevent, and a silent default is how that happens.
- **A real implementation must not throw at construction.** `new
  GoogleCalendarProvider({})` succeeds with no credentials and fails when
  *called*. The app has to boot and render with zero credentials whatever the
  env says, including a settings page that lists which provider is live.
- **Only two real implementations exist: Google Calendar and HTTP ICS.**
  Geocoding, travel time, push and AI have interfaces and fakes only; their
  real implementations belong to the phases that use them (3 and 5). Recorded
  rather than filled with classes that throw "not implemented", which would be
  a stub pretending to be a decision.
- **ICS providers fetch bytes; parsing is ours and shared.** Both the fake and
  the HTTP fetcher hand their text to the same `parseIcs`, so the two cannot
  disagree about what a feed means — and parsing is the only half of ICS import
  this container can actually execute.
- **Recurrence is expanded in the application, never in Postgres and never by
  a provider.** Google's `singleEvents=true` would have given us a second
  implementation of what a repeat means that no test here could reach. One
  implementation, in `src/lib/recurrence.ts`, with 26 cases on it.
- **An invalid recurrence date is skipped, not clamped.** "The 31st of every
  month" produces nothing in April. Clamping to the 30th is the intuitive
  implementation and it invents an event on a day nobody chose. RFC 5545 §3.3.10
  agrees; the test names the rule.
- **A repeat repeats on the wall clock.** Expansion works on local dates and
  times and rebuilds an instant per occurrence, so 09:00 every Monday is 09:00
  in March and 09:00 in April even though the UTC instant moves. `zonedInstant`
  in `format.ts` solves `t + offset(t) = naive` with one refinement rather than
  hard-coding when the clocks change.
- **The spring gap resolves forward and the autumn repeat resolves late.**
  01:30 on 29 March 2026 does not exist and becomes 02:30 BST; 01:30 on 25
  October happens twice and takes the second, GMT, one. Both are arbitrary but
  both are now *chosen*, tested and documented rather than emergent.
- **Grid positions are fractions of `londonDayMinutes(day)`, not of 1440.**
  29 March is 1380 minutes long and 25 October is 1500. A hard-coded day length
  puts every block on those two days in the wrong place, and the test that
  catches it asserts a 12:00 event sits past the middle of the long day.
- **An event belongs to every day it touches.** `daySpan()` clips it per day,
  so a 23:00–01:00 event draws on both. Filtering by start date alone is what
  makes a Monday morning look empty.
- **The space indicator stays on narrow week-column blocks**, moving inline
  with the time rather than being dropped when the block is small. A merged
  calendar where you cannot tell whose event it is at a glance is precisely
  what that requirement exists to prevent. The category and attendee count are
  what get dropped instead.
- **A `free_busy` block is a different type, not an event with fields hidden.**
  `BusyBlock` has no id, no title and no category, and it comes from a
  different query. There is no prop that turns an event into an anonymous
  block, so a component cannot leak one by forgetting to check.
- **A provider deletion cancels the local event; it never deletes it.** A
  tombstone is recoverable and a delete is not, and a cancelled event is
  already excluded from every calendar query.
- **Migration 0010 adds `recurrence_rules.exdates`.** The schema had nowhere to
  put RFC 5545 EXDATE, so an imported feed that cancelled one occurrence grew
  it back on every render. Stored as instants rather than appended to the RRULE
  text, because they are compared as instants. First extension of the schema
  since session 1, and it was a feature genuinely needing a column.
- **The seed writes two recurring events and a `calendar_sync_state` row per
  calendar**, so `recurrence_rules` and `calendar_sync_state` leave the pgTAP
  known-empty ledger. The outsider check iterates `pg_tables` and cannot fail
  on an empty table; a table nothing writes to has an untested policy. Three
  new assertions pin recurrence-rule visibility from the partner's and the
  free/busy participant's side — the shape of somebody's week is content.
- **A note's links do not survive a move that would make them cross a space
  boundary.** They are deleted, decided by `app.entity_space()` under the
  caller's own privileges, and the confirmation says so before the write. The
  alternative is a link pointing at something the reader can no longer see.
- **`pnpm smoke` must pass twice in a row without reseeding.** A "full pull" is
  only full against a fresh database, so the checks assert the *sequence* — a
  pull, then an incremental one — rather than the absolute state. A check that
  passes once and then fails forever is worse than no check.

## Session 4 — 2026-07-28

- **The branch is `claude/orbit-phase-3-places-7x37yk`**, not
  `claude/orbit-build-phase-2-vu20kw`. The task description named session 3's
  branch, which is already merged into `main` via PR #4; the session's
  designated branch is the former. Same thing happened in sessions 1, 2 and 3 —
  the designated branch wins every time.
- **A place's "people" are derived from event attendees, not from a new table.**
  The brief asks for linked people on a place. There is no person↔place table
  and adding one would be a schema change for something the schema already
  answers: the honest association is "people who were at an event here". The
  page says it is derived rather than implying somebody recorded it. If a
  future phase needs "Sadia's dentist is here" as a fact rather than a
  coincidence, *that* is when the table earns its place.
- **A place is archived, never deleted.** Same rule as people, and for a
  stronger reason: events, visits and travel legs point at it, and the FKs are
  `on delete set null` — deleting a place silently empties a field on every one
  of them. Archiving keeps the visits and is reversible.
- **Moving a place cuts loose what is left behind, rather than moving it.**
  Visits are the place's own history and travel with it. Events and travel legs
  in the *old* space stop naming the place, because a reference to something
  its readers can no longer see is worse than no reference. Stated in the
  confirmation before the write, like every other move.
- **Typed-in coordinates are not a geocode.** Editing latitude and longitude by
  hand leaves `geocode_source` alone and never sets `geocoded_at`, so a place
  always says where its point actually came from. A place with no point at all
  is a normal steady state, not an error.
- **Nominatim's contact string is treated as a credential.** It has no API key,
  but the usage policy requires a genuine identifying contact and treats an
  anonymous client as abuse. `NOMINATIM_CONTACT` is therefore required and its
  absence fails when the provider is *called*, exactly like Google's refresh
  token. The one-request-a-second limit is encoded as a serialising gate rather
  than described in a comment.
- **OpenRouteService refuses public transport instead of answering with a car.**
  ORS has no transit profile. A driving number labelled "bus" is a lie with a
  plausible number attached, so `travel:openrouteservice` throws for `transit`,
  and `estimateLegMinutes()` — clearly labelled a guess — is what fills the gap.
  `plane` and `other` map to no profile at all for the same reason.
- **Travel maths is a pure module, tested before any UI was wired to it.** The
  brief called travel a bug farm the way recurrence was, and it is: buffers,
  midnight, missing coordinates and the two clock changes. 46 cases in
  `tests/travel.test.ts`, all the clock ones on the real 2026 boundaries, all
  through `zonedInstant` / `londonDayMinutes` rather than `getDate()`.
- **A gap is measured between instants, not on the wall clock.** 00:30 to 03:00
  on 29 March looks like 150 minutes and is 90; 00:30 BST to 02:00 GMT on 25
  October looks like 90 and is 150. Both are asserted. This is the case that
  makes somebody late, and the arithmetic never has to know which side of a
  boundary it is on because it never leaves instants.
- **Derivation is deliberately narrow.** All-day events are ignored — being
  somewhere all Tuesday is a trip, not a journey. An event with no place is
  skipped without breaking the chain. Two events at the same place imply
  nothing. The first journey of the day only exists if you say where you
  started. A wrong journey in a list is worse than a missing one.
- **A multi-day event is a trip; a gig that runs past midnight is a late
  night.** `sessionFromEvent()` counts London days rather than hours, so the
  23- and 25-hour days behave like every other day, and a timed event ending
  before 06:00 the next morning is explicitly not a trip.
- **Derived journeys are estimated crudely on the page and properly on save.**
  Asking a routing provider for every derived leg on every render is a request
  per render, which with a real provider is somebody's rate limit. The page
  shows the distance-based guess; the provider is asked once, at the moment a
  journey is saved or re-estimated.
- **`EventRow` gained `placeId`, `placeLat` and `placeLon`** so travel
  derivation could reuse `listCalendarItems()` rather than growing a second
  query that expands recurrence its own way. One implementation of what a
  repeat means, still.
- **The free/busy blocks are dropped before derivation, not filtered after.**
  A `BusyBlock` has no id and no place, so it cannot be an endpoint — and
  reaching past the policy to find out where somebody actually is would be
  precisely the disclosure the free/busy model exists to prevent.
- **The seed writes a fixed travel day, 29 July 2026.** Three placed Home
  events arranged so the first hop has room and the second does not, so
  `/travel` demonstrates both verdicts on a cold container and the smoke suite
  can navigate straight to it. A date computed from "today" would drift.
- **One place is seeded into Work.** Everything else is in Home, which meant
  "the partner sees Home travel and not Work travel" had nothing on the Work
  side to fail on. There are now 16 places, not 15.
- **`place_visits`, `travel_legs` and `travel_sessions` left the pgTAP
  known-empty ledger**, with eight new assertions: the partner sees the shared
  place, visit, journey and trip and not the ones in Priya's own space; a
  free/busy participant sees none of the four. Where somebody went, and when
  they left to get there, is content — it is strictly more than "busy".
  plan(55) → plan(63).
- **An uncontrolled `<select>` keyed on its own stored value.** After
  re-estimating a journey in another mode the control went on showing the old
  mode: `defaultValue` only applies when the DOM node mounts. Keying the select
  on the stored mode forces the remount. Recorded because it looked like the
  action had failed when it had not, and the smoke check that caught it now
  asserts the stored value and the visible one separately.
