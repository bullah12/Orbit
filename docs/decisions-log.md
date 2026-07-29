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
- **Four Phase 3 rough edges are accepted, not forgotten.** Recorded here
  because "accepted" means a line saying why, not silence. (a) *A trip has no
  detail page*: it is a row with a delete button, which is enough to make trips
  usable and demoable, and a second edit surface is Phase 4's problem if
  anything ever needs it. (b) *Derived journeys are re-derived on every render*:
  one day's events at a time, which is a fraction of the calendar's expansion
  cost that is already accepted. (c) *The derived mode is guessed from the
  distance and the guess is not remembered*: remembering it means a
  `travel_preferences` row, which is a schema change for a convenience.
  (d) *A provider failure leaves the journey saved with no estimate and says
  nothing on screen*: the journey is still worth recording, and the alternative
  — refusing to save because a routing service was unreachable — is worse.
- **The duplicate guard on a derived journey is in the insert, not a
  constraint.** `insert … select … where not exists` on `(from, to, arrival)`
  costs nothing and closes the double-click. A unique constraint would be
  better and is the honest fix, but `travel_legs` has no natural key — a leg
  with two null place ids is legitimate — so it would need a partial index and
  a decision about what "the same journey" means. Recorded as a rough edge
  rather than guessed at.
- **A smoke check must not choose anything by index.** The ICS import check
  picked its target calendar with `{ index: 1 }`. Connecting the fixture
  calendars — which a previous run of the same suite does — adds options above
  it, so on the second run the feed imported into a different space and left
  two "Monday assembly" events, which broke an unrelated move check three
  sections later. Session 3's "passes twice in a row" was true of the database
  it was run against and not of a freshly reset one. Both checks now name what
  they want: the calendar by label, and the move destination read off the
  page's own list of offered targets.

## Session 5 — 2026-07-28

- **The branch is `claude/orbit-phase-4-rules-gey60v`.** Same as every session
  so far: the task description named the previous session's branch and the
  designated one won. Session 4's branch is merged into `main` as PR #5.
- **The evaluator is pure and takes a *fact*, not a row.** `src/lib/rules.ts`
  never touches Postgres, the network or a provider. It is handed a flat
  snapshot of one entity and a rule, and answers two questions: did it match,
  and what would it change. Applying anything is the caller's job. The tests
  were written before the first line of UI, the way recurrence and travel were,
  and both of those stayed solid.
- **A dry run and a real run are the same code path with one boolean
  different.** There is no dry-run branch in the evaluator at all. A preview
  computed differently from the run is a preview of something else.
- **A rule never acts on a locked item, and the refusal lives in the
  evaluator.** The server holds ciphertext for a locked task — the check
  constraint guarantees `title` and `body_md` are empty — so a condition that
  matched one would be matching on the absence of a title. It is a *skip with a
  stated reason* rather than a silent non-match, so the audit trail records
  that the engine saw the item and declined it, and the preview shows it as
  "(locked) — skipped" rather than making it vanish.
- **A rule never acts across a space boundary, and that is checked twice.** RLS
  decides which rules exist and which tasks can be gathered; the query filters
  on the rule's own `space_id`; the evaluator refuses a mismatched fact anyway;
  and every `update` names the space again. A rule firing in a space its owner
  cannot read is the same disclosure a bad policy would be, so it is worth
  saying four times.
- **A rule cannot be enabled until it has been dry-run.** The schema said so in
  a comment and left it to the application. This is the application. It is the
  whole safety story of the phase: nothing rewrites somebody's tasks unattended
  until they have read, in sentences, what it will do to each one.
- **Any structural edit switches a rule off and clears its preview.** Change a
  trigger, a condition or an action and the sentences somebody read no longer
  describe the rule. The cost is one extra click; the alternative is a rule
  running on the strength of a preview of a different rule.
- **An action that would change nothing produces no effect.** A scheduled rule
  sweeps the same rows every morning. If setting a priority that is already
  high counted, the audit trail would fill with changes that changed nothing
  and the run count would measure how long the rule had existed.
- **Conditions are ANDed, with no OR and no nesting.** Two rules are clearer
  than one rule with a branch in it, and a form that can express a boolean tree
  is a form nobody can read back. The condition fields are a closed list rather
  than "any column": an open list means a typo is a rule that silently never
  matches, and an unknown field is reported as a malformed rule instead.
- **`me` and `partner` are resolved against membership at run time, never
  stored as an id in the rule.** An id in a rule outlives the membership it
  referred to. `partner` in a space with nobody else in it does nothing at all,
  rather than quietly assigning to the owner — that would be the rule doing
  something it does not say.
- **Numeric conditions on an unset field are always false.** An undated task is
  not zero days overdue. This is the difference between "overdue by a week"
  matching nothing and matching the whole inbox. `days_overdue` reads `null`,
  not `0`, when there is no date.
- **Days are counted between calendar dates, never between instants.** Seven
  days overdue means seven calendar days on the 23-hour day in March and the
  25-hour one in October, and both are asserted. The arguments to
  `daysFromToday` are swapped rather than the result negated, because negating
  zero gives `-0`, which equals `0` everywhere except in a test assertion.
- **A rule fires after the write, never inside it.** Creating, changing or
  completing a task runs the enabled rules for that trigger once the row is
  committed, and a failure is recorded on the run and swallowed by the caller.
  Somebody typing a task must not lose it because an automation they wrote last
  month is malformed.
- **A dry run of an event-triggered rule sweeps its space.** A rule you can only
  preview by creating a task is a rule you cannot preview. A real run of the
  same rule is given the one task that changed.
- **A delivery row is written whatever the provider says.** It is the only way
  to tell "the rule never fired" from "it fired and the push went nowhere", and
  the rules page names the provider that answered — so a sent notification is
  never quietly the in-memory outbox pretending to be a phone.
- **The seed gives the rules something to chew on.** Both seeded rules live in
  Home and Home held nothing either matched: the "bin" tasks and the only
  locked task were all in Priya's own space, so a dry run previewed 31 tasks
  and no changes. Five fixed tasks and a locked one now live in Home, and one
  rule is seeded into Work so "the partner sees Home rules and not Work ones"
  has something on the Work side to fail on — the same reason there is one
  place in Work.
- **The seeded `rule_runs` rows are computed by the real evaluator**, importing
  `src/lib/rules.ts` into the seed rather than hand-writing a fixture. A
  fabricated audit row that disagreed with the engine would be worse than an
  empty table. Doing it exposed a real difference: the seed's connection has no
  date-to-string override, so a `date` arrives as a `Date` there and as a
  string in the app.
- **`rule_runs`, `notification_deliveries` and `note_versions` leave the pgTAP
  known-empty ledger.** plan(63) → plan(70): the partner sees the rule, the run
  and the delivery in the shared space and none of Alice's own; a free/busy
  participant sees none of the three, because a run records the titles of
  everything the rule considered and that is strictly more than "busy"; and the
  partner cannot create a rule inside a space they are not in.
- **`attachments`, `person_relationships` and `space_invites` stay unused, on
  purpose.** No phase owns them and none should claim them to tick a box.
  *attachments* needs file storage, which Orbit does not have and which is a
  decision about where bytes live, not a feature. *person_relationships* would
  encode "Sadia is Priya's sister" — the same call session 4 made about a
  person↔place table: the honest version is a fact somebody stated, and until a
  screen needs it, adding one is a schema change for a hypothetical.
  *space_invites* needs an auth system that can invite a stranger; auth here is
  a cookie naming a seeded profile, so an invite would be a row nothing could
  redeem. All three keep their policies and their RLS coverage; what they lack
  is rows, and the ledger says so rather than pretending otherwise.
- **The real `PushProvider` is Web Push, written and never run.** RFC 8030
  delivery, RFC 8292 VAPID signing over WebCrypto, RFC 8291 `aes128gcm` payload
  encryption in the RFC 8188 content coding. No retry ladder, by standing rule:
  a failed delivery is recorded as failed and the row is the record; a
  notification arriving three times because a retry could not tell "delivered"
  from "timed out" is worse than one that did not arrive. A 404 or 410 means
  the subscription is gone rather than that the message failed. A message whose
  link is not an in-app path is refused before a credential is even read — a
  push payload is the one place a link becomes something tapped from a lock
  screen.
- **There is no scheduler, and `schedule` rules are run by hand.** Orbit has no
  background worker and adding one is a deployment decision, which is out of
  scope by instruction. A scheduled rule stores and shows its cron, is
  evaluated by exactly the same code as every other rule, and runs when
  somebody presses "Run now, for real". Recorded as accepted rather than
  forgotten: the honest fix is a worker, and a worker needs somewhere to run.
- **Migration 0011 gives a derived travel leg an identity.** Session 4 recorded
  the missing unique constraint as a rough edge rather than guessing at it. The
  answer is a *partial* unique index on `(space_id, from_place_id, to_place_id,
  arrive_at)` where all three are present: a leg with no places is legitimately
  repeatable — "I drove somewhere for two hours" twice in a day is two journeys
  — and a derived one is not. Second schema extension in five sessions.
- **On/off and dry-run/applied chips are neutral chrome, not colour.** Category
  colour is the only strong colour by standing rule, so the state chips carry
  an icon, a label and a border instead. Amber and rose stay for warnings and
  errors, which is the precedent the travel page already set.
- **A preview puts what happened first.** The one task a rule changes must not
  be the thirty-first row. Everything with a change or a skip is listed above
  the fold; the tasks it looked at and left alone are behind a disclosure —
  still there, because "why did it not fire on that one" is the question the
  audit trail exists to answer, but not in front of the answer.
- **A smoke section that creates something deletes it.** The rules section
  builds a rule, drives it through the whole refuse-preview-enable-run-edit
  sequence, and deletes it, so the suite still passes twice in a row against
  the same database — verified twice this session. Its action is a
  notification rather than a task change, deliberately: it exercises the push
  path without rewriting a seeded task, so running it twice leaves the same
  tasks behind as running it once.

## Session 6 — 2026-07-29

- **Branch is `claude/orbit-phase-5-q2yu2b`.** The designated branch again
  differs from names elsewhere in the brief; the designated one wins, as it has
  every session so far.
- **Search is five queries, not one union.** Each kind has its own columns and
  its own idea of a subtitle, and a `union all` that flattened them would either
  lose the detail line or carry five nullable columns nobody reads. Merging
  them into one list happens in TypeScript, which is an *ordering* decision and
  not a visibility one — RLS already decided what came back.
- **No kind may crowd the others out.** `mergeResults` promotes the first
  result of every kind ahead of the second result of any kind. Ten matching
  tasks must not bury the one person whose name was actually typed. The
  alternative — a flat sort by `ts_rank` — makes search useless for the case it
  is most often used for.
- **The tsvector expression is copied character for character from the index
  definition.** Every one of the five search queries repeats the expression in
  the migration exactly, so the partial GIN index is usable. If one drifts,
  search still *works* and quietly stops using the index; nothing catches that,
  so the comment in `queries/search.ts` says to change both together.
- **There is no "exclude the locked ones" branch, because there is nothing to
  exclude.** A locked row is constrained to `title = ''` and `body_md = ''`, so
  it cannot match a query. `where not is_locked` is in each query to make the
  planner use the partial index, not as the security boundary. The search page
  states the number of locked items rather than saying nothing, because silence
  reads as "there is nothing there".
- **Highlighting is done in TypeScript, not with `ts_headline`.** `ts_headline`
  takes a second pass over the document per row and returns *markup in a
  string*, which is the one shape that cannot reach React without
  `dangerouslySetInnerHTML`. Segments can.
- **The highlighter stems, crudely, on purpose.** Postgres searches with the
  `english` dictionary, so "bins" finds a task whose title says "bin bags" — and
  a highlighter looking for the literal string would embolden nothing on the
  very row it just found, which reads as a broken search. `looseStem` handles
  the plural, which is the case that matters; being occasionally too generous
  about which word to embolden costs nothing, because it never decides what
  *matches*.
- **Capture parsing has a test that reads its own source.** The ADR says the
  local-only rule should be a lint rule; linting is out of scope by
  instruction. `tests/capture.test.ts` therefore reads
  `src/lib/capture/index.ts`, strips the comments, and fails if `fetch(`,
  `import(`, a node network module, or the string `AiProvider` appears in the
  code. A promise nothing checks is a comment.
- **"Next Friday" is the Friday of next week; a bare "Friday" is the Friday
  coming; "a week on Friday" is the Friday coming plus seven.** All three are
  defensible and they sometimes disagree; each is pinned by a test, and the
  resolved date is shown back on a chip before anything is created, which is the
  real safeguard. Typed on a Tuesday, "on Tuesday" means the Tuesday coming —
  somebody who meant today would have typed today.
- **A bare hour has a stated assumption, not a guess: 1–6 is the afternoon,
  7–11 the morning, 12 is midday.** That is what makes "half three" mean half
  past three, which is the only thing it can mean in English. "At 7" resolving
  to 07:00 will sometimes be wrong; the chip says "07:00 — morning assumed", so
  it is wrong *visibly*, which is the most that can be done.
- **A duration that runs past midnight is clamped to 23:59, not rolled over.**
  An event that silently moved to tomorrow is worse than one that ends at 23:59
  and is obviously wrong.
- **The capture form carries the text, not the parse.** The server re-parses
  before creating anything, so what is created is produced by the same function
  that produced the preview somebody read. A form carrying a resolved date
  would be a form somebody could edit into a date the preview never showed.
- **A locked item is refused by the AI gate *before* consent is looked at.**
  The order is asserted from three directions in `tests/ai.test.ts`. If consent
  were checked first, a locked item with the feature switched on would be
  refused for the right reason by accident; the sentence this design exists to
  make unsayable is "you consented, so we read it".
- **An `ai_runs` row is written for every attempt, refusals included.** Same
  call as `notification_deliveries` in Phase 4, same reason: it is the only way
  to tell "nothing was sent" from "something was sent and nobody looked". A
  refused row names the entity it declined to read and holds none of its
  content.
- **Emptiness is decided on the subject, not the assembled prompt.** Every
  prompt carries an instruction, so a prompt is never empty even when there is
  nothing to say. Sending an instruction with a blank note attached is a
  request that costs money and can only produce an invention.
- **Consent turned out to be personal at the policy level already.** The
  migration wrote `owner_id = auth.uid() and can_read_space(...)` on
  `ai_feature_consents`, not the usual space-wide grant. The first version of
  the page re-decided this in TypeScript with an `isMine` flag; that was
  deleted. Being in somebody's space does not show you what they agreed to
  send. The seed now gives Danny his own row so the fact is visible in the app,
  and pgTAP asserts the partner sees none of Alice's.
- **`buildPrompt` is the only place a prompt is assembled**, so the disclosure
  a person reads in settings can be checked against one function rather than
  against a habit. `weekly_review` says "no note bodies", and there is a test
  that its prompt contains none.
- **Locked notes are listed in the AI picker and refused, not hidden.** A note
  that vanishes from a picker looks like a note that does not exist. One that
  is listed, picked and refused is the promise being kept in front of you.
- **The real `AiProvider` is the Anthropic Messages API, written and never
  run.** Written against the published API rather than the SDK, for the same
  reason as every other real provider here: a dependency Orbit cannot execute
  is a dependency nobody can check. It does not decide whether it is allowed to
  run — consent is checked before anything reaches it — and it does not retry,
  because silently repeating a request that costs money and leaves the device is
  not an implementation detail. A `stop_reason: "refusal"` is a successful HTTP
  response with an empty body, so it is checked before the content is read.
- **`ai_runs` records no token counts.** Nothing in this build counts tokens,
  and a fabricated number in an audit trail is worse than a null.
- **Search, capture and AI are three separate pages, not one.** They share a
  phase and nothing else: search reads, capture writes, and AI is a setting
  with one demonstration attached. Putting them behind one nav item would make
  the AI consent screen something people arrive at by accident.

## Session 7 — 2026-07-29

- **Branch is `claude/orbit-phase-6-lqnx20`.** The designated branch again
  differs from names elsewhere in the brief; the designated one wins, as it has
  every session so far.
- **There is no silent last-write-wins, and that is a stated decision rather
  than an absent one.** Two people changing the same field to different values
  is a question only a person can answer, so the write is *held* as a named
  conflict with both values kept and neither thrown away. A silent
  last-write-wins would have been a decision too; this is the other one, made
  on purpose, because the loser of a silent race never finds out they lost.
- **A queued write carries fields, not rows.** It records only the fields
  somebody changed plus what each held when they changed it. That is what makes
  the common case — she retitled it, he set the due date — a merge rather than a
  fight. A whole-row write would make every concurrent edit a conflict and
  teach people to click through the dialog without reading it.
- **The client clock orders nothing.** Ordering across devices is decided by the
  server's `updated_at` alone; `queuedAt` orders a queue against itself and is
  otherwise only ever displayed. `clockSkew()` exists to *report* a disagreeing
  clock on screen, never to correct for one — and a test asserts that a device
  three hours out resolves identically to one in step.
- **A replay is a duplicate, not a conflict.** The same op arriving twice finds
  the server already holding the value it wanted, and that is `duplicate`: the
  row is already what the person asked for. This is what makes the queue safe to
  flush again after a failure **with no idempotency table anywhere** — which is
  why Phase 6 needed no migration.
- **Gone, locked and moved are decided before any field is compared.** All three
  make the field comparison meaningless, and a locked row's `title` is `''` by
  database constraint — comparing it would read as "they cleared the title",
  which is the most misleading possible answer. The order is asserted from
  several directions, the same treatment the AI gate's locked-first rule got.
- **A conflict is answered as an ordinary write with a fresh base.** "Keep
  theirs" is not "discard": the fields nobody disagreed about still land. And if
  the row moved *again* between reading the conflict and answering it, the
  answer conflicts in its turn rather than landing on top of a third edit
  nobody has seen.
- **One transaction per queued write, not one for the queue.** A conflict on the
  third of five must not roll back the two that landed. A queue is a list of
  independent edits somebody made, not a unit of work they intended to be
  atomic, and "none of your five applied because one clashed" is a lie about
  four of them. `pushCalendar` makes the same call for the same reason.
- **The row is read `for update` and written in the same transaction, as the
  user.** Without the lock two devices flushing at once could both read the same
  `updated_at`, both decide they had a clean apply, and the second would
  overwrite the first with neither ever seeing a conflict. A queued write is
  still a write: it goes through `asUser` like every other one, and there is no
  elevated path for catching up.
- **A queued write may only touch a closed list of columns, per kind.** Same
  reasoning as the rules engine's condition fields: an open list means a typo
  becomes a column nobody has, and the failure arrives at flush time on somebody
  else's device. It also means a queued write can never reach `space_id`,
  `owner_id` or `is_locked` — those are moves and grants, not edits, and each
  has its own confirmed path. The list is re-checked in the server action, not
  trusted from the client.
- **"Work offline" is a switch, not a network the browser noticed going away,
  and the page says so in those words.** Orbit cannot install a service worker
  here without a build pipeline it does not have, and pretending the browser
  detected a dropped connection would be claiming a capability that is not
  there. The queue lives in `localStorage` — kilobytes, and it survives a
  reload, which is the only durability an unsent edit needs.
- **The outbox is the one surface in Orbit rendered from `localStorage` rather
  than from a query.** That is not a visibility decision — nothing in it is a
  row somebody else could see — it is simply where the edits are while they are
  unsent. Every pending and conflict row still carries its space indicator, on
  the same terms as a task row: the moment somebody decides whether to overwrite
  somebody else's typing is exactly the moment they should see whose space it is.
- **Two edits to one row from one device are rebased, not collapsed.**
  Collapsing them would leave the survivor carrying the *first* edit's base, so
  a merge would be computed against a version the person never saw. `rebase()`
  folds what landed into the later write's base, so a device never conflicts
  with itself — which it demonstrably does without it, and there is a test that
  shows both.
- **A cursor is space-scoped like everything else.** "Alice's laptop last read
  the Home tasks four minutes ago" is a fact about Alice, and a cursor in a
  space you are not in is a fact about a space you cannot see. `sync_cursors`
  and `devices` are both asserted from the partner's side and from the free/busy
  side, and a cursor cannot be dragged forward from outside its space.
- **A cursor moves forward only.** `greatest(cursor_at, excluded)` on the
  upsert: two tabs flushing out of order would otherwise wind it back and
  re-deliver everything between, which for a device that is catching up is the
  difference between a quiet sync and a full re-download. Rewinding is a
  separate, deliberate button.
- **A locked row is *listed* in the change feed rather than hidden.** A device
  that never hears it changed can never fetch its ciphertext either. Its title
  is empty on the server by constraint, so there is nothing to show and nothing
  leaked by saying it moved.
- **Phase 6 needed no migration.** `sync_cursors`, `devices` and
  `calendar_sync_state` already had every column it wanted, and the
  no-idempotency-table decision above is what kept it that way. Fourth phase in
  a row that extended nothing; still two extensions in seven sessions.
- **`CalendarProvider` gains a write side rather than a seventh interface.**
  Pushing an event back is the same provider doing the other direction, not a
  new integration. The fake accepts a write honestly — a create gets an id it
  chose, an update keeps the id it was given, every write gets a new etag, and a
  calendar marked `writable: false` is refused — but it does **not** model a
  conditional write failing, and saying so out loud matters: the interesting
  half of the real implementation never runs here.
- **A push never sends a locked event, never invents an external id, and never
  clears `is_dirty` on a failure.** A row that says it was sent and was not is
  exactly the lie the flag exists to prevent. Google's implementation writes
  with `If-Match`, so a 412 is reported as a conflict and the local edit is kept
  — written, never run, like every other real provider.
- **The repeat builder is a small subset on purpose**: daily, weekly on chosen
  days, monthly, yearly, and an end date. Anything more expressive is a form
  nobody can read back — the same call the rules engine made about its condition
  fields. It refuses rather than guesses, and `UNTIL` is the end of the whole
  last day, because "until 31 August" said by a person includes the 31st.
- **Deleting an event now takes an orphaned recurrence rule with it.** The FK is
  `on delete set null`, so the rule survived as a row nothing pointed at —
  invisible, and still counted by the structural checks. Only if no other event
  uses it.
- **Each AI feature is run from where the thing it acts on lives.** A note on
  the AI page, a task from its own page, the week from Today — once per space,
  because consent is per space and a review reading three spaces on one consent
  would be the consent meaning more than it said. `readSubject` dispatches per
  feature and each reader is the only place that decides what that feature may
  see; the weekly review's promise of "no note bodies" is kept in the *query*,
  not in the prompt builder, because a prompt builder handed a body will
  eventually be asked to include it.
- **A week's run records `entity_kind = 'space'`.** A week is not a row, so the
  space it belongs to is the most specific thing the run log can honestly name.
  `ai_runs.entity_kind` is therefore no longer always `'note'`.

### Accepted rather than fixed (session 6's list, numbers 1–12)

- **1. Search still covers five kinds.** Adding a sixth means adding a partial
  GIN index, which is a migration for a feature nobody has asked for. Accepted.
- **3. The AI result is still carried on the URL**, and now on three pages
  rather than one. A refresh re-displays it and a long subject makes a long URL.
  Persisting it would mean storing model output, which is the one thing
  `ai_runs` deliberately does not do. Accepted, and the shared `AiResult`
  component means it is one rough edge rather than three.
- **4. `ai_runs` still records no token counts.** Nothing counts tokens and a
  fabricated number in an audit trail is worse than a null. Accepted.
- **5, 6, 7, 8, 9, 10.** Search's caps, the crude stemmer, capture's one-token
  space hint, a captured note's empty body, a captured event's missing location,
  and the parser's fixed matcher order — all still true, all cosmetic or
  bounded, and each already has the mitigation that makes it visible rather than
  silent. Accepted unchanged.
- **11. `pnpm smoke` leaves more behind than it did**, now including `ai_runs`
  rows for all three features and a `calendar_sync_state` push row. All
  harmless, all cleared by `pnpm seed`, and everything the suite *creates* it
  still deletes — verified twice in a row against the same database.
- **12. `runAiFeature` still reads every consent row on every run.** Three round
  trips at this data size; still not close to mattering. Accepted.

### After the phase landed

- **A rule's condition is edited where it sits.** Order is not evaluation order
  — every condition has to hold — but it *is* reading order, and a rule you have
  to re-read from the bottom every time you change a threshold is a rule nobody
  edits. The whole list is re-validated on save rather than only the changed
  one, so a rule stored before a shape changed cannot be half-saved, and an edit
  is structural like any other: it switches the rule off and clears its preview.
- **`updateAction` exists and nothing calls it yet.** The action form is one
  select and one free-text box that means a different thing per kind, and
  repeating that per row without rebuilding the form first would be four
  differently-labelled boxes stacked up. Recorded as a rough edge with the
  query already written, rather than half-built.

## Session 8 — 2026-07-29

- **Branch is `claude/orbit-rough-edges-qw12jt`.** The session designated it and
  the designated one wins, as it has in all eight sessions. No pull request.
- **This is a rough-edge session, not a phase.** Nothing new was started; the
  work is the list in STATUS.md, in its order.

### “This occurrence” versus “the whole series” — decided before it was built

The brief asked for this in writing first, so here it is, in the order the
options were weighed.

- **What a repeat is, in Orbit, is not up for revision.** One row plus an RRULE,
  expanded on read. Every option below was judged on whether it keeps that true.
- **Editing the *series* is the operation that was missing, and it is now built.**
  `rruleFromForm` could build a rule and nothing could read one back into the
  form, so a repeat could be created and then never touched: no changing Tuesday
  to Wednesday, no moving the end date, no removing the repeat without deleting
  the event. `repeatFormFromRrule` is the inverse, and the event page now adds,
  changes and removes a repeat. This is the honest bulk of edges 11 and 20.
- **A rule the builder cannot express is shown in words and left alone, never
  silently narrowed.** An imported `BYDAY=3TH`, a `COUNT`, a `BYMONTHDAY` — all
  parse and all expand correctly, and none can be *typed* (edge 10). Reading one
  into a builder that cannot express it would save it back as something else, so
  the form refuses to open on it and says why in a sentence. Losing "the third
  Thursday" by round-tripping it through a form that does not have the concept
  would be exactly the kind of quiet data loss the conflict model exists to
  prevent.
- **A single occurrence can now be *skipped*, and put back.** This is the first
  use of `recurrence_rules.exdates` from the UI — migration 0010 added the column
  in Phase 2 and only the importer ever wrote it. An occurrence is named by its
  own start instant on the URL (`?on=…`), which is what RFC 5545 calls a
  RECURRENCE-ID and what the calendar block's key has carried since Phase 2 for
  exactly this reason. Skipping is one array append; putting it back is one
  removal. Both are reversible, and being reversible is what makes them safe to
  offer without a confirmation.
- **Editing *one occurrence's details* — EXDATE plus a new one-off event — is
  deliberately NOT in this session.** It is the right shape and it is written
  down here so the next session does not have to re-derive it. What stopped it
  was not the write: it is that the new one-off event is a second row that has to
  carry the series' calendar, category, place, attendees and space, and then
  answer four questions this session cannot answer honestly in the context it has
  left — what happens to it when the series' rule changes underneath it, whether
  it appears in the series' own page at all, what a push to a provider does with
  it (`pushEvent` has no RECURRENCE-ID concept), and what deleting the series
  does to it. A half-built version of that is worse than none: it would put rows
  in the database that no later session could interpret. Skipping an occurrence
  has none of those questions, because it creates nothing.
- **So the shipped answer is: the series is edited, one occurrence is skipped or
  restored, and one occurrence's details are edited by skipping it and adding an
  ordinary event on the day — which the page says, in those words.** That is not
  the full RFC 5545 model and the page does not pretend it is.
