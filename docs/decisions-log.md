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

### What was built, and the decisions inside it

- **The action form had to be rebuilt before an action could be edited in place,
  and that was the whole rough edge.** `updateAction` and `editRuleActionAction`
  were written in session 7 and wired to nothing on purpose. The blocker was never
  the query: it was that the form was one select plus one free-text box captioned
  "a priority, a status, me / partner / nobody, a number of days, or a message" —
  six answers to a question the form already knew — and repeating that per row
  would have stacked four differently-meaning boxes with identical labels up the
  page. `ACTION_PARAMS` names, per kind, which key of the action object the box
  fills in and whether that key wants a choice, a number of days or a message.
- **`rawActionFrom` is now the only place the kind→parameter mapping lives.** It
  was written twice in `actions.ts`, once for adding and once for editing, and two
  copies of a mapping is one copy waiting to drift. It deliberately does not
  validate: `parseActions` is the single authority on whether an action is well
  formed, and a second opinion one layer up would eventually disagree with it.
- **An empty days box is refused by name rather than read as zero.** It was
  `Number(value || '0')`, so leaving the box alone meant "due today" — a real
  change to somebody's tasks, made by not typing. `NaN` reaches `parseActions` and
  comes back as "needs a whole number of days between 0 and 3650".
- **Order matters more for an action than for a condition.** Every condition has
  to hold, so their order is only reading order; actions are *applied* in order, so
  removing one and re-adding it at the end to change a value could change what the
  rule does to a task. That is why editing in place was worth building rather than
  "remove and add again" being good enough.
- **`travel_sessions.is_active` is a cache the app does not trust, and that is now
  written down rather than implied.** It was set once at creation and never
  updated. Every write now sets it from the dates — including the trip page's — and
  nothing reads it: `tripStanding()` derives the answer from the dates on every
  render. Nothing sweeps the column and Orbit has no scheduler by decision, so a
  stored "away" is stale the moment a trip ends, while a date range cannot go
  stale. Same call the calendar makes by expanding a recurrence rule rather than
  storing occurrences. Dropping the column would be a migration for nothing and
  the partial index on it is genuinely useful if a scheduler ever arrives.
- **A trip's space is deliberately not editable.** Moving one would have to move
  its journeys, and every journey's two places, and a place in another space is a
  place the other member cannot see — so it needs `app.space_move_preview()` and a
  confirmation on the same terms as a task. Nothing in this session makes a trip
  movable, so nothing in this session owes one.
- **A trip's endpoint pickers offer only places in the trip's own space.** The
  list is already filtered by policy; this narrows it further, which is a different
  question — a place you *can* see in another space would still be a place your
  partner cannot, on a trip they can.
- **The recurrence round-trip test found a real off-by-one in the shipped
  builder.** `UNTIL` was `'<endOn>T23:59:59.000Z'`, a UTC instant, which during BST
  is 00:59:59 the next London morning — so a series repeating at 00:30 told to stop
  on 31 August produced one on 1 September. It is now the end of the last *London*
  day. Written down because it is the second time a wall-clock/UTC confusion has
  hidden in this module, and both times a test that compared a value against
  itself in the other direction is what caught it.
- **The device label is a cookie, not `localStorage`.** `/sync` is a server
  component: a label only the client can read cannot pick the right device row, so
  the halves of the page could never be made to agree. A cookie has exactly the
  scope the queue has — one browser profile, surviving a reload — so the tie is
  structural rather than hopeful. It is unsigned like `orbit_user` and names a
  device, not a permission; every write still goes through `asUser`, so the worst a
  forged value does is claim a device row in a space its owner can already write to.
- **A device is identified by its label, and one browser is one row per space.**
  `devices` is keyed `(space_id, owner_id, label)`, which is what a space-scoped
  cursor requires (session 7's decision), so a label is the only thing that
  identifies a browser across its rows. The page says this out loud rather than
  leaving somebody to wonder why their laptop appears three times. Normalisation
  lives in exactly one function because the label is half of a unique key:
  " Laptop " and "Laptop" becoming two devices would show one browser twice on the
  very page this change exists to fix.
- **Renaming a browser updates its rows rather than replacing them**
  (`on conflict … do update`), so it does not forget how far it had caught up
  because somebody corrected a typo.
- **Coming back online sends the queue once, on the browser's own `online` event
  — a listener, never a retry.** A retry that cannot tell "never arrived" from
  "arrived and the answer was lost" would send the same edit twice, which is the
  same standing rule that keeps push from retrying. `online` fires when the browser
  *learns* it has a network, which is a fact rather than a timer, and one attempt
  per fact is honest. It does nothing while *Work offline* is ticked: that switch
  is a person saying "not yet", and a network reappearing does not overrule them.

### Accepted rather than fixed (session 7's list, numbers 1–13)

- **1 and 2 are fixed** — the queue is tied to a device row and the two halves of
  `/sync` now describe the same thing and say so; the `online` event flushes.
- **3. A dismissed conflict is still lost with no undo and no record.** Both
  "Discard" and dismissing a conflict say what they do and neither writes anything,
  but neither leaves a trace. Recording it properly means a table — an outbox
  history — which is a migration, and the honest place for that decision is a
  session that has the context to design it rather than one closing three other
  edges. Accepted, and it stays the top of the next-three list.
- **4. The queue still survives a user switch.** Fixing it needs the queue to
  record which profile made each write, which means a shape change to
  `PendingWrite` and a migration path for queues already in a browser. The dev
  switcher is impersonation by design (edge 22), so this is a rough edge of a rough
  edge. Accepted, and now slightly better: the device section names the browser, so
  a queue belonging to somebody else at least has something to disagree with.
- **5 is half fixed.** `SYNCABLE_FIELDS` is unchanged and still narrower than the
  forms, and only `/tasks/item/[id]` has an offline surface — a note body does not,
  and it is the field somebody is most likely to be typing when the connection
  goes. Widening the list is cheap; widening it without a smoke check per new field
  is not, and that was the part there was no context left for. Accepted for this
  session and named first in the next three.
- **6, 7, 8.** `changesSince`'s five queries and its 40-per-kind cap, `applyWrite`
  interpolating column names from a closed list, and the 200-event push window —
  all unchanged, all bounded, all already stated. Accepted.
- **9. A push still never deletes.** `pushEvent` has no delete verb, so an event
  deleted locally stays on the provider. Real, and it is the other one with teeth.
  Accepted this session, named in the next three.
- **10. The repeat builder still cannot express "the third Thursday" or a
  COUNT** — but it no longer *silently narrows* one, which was the dangerous half:
  `repeatFormFromRrule` returns null and the page shows the rule in words and
  offers only to remove it. Accepted in its remaining form.
- **11 and 12 are fixed** — a repeat can be added, changed and removed on the
  event page, and one occurrence skipped and put back.
- **12 (the weekly review's window) and 13 (what smoke leaves behind)** are
  unchanged and accepted; 13 grew slightly, since naming a browser now creates a
  device row in Priya's Work space that the seed did not have. Harmless, cleared by
  `pnpm seed`, and it is the same after every subsequent run — which is what
  "passes twice in a row" actually requires.

## Session 9 — 2026-07-31

- **Branch is `claude/orbit-real-auth-lccfs6`**, not `claude/orbit-real-auth`.
  The brief named the latter and the session designated the former; the
  designated one wins, as it has in all nine sessions. Same work, different name.
- **The session-5 `space_invites` decision is closed, not overturned.** It said:
  *"space_invites needs an auth system that can invite a stranger; auth here is a
  cookie naming a seeded profile, so an invite would be a row nothing could
  redeem."* That was true when it was written and it is the reason the table sat
  empty for four sessions. Phase 1 of this session supplies the missing half, so
  the condition the decision named has been met — the decision was not wrong and
  is not being reversed. `attachments` and `person_relationships` stay unused on
  exactly their original terms.

### Phase 1 — the second auth provider

- **The Supabase provider is written against the GoTrue REST API, not
  `@supabase/supabase-js`.** Same call as every other real provider here: a
  dependency Orbit cannot execute is a dependency nobody can check. Six
  endpoints — `/token`, `/signup`, `/otp`, `/verify`, `/user`, `/logout` — and
  no new package in `package.json`.
- **The session is verified by asking Supabase, never by checking a signature
  locally.** Verifying an HS256 or ES256 JWT needs the project's secret or its
  JWKS, and a wrong answer there is a silent authentication bypass rather than an
  error. `GET /auth/v1/user` asks the one party that cannot be wrong about it.
  The cost is a request per render; the alternative is a class of bug that cannot
  be tested from a container with no project in it.
- **`decodeJwtPayloadUnverified` is named that way on purpose.** It exists to
  answer one cheap question — has this token expired — so an expired token goes
  straight to the refresh path instead of costing a round trip to be told so.
  Nothing security-bearing is read from it, and a token it cannot parse counts as
  expired, so the safe path is the default rather than the exception.
- **Both session cookies are httpOnly.** An access token readable by script is a
  token one XSS away from being somebody else's session. `secure` follows
  `NODE_ENV`, so a local HTTP run still works and the Dockerfile sets production.
- **A refresh during render is best-effort, and that is written down rather than
  hidden.** A Server Component may not write cookies in Next 15, so
  `currentSupabaseUser()` refreshes, renders with the new session, and *tries* to
  persist inside a try/catch. The next server action or route handler persists
  it. A page that renders is worth more than a rotated cookie, and the refresh
  token still works until it does.
- **`requireUser()` redirects under a real provider and still throws under
  `dev`.** "Nobody is signed in" is an ordinary state a person can leave by
  signing in; "no profile exists" means the database was never seeded, and that
  message names the command that fixes it. One function, two honest answers.
- **The root layout asks `getCurrentUser()` rather than `requireUser()`.** It
  renders the sidebar when there is somebody and bare `children` when there is
  not, which is what makes `/auth/signin` a page like any other rather than a
  special case in the layout. Pages redirect themselves.
- **The user switcher is hidden by the sidebar and refused by the action.** The
  hidden control is a courtesy; `switchUser` returning without writing when
  `AUTH_PROVIDER` is not `dev` is the boundary. `listSelectableUsers()` returns
  an empty list for the same reason — a real provider has no "who could I
  become", and `app.identity_profiles()` is not granted to it.
- **The magic-link callback is a page with a client component, not a route
  handler.** Supabase's default email template lands on
  `…/auth/callback#access_token=…`, and a URL *fragment* is never sent to a
  server — no route handler can read one. The component reads it, submits it to
  a server action, and clears the fragment from the address bar in the same tick,
  because a screenshot of that URL is a shared session. A project whose template
  uses `{{ .TokenHash }}` lands with a query string instead, which the server
  reads and finishes with one button and no JavaScript at all. Both are handled;
  neither has been observed.
- **No OAuth.** Each provider is console configuration nobody in this repository
  can perform or verify, and a button that cannot work is worse than no button.
- **Sign-out is a POST from a page, not a link.** A GET that ends a session can
  be fired by an image tag on somebody else's site.
- **`safeNextPath` refuses anything that is not an in-app path.** A sign-in page
  is exactly where an open redirect lives, and the rule is the same one the push
  provider applies to a notification link.

### Phase 2 — the auth.users → profiles trigger

- **`auth.users` is shimmed locally, guarded, in the same migration.** Without a
  table to attach it to, the trigger could not be created here and none of it
  could be tested — the assertions would have been written against nothing. On
  Supabase the `create table if not exists` is a no-op. It is the only way this
  container can test the one step that fails silently in production.
- **Seeded data is development data, and a real deployment starts empty.** That
  is the answer to "how does a seeded id get claimed by a real account": it does
  not. The seeded ids are literals chosen so tests can name them, an auth user
  will never be issued one, and claiming a profile that owns spaces, tasks and a
  calendar because somebody signed up with a matching address is the worst
  possible reading of "the same email means the same person".
- **So the `profiles_email_key` collision raises, and names both sides.** Hitting
  the constraint gives GoTrue "Database error saving new user" and nothing else.
  The exception names the address, the existing profile and what to do instead,
  which is the difference between a five-minute problem and an afternoon.
- **The trigger is idempotent on id and only on id.** A profile that already
  exists with the same id is nothing to do — the state a restored dump leaves
  behind, and not an error.
- **The display-name order exists twice**, in `displayNameFrom()` and in the
  trigger, and there is a Vitest case pinning the order plus pgTAP assertions on
  both the metadata and the fallback. Two implementations of one rule is one
  waiting to drift; this is the same treatment the search tsvector expression got
  in session 6.

### Phase 3 — invites

- **No migration, as instructed, and the argument never came close.**
  `space_invites` had `token_hash`, `role`, `invited_email`, `expires_at`,
  `accepted_at`, `accepted_by` and RLS for admins in both directions since
  session 1. What was missing was never a column.
- **One SECURITY DEFINER function with three verbs, not two functions.** Preview
  has to defeat exactly the same admin-only policy the redeem does, so a separate
  preview function would be a second copy of the same checks — and the day they
  disagree is the day the screen says one thing and the write does another.
  `app.space_invite(token, action)` takes `preview`, `accept` or `decline` and
  shares every check by construction. It is `revoke execute … from public` and
  granted to `authenticated` alone, like the two in `0008_identity_lookup.sql`.
- **It lives in migration 0012 rather than a 0013.** The brief authorises exactly
  one migration; a function is DDL and has to be *somewhere*. One file, two
  clearly-headed sections, and the count of schema extensions is unchanged at
  three in nine sessions.
- **The function only ever writes membership for `auth.uid()`.** A token cannot
  be redeemed on somebody else's behalf, and only the role the invite already
  names is granted. Those two sentences are why widening a policy was never on
  the table: a policy cannot express "somebody who holds a secret", and the
  version that could would open every roster to every signed-in user.
- **"No such token" and "a token for a space you were not invited to" give the
  same answer.** Telling somebody their guess named a real space is telling them
  a space exists.
- **An invitation naming an address may only be redeemed by that address; one
  naming none is a bearer link.** Both are legitimate and the screen says which
  it is making. The bearer case is why an invitation expires at all.
- **The invitation is claimed before the membership is written.** `update …
  where accepted_at is null` and then check the row count, so two people opening
  the same bearer link at the same moment cannot both join. Rejoining a space you
  had left is an update of the existing row, named by constraint rather than by
  columns because `space_id` is also one of the function's OUT parameters.
- **`decline` deliberately writes nothing, and the screen says so.** There is no
  "declined" column and inventing one would be the migration this brief says not
  to write. A declined invitation is one that has not been accepted; the link
  stays live until it expires or is revoked, which is stated rather than left to
  be discovered.
- **Revoking is expiring.** `space_invites` has no `revoked_at`, so revoke sets
  `expires_at = now()`: the token stops working immediately and the row stays as
  the record of what was offered and to whom. Deleting it would erase that. An
  accepted invitation cannot be revoked at all — the person is in the space, and
  removing them is the other operation on the screen, which is why the row shows
  no Revoke button rather than a button that fails.
- **Removing a member is `status = 'left'`, never a delete.** Every policy checks
  `status = 'active'`, so it takes effect immediately, and the row remains as the
  record that they were here. Same call as archiving a person in session 2.
- **A space's owner cannot be removed from it**, in the query's `where` clause
  and not only in the markup. A space with no owner is a space nobody can manage.
- **`owner` is not an offerable invite role.** The other four of
  `app.member_role` are. Ownership is `spaces.owner_id`, a different fact from
  membership, and handing a household over by emailing somebody a link is not an
  operation this screen has. `NON_OFFERABLE_ROLES` states it as a value rather
  than by omission, and a test asserts the two lists together name the whole enum.
- **The raw token is shown once, on the URL.** It cannot be shown twice because
  there is nowhere to read it from, and the panel says so in those words. Putting
  it on the URL means it lands in that browser's history — the same accepted
  rough edge as the AI result, recorded here rather than discovered later. The
  alternative, a one-shot cookie, cannot be cleared during a render.
- **The seed writes one pending invitation whose `token_hash` is random bytes
  rather than the hash of a token.** There is no raw token for that row and there
  never was, so nothing can redeem it and `pnpm smoke` cannot consume it — which
  is what keeps the suite passing twice in a row. It demonstrates the pending
  state and takes `space_invites` out of the pgTAP known-empty ledger, leaving
  two tables in it.

### Phase 4, and the shape of the test suite

- **`pnpm smoke` starts a second server on port 3101 with
  `AUTH_PROVIDER=supabase` and no credentials.** It is the only way to assert
  from here that the switcher is unreachable, that the dev cookie stops being a
  session, and that a missing credential is a sentence rather than a 500 — all of
  which are claims about a configuration the main server is not in. It signs
  nobody in, because there is nobody to sign in as.
- **`DATABASE_PREPARE=false` is an environment variable, not a line to edit
  before deploying.** The transaction pooler on 6543 breaks prepared statements;
  "remember to change this line" is an instruction somebody eventually does not
  follow. The default is unchanged.
- **`output: 'standalone'` does not take `pnpm start` away**, which matters
  because 382 smoke checks drive it. It adds a directory the Dockerfile copies.
- **Nothing was deployed, no hosting account was created and nothing was bought.**
  `docs/deploy.md` is commands somebody can follow and says at the top that none
  of them has been run here.

---

## Session 10 — the design and functionality review, and the phone

The brief was to suggest improvements to looks, design and functionality;
compare Orbit to similar apps; and build. `docs/design-review.md` is the review
and holds the evidence for every claim; these are the decisions taken while
acting on it.

### About the review itself

- **Every finding was checked against the running app or counted in `src`,
  and three of the first draft's claims were wrong.** The calendar *does* have a
  now-line (an ad-hoc `border-t` in `--danger`, not the `.now-line` the
  stylesheet defines); `scrollToMinute` *already existed* and was already tested;
  and the US-format date inputs are the browser's locale doing its job, not a bug
  to fix by replacing a native control. The review was corrected in place rather
  than quietly tidied, because a later session reading it needs to know which
  parts were checked and which were assumed.
- **The comparison table is not flattering by construction.** Orbit is ahead of
  Cozi, Todoist, Things and Apple Reminders on the hard things — on-device
  parsing, free/busy sharing, conflicts that are named rather than resolved,
  E2E-modelled items — and was behind them all on being reachable from a phone.
  The expensive half was already done.

### The phone

- **The rail is hidden below `md` rather than made narrow.** 240px of a 390px
  screen is 62%, and there is no width at which a rail and a dense list both fit.
  A bottom bar plus a drawer is two shapes of one component (`SidebarNav`), not
  two components — the same argument as `DayColumns` rendering both the day and
  the week.
- **The bar is along the bottom because that is where a thumb is**, and it is
  `env(safe-area-inset-bottom)` above the home indicator. `--tabbar` is one token
  carrying both the bar's height and the padding that clears it, because those
  were about to be two numbers in two files.
- **`maximum-scale` is deliberately not set.** Pinching to zoom is somebody's
  accessibility, not a layout bug to suppress.
- **The manifest declares no icons.** An icon pointing at a file that does not
  exist is a broken image on somebody's home screen, and there is no artwork in
  this repository to point at. The platform's letter is better than a broken
  image.
- **Making the app installable made the missing service worker a real gap.**
  It was a nicety while Orbit was a tab; an installed app that shows a network
  error when the connection drops is worse than a bookmark. Recorded as edge 33
  and promoted to the third of the next three things.

### Today, and the stylesheet that had been waiting for it

- **The summary strip counts the arrays it is about to render.** The handoff
  argued for one `summary(range)` query so the number and the list cannot
  disagree; deriving both from the same arrays gets the same guarantee without a
  new query module, and the guarantee was the point.
- **Building it found the bug it was meant to prevent.** The `today` smart list
  is "due today **or** overdue", so counting all of it as due and the remainder as
  overdue reported 35 due and 0 overdue on a day when 34 of the 35 were weeks
  past their date. Split into two disjoint lists.
- **The range lives in the URL, and the switch is links rather than buttons**,
  so it survives a reload, can be sent to somebody, and the back button means
  what it says.
- **Six dead utilities were spent rather than deleted.** `.seg`, `.stat`,
  `.stat-num`, `.block-time`, `.block-now` and `.now-line` were adopted in
  `74789ce` and never used. Deleting them would have been the smaller change and
  the wrong one: they were designed and contrast-checked for a page worth
  building.
- **`.now-line::before` moved to the line's own left edge.** As the default, the
  gutter offset put the dot in the previous day's column; the agenda keeps the
  old position via `.now-line-gutter`, which is the one place the line starts
  after a gutter.

### Assignment

- **Somebody else's name is louder than your own.** In your own lists nearly
  every row is yours, so "You" on all of them is noise and the two rows that are
  *not* yours are the signal. `/tasks/mine` renders no assignee at all.
- **It is still not settable from the compose bar, on purpose.** That bar
  already carries a title, a date, a category and one chip per writable space,
  and on a phone that was three rows before anything was added. Recorded as edge
  32 with the two better homes named: a picker on the row, or a `to:` phrase in
  capture.
- **The compose bar collapses on a phone and opens on focus, and this does not
  weaken the space safeguard.** The chips are visible before anything can be
  typed, because focusing the title is what opens them. What is hidden is a row
  not yet reached, not a decision.

### Shortcuts

- **The three rules live in a pure module so they can be tested without a DOM.**
  The one that matters is "never take a key from somebody who is typing": `c` is
  Capture, and typing "citrus" into a task title must not navigate away. It fails
  silently and confusingly when it is wrong, which is exactly the kind of rule
  this codebase puts in `src/lib/` with tests.
- **No shortcut is the only way to do anything**, and `?` lists them all.
  Anything carrying ⌘, Ctrl or Alt is given back to the browser.
- **`g` is a prefix that forgets itself after 1.2 seconds**, so a stray `g` does
  not silently change what the next keystroke does minutes later.

### The light/dark override was not built, and that is the decision

- **A manual theme toggle needs a decision about `globals.css` that should be
  made deliberately.** `tests/contrast.test.ts` finds the dark palette by
  brace-matching `@media (prefers-color-scheme: dark)` and treats every `oklch()`
  outside it as a light value, so a `:root[data-theme='dark']` block would either
  duplicate sixty declarations that then drift, or be read by the test as a
  redefinition of the light theme. The two real options — `light-dark()`, or
  duplicate-and-pin-with-a-test — are set out in the review with what each costs.
  Guessing between them halfway through a session is how a carefully looked-after
  file gets damaged.

### Tests

- **Ten smoke checks now run at 390×844, and every one fails on the previous
  commit.** The bug that started this session — task titles pushed off the screen
  — was invisible to a suite that only ever opened a desktop-sized window, so the
  suite now measures a title's bounding box against the viewport.
- **Three existing smoke checks were adjusted and one was already broken.**
  Reading a calendar block's time moved to its accessible name, because a compact
  block no longer repeats the time it is positioned against; two sidebar checks
  say `nav:visible`, because the navigation is rendered twice and CSS shows one.
  The fourth was pre-existing: a check looked for an event the fixture places at
  `today + 2` in the week containing *today*, so it passed Monday to Friday and
  failed at the weekend. This session ran on a Saturday.

### A correction made before the session ended

- **Finding D said assignment was "invisible"; capture had been setting it since
  Phase 5.** `@person` produces an `assigneeHint`, `resolveAssignee` matches it
  against active members of the target space by display name or first name, and
  `createFromCapture` writes it — verified by creating one and reading the row
  back out of Postgres. What was genuinely missing was the row rendering it, a
  list filtering by it, and **any end-to-end check at all**: a working feature
  that nothing was watching, which is how it came to look absent from the
  outside. Four smoke checks now drive it, and the wrong claim was corrected in
  STATUS, in the review and here rather than quietly dropped.

## Session 12 — settings, the offline shell, and the edges with teeth

Brief C. Branch `claude/brief-c-settings-offline-shell-0l1q6x`. No migration was
written and none was needed; the argument for the one that was expected is
below.

### Phase 0 — the red smoke check was the check, not the app

- **The failing check was a false positive, and it was verified before it was
  changed.** "A busy block carries no title, no category and no link" scanned
  the whole of `main` for `['stand-up', 'Funding', 'Invoice', 'Workshop']`,
  described in a comment as "the seeded Work titles". Three of the four are not
  seeded titles at all, and `'Stand-up'` is in the seed's generic
  `EVENT_TITLES` filler, which is drawn from for **every** space. The match was
  `aria-label="Stand-up, all day, Danny"` — the partner's own event in his own
  space, which he is entitled to see. Every busy block on the page carried
  `Work | Busy` and a `title` of `Work — busy, HH:MM`, exactly as designed. The
  check went red whenever the shuffle put a filler "Stand-up" in his week,
  which is why it passed in session 10 and failed in session 11.
- **It now asserts the property its name claims**, on the busy blocks
  themselves: no link, no category colour, text ending in `Busy`, and a `title`
  of the documented shape. The leak scan is kept, because that is the security
  property, but its forbidden set is *derived* — the Work titles Priya can see
  that week, minus any title the partner legitimately sees in a space he can
  read. A word on the page for an honest reason cannot be evidence of a leak,
  and the seed reuses one title list across every space, so the subtraction is
  what makes the assertion mean anything.

### The theme question, decided

- **`light-dark()`, as `docs/design-review.md` recommended.** All 42 colour
  tokens now hold both values in one declaration and both
  `@media (prefers-color-scheme: dark)` blocks are gone. The manual override is
  two `color-scheme` lines and there is no second copy of the palette to drift.
  `only light` / `only dark` rather than bare keywords, so a pinned theme also
  pins form controls and scrollbars — a person who chose light should not get
  dark widgets on a light page.
- **The conversion was generated and then verified, not typed.** A script read
  the light and dark maps out of the old file, emitted the merged declarations,
  and a second script read them back out of the new file and compared: 42 pairs,
  identical, no token left as a single value. Sixty hand-retyped `oklch()`
  triples is exactly the kind of edit that loses a digit silently.
- **The dark-value comments were carried across, not dropped.** They are a
  comment block above the merged tokens: dark surfaces are not an inversion,
  dark chips hold their chroma so a space keeps its identity at sunset, and
  water goes below `--bg` while land goes above it.
- **`tests/contrast.test.ts` still computes real WCAG ratios for both themes**,
  and the brace-matching is gone as predicted. Three new guards keep it honest,
  because the failure mode inverted: a parse that returned the same half twice
  would compute every ratio and pass every assertion while checking one theme
  twice. So the two halves must differ, no token may escape the pair into a
  single value, and no media query may redeclare a colour. **Mutation-tested**:
  changing the parse to return the light half for both turns it red.

### Preferences are cookies, and what that costs

- **Theme, week start and default compose space live in cookies, not on
  `profiles`.** The theme *must* be known before first paint, which rules out
  anything fetched after render — a `useEffect` that swaps the theme is the
  flash the requirement forbids. Every page is already `force-dynamic` and
  already reads cookies, so the server applies the choice to `<html
  data-theme>` on the way out. No migration, which was the constraint.
- **The cost, recorded rather than hidden:** a preference belongs to a browser,
  not to an account. A second device starts at the defaults. For a theme that is
  arguably correct — a phone at night and a desktop at noon want different
  answers — and for the default space it is a mild annoyance. Moving them onto
  `profiles` is a migration *and* a decision about whether they are per-account
  or per-device, which is why it was not done in passing.
- **"System" is the absence of the attribute, not a third value.** Somebody who
  has never chosen and somebody who chose "follow my OS" want identical
  behaviour, so they are one state rather than two that have to be kept
  behaving alike. Choosing system deletes the cookie.
- **The default space is re-validated against writable spaces on every read.**
  The cookie is a hint about which of your own spaces to prefer and never an
  assertion that you have one; a space you later leave falls back rather than
  failing.
- **`generateViewport` replaced the constant `viewport`.** Once a theme can be
  pinned, the media-query `themeColor` pair answers the wrong authority — a
  person who pinned dark on a phone in light mode would get a pale status bar
  above a dark app.

### Week start is a layout preference and must never be more than that

- **`WKST` belongs to the rule, not to the viewer.** `src/lib/recurrence.ts`
  has its own `weekStart` driven by the rule text, and it decides which
  occurrences a weekly rule with an interval actually has. If the cookie ever
  reached that code, changing a display setting would silently move somebody's
  repeating events — a data change wearing the clothes of a display change. The
  two are kept apart by construction (recurrence never calls `startOfWeekISO`),
  and `tests/prefs.test.ts` asserts the *consequence*: the same rule expands
  identically under both preferences, while `WKST` in the rule text genuinely
  changes it.
- **`viewRange` takes the preference too.** It has to: a range cut on Monday
  behind a grid drawn from Sunday would query six days the view never shows and
  miss the one it does, leaving the first column permanently empty.

### Edge 4 — revoking a device

- **`devices.revoked_at` has existed since migration 0001 and nothing had ever
  written it.** Something does now, and what makes it more than a label is that
  `advanceCursor` refuses to move a revoked device's cursor. Written as a
  guarded `insert … select … where exists` so the `on conflict do update` is
  skipped as well: with zero rows produced there is no conflict to resolve, so
  an existing cursor stays exactly where it was.
- **Revoking is scoped to the caller's own rows in the statement**, on top of
  the policy. `listDevices` deliberately shows a partner's device in a shared
  space so that "that laptop is three days behind" is answerable — but seeing
  somebody's device is not ending it.
- **It is not a security boundary and is not described as one.** A revoked
  device can be restored by its owner, and the boundary remains `asUser` and the
  policies. The smoke run asserts the consequence with a control beside it: an
  active device advances its cursor and a revoked one does not.

### Edge 33 — the offline shell, and the rule it is built on

- **No authenticated page HTML is ever cached, and everything else follows from
  that.** Every page is `force-dynamic` and RLS-scoped, so a cached
  `/tasks/home` served to whoever opens the phone next is a data leak, not a
  nicety — and unlike a stale asset it cannot be noticed by looking at it. A
  navigation is therefore network-only with `/offline` as its fallback. What is
  cached is `/offline`, the manifest, and `/_next/static/`, which is
  content-hashed and contains nobody's data.
- **`/offline` is a route handler returning standalone HTML, not a page
  component.** That is the security decision, not a styling shortcut: a page
  component is wrapped in the root layout, and the sidebar's space names and
  task counts would be baked into a cache entry held indefinitely. Nothing on
  the route reads a cookie, a user or the database, so it renders identically
  for everybody — which is the property that makes it safe to keep.
- **The four colours it needs are a second copy of four tokens**, because
  standalone HTML cannot link to a stylesheet whose hashed name is not knowable
  when the route is written. That is exactly the drift the `light-dark()` merge
  removed, so each one is pinned to `globals.css` by a test.
- **The policy is data, the mechanism is code.** `src/lib/offline.ts` holds what
  may be cached and is tested by Vitest; `src/app/sw.js/route.ts` injects it as
  JSON. A hand-written `public/sw.js` would be a second copy of the rules, and
  for a service worker that means the tested rules and the shipped rules
  disagreeing about whether somebody's page HTML is kept. `swDecision` is total
  and defaults to `network-only`, so a request shape nobody considered behaves
  as if no worker were installed.
- **There is a way out.** `skipWaiting` and `clients.claim` on install, a
  version bump that deletes every other cache on activate, and an unregister
  control on `/settings` that empties the caches too. A service worker with no
  escape hatch is the classic way to ship an app that cannot be fixed.

### A hole one layer below the service worker, found by the smoke run

- **The browser's own HTTP cache re-served an authenticated page offline.** With
  the network disabled, `/tasks/all` came back complete — sidebar, task counts,
  every row. The service worker had cached nothing; it called `fetch()`, and
  `fetch()` was answered from disk. The whole offline design rests on a
  sentence — a page rendered for one person must not be kept — and no header had
  ever said it out loud.
- **`src/middleware.ts` says it.** `no-store` on pages, with
  `_next/static`, `_next/image`, `sw.js`, `offline` and the manifest excluded
  and a reason recorded for each. Both halves are asserted in the smoke run: a
  page carries `no-store`, and a content-hashed asset keeps its immutable year.
- This was not on any edge list. It was found because the offline check was
  written to drive the real browser with the network really disabled, rather
  than to assert that a file exists.

### Edge 7 — and why it needed no migration after all

- **It had more teeth than the entry said.** Dismissing lost the edit, but for
  three of the four conflict kinds the edit was *already* gone: `settle` takes a
  conflicted write out of the queue, and `clashes[]` carries the typed values
  only for `field_conflict`. A `deleted_elsewhere`, `locked_elsewhere` or
  `moved_space` conflict discarded somebody's typing the moment it was raised,
  before they had touched anything. So the fix is in two halves — `settle` now
  holds the write behind every conflict, and dismissing records it.
- **No migration, and the argument was not close.** The expected fix was a
  server-side table of discarded edits. Two things rule it out. First, **an
  unsent edit has never been anywhere but this browser**: `localStorage` is
  where it genuinely lives, and moving the record to the server would be moving
  it somewhere the edit itself never was. Second, and decisively, **one of the
  four conflict kinds is `locked_elsewhere`** — the row became end-to-end
  encrypted while the edit was queued — so the naive table would store the
  plaintext of an edit to a locked row, which decision 1 forbids outright.
  Building the table *and* excluding the one kind that most needs the record
  would be a migration that bought the least useful three quarters.
- **The floor was a record; this is the record plus the undo.** The whole write
  is kept, `/sync` shows what it would have written, and it can be put back —
  at the end of the queue with a new sequence number, keeping its `base`, so the
  next send judges it against the row as it is now and either merges it, applies
  it, or asks the same question with today's values.
- **The log is capped at 50, oldest dropped.** `localStorage` is shared with the
  queue, and an unbounded discard log would eventually be the reason an edit
  could not be saved — this feature causing the loss it exists to prevent.
- **An older queue is defaulted, not version-bumped.** `held` and `discarded`
  are absent from `orbit.outbox.v1` as written before this session. Forcing a
  queue to be discarded in order to add a feature about not discarding things
  would be a poor joke.

### Edge 32 — the picker is on the row

- **Not on the compose bar**, which is recorded twice and stands. The bar
  already carries a title, a date, a category and one chip per writable space,
  and on a phone that was three rows before anything was added. A task's owner
  is also the thing most likely to change *after* it exists.
- **Its own action rather than a trip through `updateTask`.** A row form routed
  through `updateTask` would have to post the title, the body and the status
  back with it, and would overwrite all three from whatever the page last
  rendered.
- **Only `owner`, `admin` and `member` are offered**, which is exactly the set
  the write will accept. A `free_busy` participant cannot hold a task in a space
  whose contents they cannot see, so offering them would offer something the
  write would silently turn into NULL. A locked row gets no control at all, for
  the same reason.

### Tests

- **A hydration race was fixed rather than retried away.** "? opens the list of
  them" attaches to a Client Component's listener and asserted immediately after
  a navigation, while its two neighbours retried via `waitForURL`. It went red
  under a full run and passed every time in isolation. It now waits for the page
  to settle, which is what the check meant.
- **The two dark-mode checks only asserted a colour was non-empty**, so a
  broken `light-dark()` merge would have passed both. They now assert the two
  schemes are genuinely different colours.
- **The device-revoke check carries a control.** Without one, a cursor that
  never moved would pass "a revoked device does not advance its cursor" for
  free, so the active case is asserted immediately before it.
- **Edge 3 held.** The revoke section marks a device caught up, which empties
  the "changed since" feed a later check reads, so it rewinds the cursor before
  it closes. `pnpm smoke` passes twice in a row without a reseed.

## Session 12, second pass — the four things worth doing before a deployment

The Supabase migrations had been applied by hand. These are the items that were
worth closing before anything is public.

### Edge 22 is enforced now, not warned about

- **`AUTH_PROVIDER=dev` on a production build is refused.** `switchUser` is
  impersonation by design — no password, and a switcher in the sidebar — and
  the only thing standing between that and a public URL was a sentence in
  `docs/deploy.md` saying "do not". **`dev` is also the default**, so the
  dangerous case is not a typo: it is forgetting to set a variable at all.
- **The escape hatch is where the whole design is.** `NODE_ENV=production`
  alone would break the guarantee this repository is built on — `pnpm start`
  *is* a production build and `pnpm smoke` drives it, both with zero
  credentials. So `pnpm start` sets `ORBIT_ALLOW_DEV_AUTH=1`, and **the
  Dockerfile does not** — it runs `node server.js` rather than `pnpm start`, so
  nothing in `package.json` can leak into an image. A deployment has to set it
  deliberately, in the same place it sets its database URL, having read the
  name of the variable.
- **Thrown from `authProvider()`, not only checked in the layout.** A server
  action, a route handler and `requireUser()` all arrive through that function;
  a guard that only guards the page somebody looks at is not a guard. The layout
  checks it separately so the refusal gets its own page — the existing catch
  would have reported it as *"Orbit can't reach its database"*, which is an
  actively misleading sentence for a build refusing to serve impersonation to
  the internet.
- **Only the exact string `'1'` disarms it.** `'true'`, `'yes'` and `' 1'` all
  leave the guard on. A safety switch that can be turned off by a plausible
  near-miss is one that will be.
- Verified against a real production server rather than only in unit tests:
  with no hatch set, every page returns the refusal; under `pnpm start`, Today
  renders exactly as before.

### `/health`, and why it touches the database

- **The single most likely production failure is a `DATABASE_URL` that does not
  work**, and the default health check on both Fly and Railway is "did the port
  open" — which is true of a container that cannot serve one page. So `/health`
  runs `select 1`.
- **It says `ok` or `unavailable` and nothing else.** It is unauthenticated by
  necessity, and the text of a failed connection error is exactly the sort of
  thing that names an internal host. The detail goes to the container's log,
  which is where somebody debugging already is.

### `fly.toml` is committed rather than generated

- **Two `fly launch` defaults are wrong here and both fail quietly.**
  `auto_stop_machines` makes a machine that stops between requests — a
  serverless function wearing a container's clothes, throwing away the Postgres
  pool every time — and `internal_port` defaults to 8080 while Next listens on
  3000, which looks like a deploy that succeeded and a site that does not
  answer. Committing the file with both fixed, and the reasons written beside
  them, is cheaper than a paragraph telling somebody to remember.
- `AUTH_PROVIDER` is deliberately **not** in `[env]`. It belongs with the
  secrets, and leaving it out means the guard above is what greets a deployment
  that forgot it.

### Edge 35 — a recurring event is busy time too

- **The cause, exactly.** `app.free_busy_blocks()` filtered on the stored row:
  `e.starts_at < p_to and e.ends_at > p_from`. A repeating event is stored once,
  at its DTSTART, and expanded on read — so a weekly stand-up that began in
  March has `starts_at` in March, does not overlap "this week", and was dropped.
  A `free_busy` grantee saw **none** of somebody's recurring commitments.
  Observed: Priya had nine Work events in a week, five of them stand-up
  occurrences; Danny saw four busy blocks and none of the five.
- **The direction was the safe one and that is what hid it.** It showed less,
  never more, so nothing looked wrong — while the availability view answered
  "free" about the busiest hour of the week, which is the one question it exists
  to answer. Decision 3 settled free/busy by name, so this was a correctness bug
  in a settled feature.
- **The fixture had rules and no event pointing at one.** Nothing in pgTAP
  exercised the join, which is how this survived from Phase 2. There is now a
  repeating event in the shared space that only the new function can answer for.
- **Expansion stays in one place, and that is the departure worth arguing.**
  The obvious fix is to expand in SQL so the function keeps returning nothing
  but instants. Rejected: RFC 5545 expansion is COUNT, UNTIL, INTERVAL, BYDAY
  with an nth, BYMONTHDAY including -1, EXDATE, and wall-clock time across a DST
  boundary. `src/lib/recurrence.ts` implements all of it and is heavily tested;
  a second implementation in PL/pgSQL would be a second answer to *which
  occurrences exist*, and the two would disagree visibly — as busy blocks that
  do not match the owner's own calendar.
- **So `app.free_busy_recurring()` returns the rule and the app expands it.**
  This does let a grantee's session obtain the rule text, where before it could
  not, and that is a real departure from *"the shape of somebody's week is
  content"* recorded in session 8. Taken deliberately, because: what is
  **rendered** is unchanged; `BusyBlock` has no field a rule could live in, so
  "anonymous" remains a property of the type rather than of somebody
  remembering; the rule is discarded in the query layer, which already holds
  every event title for the owner; and the alternative is two implementations of
  recurrence. Still SECURITY DEFINER, still re-checking the grant itself, and
  `revoke execute … from public` as `0008_identity_lookup.sql` does.
- **`free_busy_blocks` is one-offs only now** (`recurrence_rule_id is null`), so
  no row is in both functions and an anchor occurrence cannot be drawn twice.
- **The smoke check asserts the two sides agree** — one busy block for every
  event the owner has in that space that week — rather than counting blocks.
  Counting alone passed throughout the bug, because four of the nine were
  one-offs. plan(106) → plan(112).

### Also

- **`docs/deploy.md` §4 was stale.** It still said there was no service worker
  and described offline as a switch somebody flicks. It now describes the shell,
  its secure-origin requirement, the dev-auth guard, and edge 35 while it stood.

## Session 12, third pass — Orbit's tables move to an `orbit` schema

### The decision, and who made it

- **Orbit's tables live in `orbit`, not `public`.** Asked for by the product
  owner, because Orbit shares a Postgres instance with another application whose
  tables are in `public`. Two applications in one schema is a namespace
  collision waiting to happen: `profiles` alone exists in both, and Orbit's
  `0001` would have failed on it.
- **The helper schema stays `app`.** It was never the thing in question — the
  earlier exchange about "orbit instead of app" was about the *table* schema.
  `app` holds the RLS generator, the membership predicates and the identity
  seam, and renaming it would buy nothing.

### How it was done, and why not with a `sed`

- **899 references**: 357 in `src/`, 346 in the migrations, 111 in the pgTAP
  suite, 85 in the seed. Every one is schema-qualified — `from public.tasks`,
  never a bare `tasks` — which is also why `search_path` could not have been
  used as a shortcut. Postgres resolves a qualified name literally.
- **Three things that say `public` and are not the schema**, each checked by
  hand before anything was replaced:
  - `revoke execute on function … from public` — the PUBLIC *role*, in six
    places. Renaming it would have made every SECURITY DEFINER function callable
    by anybody who could find its name.
  - `public/` — the Next.js directory, in a comment.
  - `public_key`, `publicKey` — column and variable names.
  The transformation therefore matched `public.` only when followed by an
  identifier, a `%I` placeholder or a `${` template expression, which excludes
  all three.
- **Comments were renamed too.** They describe the same objects; a comment
  saying `public.profiles` about a table now called `orbit.profiles` is simply
  wrong.
- **`set search_path = public, pg_temp` became `orbit, public, pg_temp`.**
  `public` stays in the list so PostGIS and pgcrypto still resolve.
- **The catalogue sweeps moved with it.** The pgTAP known-empty ledger, the
  seed's truncate and the RLS check all enumerate "every application table" by
  querying `pg_tables where schemaname = …`. Left at `public` they would have
  found nothing and passed vacuously — the worst outcome available, because a
  sweep that checks zero tables reports success.
- **`app.apply_standard_rls` generates policy DDL with `format()`**, and its
  `public.%I` strings had to move or every policy would have been attached to a
  table in the wrong schema. This is the one piece that would have failed
  silently rather than loudly.

### What it was verified against

Not a diff read-through: the local database was rebuilt from the repository's
own migrations and all five commands re-run against the new shape.

- `./scripts/db-reset.sh` — **41 tables, 41/41 with RLS enabled**, and one table
  left in `public` (PostGIS's `spatial_ref_sys`, which is not Orbit's).
- pgTAP **112/112**, build clean, typecheck clean, **816** Vitest tests,
  **455/455** smoke against the running app, which then served real rows.

`scripts/db-reset.sh` grants `usage on schema orbit` and seeds through
`all tables in schema orbit`, so the local database now has the same shape as
the deployed one — which is the point. A test suite that ran against `public`
while production ran against `orbit` would have proved nothing about production.

### A mistake worth recording

- **I concluded the migrations had not run, because I looked in `public`.** They
  had run, into `orbit`, and the database also held a second application's
  tables — so the evidence looked exactly like a wrong-project connection. The
  fix in the runbook is not "look harder": it is a first step that prints
  `current_database()` and which of `orbit`/`app` already exist, *before*
  anything is applied. The general lesson is that "the migrations are done" and
  "the tables are where I expect" are two claims, and only one of them was being
  checked.

---

## Session 13 — a real account could not create anything, and capture was a page you had to go to

Two problems, reported together and connected: the **Create it** button on
`/capture` was disabled on a real account, and it explained itself with the
wrong sentence.

### The bug: a profile is created at sign-up and a space is not

`0012_auth_user_profiles.sql` gives every new auth user a profile by trigger.
Nothing gives them a **space** — and a space is what every space-scoped table
takes, so with none of them the account can create nothing at all. `/capture`
rendered its **Into** fieldset empty, disabled the button, and printed *"There
is nothing here but a date."* The line was fine. There was nowhere to put it.

The only route into a space was an invitation from somebody who already had one,
which for a deployment's first user is no route at all.

### Why creating one needed a `SECURITY DEFINER` function

Two inserts, and only the first is allowed:

- `spaces_insert` permits inserting a space whose `owner_id` is `auth.uid()`.
- `space_members_insert` requires `app.is_space_admin(space_id)` — and a space
  created one statement ago has no members, so its creator is not an admin of
  it. The insert that would make them one is the insert being refused.

Left there, the space exists and nobody, including its owner, is in it.

Widening `space_members_insert` to "…or you own the space" would work and is the
wrong fix: `owner_id` is a column an insert chooses, so that policy would let
anybody add themselves to any space they could name as owner. So
`0014_space_creation.sql` adds `app.create_space()`, which does both writes
together, for `auth.uid()` and nobody else. It is the same argument 0012 made
for `app.space_invite()`, and the same narrow grant: revoked from `public`,
granted to `authenticated`.

There is no owner parameter, because there is nothing an owner parameter could
be for except naming somebody else.

### The first space is the default one

`listSpaces` orders by `is_default desc`, and every compose surface preselects
the first row, so the first space somebody creates is marked default and later
ones are not. Choosing to have a second space is not choosing to make it your
default.

### The message was wrong, and that was most of the bug

`ready` was one boolean over two conditions, so both failures printed the
sentence written for the other one. It is two now: *no title* keeps the original
sentence, and *no space* says the line is fine, says there is nowhere to put it,
and links to the space form carrying the typed line back — so making a space
returns you to the preview rather than to an empty field.

### Capture is a bar at the top, not a page you navigate to

It was a link in the rail and a tab at the bottom, which means leaving what you
are reading before you can write down what you just remembered. The cost of that
is the ideas that do not get written down. It is now a field and a button above
every page, `GET`ting `/capture` with the line as `text` — exactly what the
capture page's own form does, so there is still one parse of one string, and
still no client JavaScript on the path.

It renders nothing on `/capture` itself, where it would be the same field twice
with the lower one holding what you typed. A layout cannot ask which page is
beneath it, and the usual answer — a client component calling `usePathname()` —
would ship JavaScript for one comparison, so `middleware.ts` forwards the path
as a request header instead. Absent, the bar renders.

### Verified against

- `./scripts/db-test.sh` — **131/131**, including the new
  `space_creation_test.sql`: the refused membership insert, the function that
  replaces it, the first-space default, that a second person's call touches
  nothing of the first's, and that a task can be written afterwards where it
  could not before.
- `pnpm test` **828** (was 816), build clean, typecheck clean, `pnpm smoke`
  **455/455**.
- A real browser, acting as a profile with no spaces: blocked capture → make a
  space → back on the preview with the line still typed → created.

---

## Session 13, second pass — two spaces on arrival, and one that cannot be deleted

0014 made it possible to create a space. This makes it unnecessary: an account
arrives with **Personal** and **Work**, and the empty-handed state that 0014's
form exists to rescue somebody from is one almost nobody will ever be in. The
form stays — it is how the third space gets made, and it is the fallback if
provisioning ever fails — but it is no longer the first thing a new account has
to understand.

### Two, not one

The first decision Orbit asks of a person is the one it is worst at explaining:
a space is an *audience*, not a folder. One space teaches nobody that. Two
teaches it the first time something is filed in the wrong one. Personal and Work
is the split most people already have in their heads, and the household space —
the one that needs a second person in it — is better made deliberately, on the
screen that also offers the invitation.

### Personal cannot be deleted, and that is a trigger, not a button

Deleting a space deletes everything in it: every `space_id` column in the schema
is `on delete cascade`. That is right — a space *is* its contents — but it means
the last space standing holds everything somebody has, and an account with no
space can create nothing at all, which is the bug 0014 was written for. So one
space carries `protected` and the database refuses to delete it.

Enforced in three places, and only one of them is a guarantee:

- the page does not render a delete control for it;
- the server action refuses, and checks the typed name for everything else;
- **`spaces_refuse_protected_delete`, a `before delete` trigger on the table.**

The first two are courtesies. The trigger is the boundary, because a definer
function runs past the policy and a migration runs past both. The policy was
narrowed to `owner_id = auth.uid() and not protected` as well, so an ordinary
delete matches no row and reports nothing deleted rather than raising — the
readable version of the same fact.

`protected` cannot be turned off either (`spaces_refuse_protected_change`), or
it would be a way to delete the space in two statements instead of one.

**Protected means exactly and only "cannot be deleted".** It can be renamed,
shared, filled and emptied. So renaming had to exist — it did not, anywhere —
and now does, for admins, on the space page. A promise the interface cannot
keep is worse than no promise.

### Where the provisioning is called from, and why not the layout

Signing up provisions both in the same transaction as the profile: 0012's
trigger function was replaced rather than a second trigger added, because "in
alphabetical order of trigger name" is a true fact about Postgres that nobody
should have to know to read the file.

That leaves two cases no trigger on `auth.users` can reach — an account that
predates the migration, and the dev provider, which has no `auth.users` row —
so `listSpaces()` provisions when it reads an empty list.

It is in the query, not the layout, because of `cache()`. Every page and several
server actions share one memoised list per request. Provisioning in the layout
would leave that memo holding the empty array it read a moment *before* the
write, so the sidebar would show two spaces and the page beneath it would still
say there were none. Inside the cached function, every reader in the request
gets the same, correct answer. It costs nothing in the ordinary case: a
non-empty list returns immediately.

The condition is "has no active membership", not "has no space called Work", so
a Work somebody deliberately deleted stays deleted.

### The smoke suite runs in sections now

`scripts/smoke.mjs` is one long script because it drives a real browser through
a real app and later checks depend on earlier state. That is still true, but a
full pass is several minutes and the loop that matters when something breaks is
*fix, re-run the thing that broke*. So every block is now guarded by
`runs('<section>')`, each run writes `.smoke-last.json`, and `pnpm smoke
--failed` re-runs only the sections that failed — plus anything they depend on,
which `PREREQS` declares for the three module-level variables that cross section
boundaries.

A filtered run keeps the previous verdict for the sections it skipped, so fixing
one failure cannot mark the others green, and it never prints "all checks
passed" — it says how many sections it skipped. `CLAUDE.md` is the standing
instruction that goes with it.

### Verified against

- `./scripts/db-test.sh` — **152/152**, including the new `default_spaces_test.sql`:
  that signing up produces both spaces in one transaction, that
  `ensure_default_spaces()` is a no-op the second time, and that the protected
  space survives a delete as its owner, a delete as the *table owner*, and an
  attempt to unprotect it first.
- `pnpm smoke` **455/455** full, and `--failed` / `--section=` exercised.
- A real browser on a profile with no spaces: first page load lands with
  Personal and Work in the sidebar and capture already usable; Personal offers
  a rename and no delete; Work deletes only after its name is typed exactly.

---

## Session 13, third pass — accounts that existed before Orbit did

Reported from a real Supabase project:

> There is no profile for the signed-in account (c9905550-…).

on trying to create a space. The message was accurate and useless. It named the
thing that was missing and offered no way to get it.

### Why it happens, and why it is the ordinary case

0012 creates a profile when an auth user is created; 0015 gives that profile two
spaces. Both are triggers on `insert into auth.users`, and a trigger cannot fire
for a row that is already there.

That is not an edge case on a real project — it is the normal order of events.
Supabase Auth exists before Orbit's migrations are applied to it: people sign
up, or get invited from the dashboard, or are carried over from something else,
and *then* the schema arrives. Every one of those accounts signs in fine (the
provider falls back to the JWT's own claims, so the app renders and says who you
are) and then nothing works, because `auth.uid()` names a profile that does not
exist and every policy correctly sees a stranger.

So the fix is not a better error. It is adoption, reachable three ways: per
request when such an account next loads a page, project-wide for an operator,
and once at the bottom of `0016_adopt_existing_accounts.sql` for everybody
already waiting.

### The email is never an argument, and that is the whole design

The obvious version — let the application pass the address it just verified —
is a privilege escalation. `orbit.profiles.email` is what `app.space_invite()`
matches `invited_email` against, so an account that could choose its own address
could redeem an invitation addressed to somebody else. And a function granted to
`authenticated` is callable by anyone holding a JWT, not only by this server.

So `app.identity_of()` reads the address, in order, from:

1. `request.jwt.claims ->> 'email'`, **and only when `sub` names the account
   being asked about**. Signed by the issuer when the caller is PostgREST; set
   by `asUser()` from a GoTrue-verified session when the caller is the Next app.
   Neither can be chosen by the person holding the token.
2. `auth.users`, by id — correct by definition, guarded, because a project may
   not grant this function's owner anything on that table.
3. `<uuid>@no-email.invalid`, 0012's placeholder. The account works; only
   invitation-by-address does not, until a real claim turns up.

There is exactly one path that overwrites an existing profile's email: a
placeholder being replaced once a token proves a real address, never over an
address somebody actually has, and never one another profile holds. A collision
raises rather than adopting one account into another — the same argument 0012
makes at greater length, and the one case here that cannot be automated.

`asUser()` gained an optional identity for this, and one caller passes it. It is
not a new trust boundary: that connection already asserts who the caller is, and
a server that could lie about the email could lie about the id. What matters is
that the value comes from a verified session and never from a form field.

### Two things that changed underneath

- **`app.create_space()` no longer refuses an account with no profile.** That
  was the right refusal when a missing profile meant identity had come apart. It
  is the wrong one now that it is an ordinary, fixable state.
- **`app.provision_missing_accounts()` inspects by default.** `select * from
  app.provision_missing_accounts();` reports what it would do and changes
  nothing; `(false)` does it. A function that rewrites every account in a
  project the moment somebody types its name to see what it does is one that
  gets run once by accident. It is not granted to `authenticated` — it acts on
  everybody.

### Two older tests were asserting the old surroundings

`space_creation_test.sql` expected one space after `create_space` on a fresh
account; it is three now, because the account is adopted first. And two spaces
were both called Work, which is an assertion that cannot tell two rows apart.
Both fixed in place rather than deleted: what they prove about 0014's
chicken-and-egg is unchanged.

### Verified against

- `./scripts/db-test.sh` — **175/175**, including 23 new assertions: adoption
  from `auth.users`, adoption from a token when there is no `auth.users` row,
  a claims blob naming a different subject being ignored, the collision being
  refused with the other profile untouched, the placeholder repair firing only
  over a placeholder, and `provision_missing_accounts` being uncallable by a
  signed-in user.
- The reported failure reproduced against the exact account id and then fixed:
  `create_space` on an account with no profile now returns a space and leaves
  Personal, Work and the requested space behind.
- **Not verified in a browser.** The dev provider resolves its cookie through
  `orbit.profiles`, so a profile-less account falls back to the first seeded
  one; the JWT-claims fallback that makes this reachable at all is the Supabase
  provider's, which still has never run here.

---

## Session 13, fourth pass — buttons that answer, and a brief for the icon

Reported: *"when I press or hover over them, I can't tell, and it looks like I
haven't pressed it when I do."* Three separate faults wearing one complaint.

### 1. There was no hover state, anywhere

Not a weak one — none. `globals.css` styled `.input:hover` and `.row-hover` and
stopped there; every button in the app had exactly one appearance. The base rule
is now on the **element**, not a class, so all of them answer without thirty call
sites being edited, and the two variants exclude themselves by name rather than
by out-specifying it, because a specificity race is a thing somebody loses later.

### 2. The filled button could not have one

`background: var(--accent)` was in a `style` attribute at 30 call sites, and an
inline style beats a stylesheet — so no `:hover` rule could ever have reached
it. They are `.btn-primary` now. That is the entire reason the change touches 23
files; the interesting part is about eighty lines of CSS.

### 3. The gap after the click, which is not a CSS problem

Every write is a server action, so between the click and the new HTML there is a
round trip in which a plain button looks exactly as it did before. Locally that
is 80ms and invisible. On a phone on a train it is long enough to press again —
and pressing "Create it" twice makes two tasks.

`SubmitButton` uses `useFormStatus` to disable, mark `aria-busy` and turn a
spinner while the action is in flight. It is a Client Component and the forms
around it are not; with JavaScript off it is a plain submit button. It is on the
seven controls where the wait is real (capture, create/rename/delete a space,
save/delete a task, add a task) rather than everywhere, because the rest are
`GET` forms where `useFormStatus` never reports pending anyway.

**The label does not change while pending.** "Create it" → "Saving…" moves under
the pointer and reads as a different control; the spinner says it without the
layout shifting, and every smoke check that finds a button by name keeps working.

### What the states are, and what they cost

Hover strengthens the edge *and* the fill; pressed darkens further and drops the
control 1px. The 1px is the one that reads as mechanical rather than decorative,
and it survives colour-blindness, dark mode, and a phone that renders `:hover`
permanently.

Three new tokens, because reusing `--bg-hover` would have made pressing a button
look identical to hovering a row — that token is deliberately faint, since a
list of sixty rows cannot flash. Both accent steps move *away* from the surface
in their own theme, darker in light and lighter in dark, so contrast against
`--accent-text` goes **up** when a button is pressed. `contrast.test.ts` now
measures all three and asserts the pressed ratio is never below the resting one.

**No shadow**, deliberately: the elevation note in `globals.css` says box-shadow
appears on exactly two things and neither is decorative. A pressed-in inset on
every control in a dense app would be a third. Colour and position do it instead.

### The icon brief

`docs/design-brief-icons.md`, self-contained so it can be handed over without
reading the repository first: the palette as `oklch()` triples, the constraint
that there is no new brand colour, the maskable safe zone, the deliverables
including the exact `icons` array to paste into `manifest.ts`, and the three
obvious answers it may not come back with (a checkmark, a clock, a calendar
page) without arguing for them. The manifest still declares no icons, and the
comment saying why is the thing the answer deletes.

### Verified against

- Measured in a real browser rather than eyeballed: computed `background-color`,
  `border-color` and `translate` at rest, on hover and while held down, in both
  themes, for a filled button, an outlined one, and a plain `<button>` carrying
  no class at all.
- The pending state with the action held for 2.5s: `aria-busy`, disabled,
  spinner turning, label unchanged.
- `pnpm test tests/contrast.test.ts` — the one suite outside the smoke rule that
  a palette change must not skip.

---

## Session 14 — the docs catch up with a deployment that already happened

No behaviour changed. `docs/deployment-and-android.md` was written in session 9
and had drifted far enough to be misleading in three separate directions, and
four other handoff documents were still asserting things this repository had
already disproved.

Two **comments** in `src/lib/auth/` were among them — `index.ts` and
`supabase.ts` both declared the provider *written, never run* — and a comment
that is factually wrong is worse than no comment, because it is read by somebody
deciding what to trust. They were corrected in place and say which paths have
actually been watched. Nothing executable was touched, and the suite was still
re-run rather than assumed.

### The claim that was falsified inside the repo before anybody edited it

Four documents said `AUTH_PROVIDER=supabase` had never run. Session 13's own
decisions-log entries say otherwise, twice: *"Reported from a real Supabase
project"*, with a real account id, and a bug reachable only by signing in.
Migrations 0014, 0015 and 0016 exist **because** somebody signed into a real
project and could then do nothing. The provider had been running for a session
and the contract still said it had never sent a request.

That is the interesting failure here, and it is worth naming: STATUS was
rewritten completely in session 12 and not at all in session 13, so a fact that
arrived as a bug report never reached the file whose job is to hold facts.

### "Running in production" is a third label, and it was needed

The temptation was to move `auth:supabase` from *written, never run* to
*works*. It has not earned that: `works` in STATUS means executed **and
watched**, and nobody has watched the refresh path, a magic link, a confirmed
sign-up, or an invitation redeemed by a second real account. The refresh path is
the one STATUS has named for four sessions as most likely to be wrong.

So the integration table now carries **"running in production, not
acceptance-tested"** for that one row, and the six other providers keep *written,
never run* unchanged. A deployment supplied one credential, not seven. Edge 1
was rewritten from *"the provider has never run"* to *"the provider's refresh
path has never been watched"*, which is the claim that is actually true and
actually load-bearing.

`docs/remaining-work.md` §5 — Brief D, the acceptance pass — is now the prompt
to use rather than a prompt to hold, and its two placeholders can be filled in.

### Serverless stopped being a warning and became a shape

§3 of `docs/deployment-and-android.md` said *"Not Vercel serverless: every page
is force-dynamic and src/lib/db/index.ts holds a pool."* The reasoning behind it
is untouched and still exactly right — **a pool is an asset in a process that
outlives the request and a liability in one that does not** — and it resolves
the other way now, because it only bites while the app pools for itself.
`DATABASE_POOL_MAX=1` and `DATABASE_PREPARE=false` against Supabase's
transaction pooler hand the pooling to Supavisor, and what is left in the
process is one connection held for one invocation.

The section presents container and serverless as **two supported shapes with
their own settings** rather than a recommendation and a warning. Neither is a
code branch on `process.env.VERCEL`: `poolMax()` reads an environment variable
because the shape of a deployment is a deployment decision and belongs in the
deployment's own configuration. The single exception is `next.config.ts`
dropping `output: 'standalone'` on Vercel, which is about build output rather
than behaviour.

### Brief A is a record now, and it is not a clean sheet

Rewritten from a brief into what shipped against what was specified. Phases 1–4
landed, including the three things the brief refused on purpose — no
service-role client, no SDK, no local JWT verification — and Phase 3's hardest
constraint held: invites needed **no column** on `space_invites`.

Two departures are called out rather than smoothed over:

- **"One migration … the only one this brief authorises"** became four. 0014,
  0015 and 0016 all arrived in session 13, each argued before it was written.
  They exist because Brief A left a real account able to sign in and then own
  nothing, and a space is what every space-scoped table requires.
- **"You cannot test against a real Supabase project"** was true when written
  and is the sentence this whole session is about.

The three gotchas were checked individually rather than declared resolved.
Gotcha 1 — `profiles.id` = `auth.uid()` — is the one that mattered and the one
worth reading: 0012's trigger resolved it for accounts created **after** the
trigger existed, and on a real project the accounts are normally there **first**,
so it failed anyway, silently, exactly as predicted and through a door the
prediction did not cover. Gotcha 2 was never fixed in code and should not be:
`0000_bootstrap.sql` still replaces `auth.uid()` unguarded, and the runbook's
answer is to expect the refusal and run that file with `ON_ERROR_STOP=0`.
Gotcha 3 is documented commands, and nothing in this repository records anybody
confirming `orbit_app` owns nothing on the live project — said plainly rather
than assumed.

### Brief B stays a brief, and keeps the paragraph worth keeping

The Android client is not started and §5 remains a brief. Its scope discipline
is reproduced unchanged, including *"if you find yourself porting recurrence.ts,
rules.ts, travel.ts or conflict.ts, stop: you have left the scope"* — that is
still the most valuable paragraph in the file and the reason calendar is
read-only.

Two things underneath it had moved and would have sent the next session at
stale material:

- **The colours.** It said "reuse the colours from `src/app/globals.css`". Every
  one of them changed: session 12 merged the palette into single `light-dark()`
  declarations and session 13 re-solved the ten category colours. Kotlin has no
  `light-dark()`, so the brief now says to take **both halves** of each token —
  a port that reads only the first ships an app with no dark mode against an app
  whose dark mode is half of every token — and to convert oklch→sRGB once and
  check against the ratios `tests/contrast.test.ts` asserts.
- **The launcher icon.** Session 13 produced the icon set, so the brief now
  points at the committed SVG sources in `public/icons/src` and names
  `orbit-icon-maskable.svg` as the adaptive foreground: its safe zone is already
  drawn for the constraint Android's mask imposes. Redrawing the mark is
  forbidden rather than merely discouraged.

### A section that did not exist: the PWA and the APK are different things

Nothing in the file distinguished installing the web app from sideloading a
native client, because when it was written there was only one plan. They are at
opposite ends now — the PWA is manifest, icon set, service worker and a phone
layout, all shipped; the APK is a brief and an empty directory — so §0 states
both, what each gives you, and which one to use today. It also says plainly that
the PWA covers more than Brief B does, which is the honest reason Brief B keeps
losing its case.

### Verified against

- `pnpm build` — clean, per `CLAUDE.md`, because a smoke run against a stale
  build is a green pass for code nobody wrote.
- `pnpm smoke` — **456/456**, the full suite rather than a filtered run. Session
  13 recorded 455; the extra one is its own, not this session's.
- `./scripts/db-test.sh` and `pnpm test` were **not** run: the standing rule is
  smoke only unless asked, and no migration, policy or pure module was touched.

---

## Session 15 — Brief D, the acceptance pass that could not be run as written

Branch `claude/orbit-acceptance-real-project-merods`.

### The premise was false, and saying so is the first deliverable

Brief D opens: *"There is a real Supabase project and a real deployment …
Credentials are in the environment; do not print them, do not commit them."*
They are not in the environment. There is no `SUPABASE_URL`, no
`SUPABASE_ANON_KEY`, no `DATABASE_URL`, no `ADMIN_URL` and no `APP_URL` in this
container; `.env` does not exist and `.env.example` is the committed template it
has always been. The brief's own **"Supabase project ref"** line is blank — the
placeholder was never filled in.

So §1 of the brief could not be attempted at all. Every check in it —
`on_auth_user_created` on `auth.users`, `u.id = p.id` after a sign-up,
`orbit_app` owning nothing and holding no `BYPASSRLS`,
`app.provision_missing_accounts()`, `./scripts/db-test.sh` against the real
project — needs an admin connection string. **None of them ran, and nothing
below should be read as evidence about any of them.** They are still the first
thing the next session with a credential should do, in that order, for the
reason the runbook gives: if `u.id ≠ p.id` every policy returns zero rows and
says nothing, and the app looks empty rather than broken.

The deployment itself is reachable, and some of it is checkable without a
credential. That is where this session went.

### What was decided instead, and why

The brief says to work autonomously, choose the option that keeps the local
checks green, and write the choice down. Three choices:

**1. No accounts were created on the production project.** The brief asks for a
sign-up, and the deployment would have accepted one. It was not done, for
reasons that compound:

- **The result could not be checked.** The brief's own gate is `u.id = p.id`,
  read over `auth.users` — an admin query. Without it a sign-up proves that a
  form submits, which was never the question.
- **Every path downstream dead-ends.** Magic link, email confirmation and an
  invitation to a second account all require receiving mail. There is no
  mailbox here.
- **The rows could not be removed afterwards.** No admin connection, so
  anything created stays in somebody else's production database permanently.

A sign-up under those three conditions is litter with no verification value.
The `pnpm seed` prohibition in the brief shows the owner already cares about
what lands in that project; this is the same instinct applied one step further.

**2. The provider was run against a stub GoTrue instead.** This is the
substitute, and its limits are stated wherever its results are. A stub answers
the way Supabase's documentation says GoTrue answers — it is proof about the
*requests Orbit makes* and about *what Orbit does with an answer*, and it is not
proof about the real project. It found three bugs anyway, one of them the exact
one `docs/STATUS.md` has named for four sessions.

**3. The deployed build was checked without signing in.** `/health`, the
redirect for a signed-out visitor, and the sign-in page's own markers. This is
enough to settle edge 22 on the live deployment and nothing more.

### Edge 36 — the refresh path loses the rotated token, and the session dies

**This is the finding of the session, and it was watched rather than reasoned
about.** The app was built, pointed at a stub GoTrue with a 45-second access
token and Supabase's real rotation semantics, and driven in a browser.

GoTrue **rotates**: every refresh returns a *new* refresh token and revokes the
one just spent, with a 10-second reuse grace that exists specifically so a
server-rendered app can use the same token twice in quick succession. Reuse
*outside* that grace is treated as theft — Supabase revokes the entire token
family, and every token in it stops working for good.

`currentSupabaseUser()` refreshes during a **Server Component render**, and a
Server Component cannot write cookies. `persistSession()` therefore throws every
time, into a `catch` that discards it. The cookie keeps the spent token. The
comment above that `catch` said *"the next server action or route handler
persists it; until then the refresh token still works"* — and that is the whole
mistake, stated in the code, for four sessions.

Watched, in the stub's log:

```
07:27:06.955  POST /token?grant_type=refresh_token -> 200  rotated refresh-2 -> refresh-3
07:27:21.533  POST /token?grant_type=refresh_token -> 400  !! REUSE after grace (age 14.6s)
                                                           -> FAMILY family-1 REVOKED
```

and in the browser: the first page load after expiry **renders normally**, with
the cookie still holding `refresh-2`; the next load fourteen seconds later
bounces to `/auth/signin`, and every load after that does too. Signing in again
is the only way out.

**Reproduction, exactly:** sign in; leave the tab idle until the access token
expires (one hour on Supabase's default); load a page — it works; wait more than
ten seconds; load another — you are signed out.

**Why it was not fixed here.** The fix belongs in a context that may write
cookies, which means middleware: read the access cookie, and when it is expired
and a refresh cookie exists, refresh, set both cookies on the response, and
forward the new access token to the render. That is a real change to the request
path of a live deployment, and three things about it cannot be settled from this
container:

- **Runtime.** Middleware runs on the Edge runtime by default. It cannot import
  `src/lib/auth/supabase.ts`, which pulls in `server-only` and the `postgres`
  pool. The refresh call itself is pure `fetch` and would have to be lifted into
  its own module with no database import — a small refactor, but one whose
  correctness is a bundling question that only a real deployment answers.
- **Rotation against the real server.** A stub cannot prove the cookie set in
  middleware survives the redirect chains the auth screens use.
- **The downside is unbounded.** Getting middleware auth wrong signs *everybody*
  out on *every* request, which is strictly worse than a bug that bites after an
  hour of idling.

So it is written down rather than shipped, per the brief's instruction to leave
what needs a decision as a written argument. What *was* done is to correct the
comment that asserted the opposite, and to stop the app making the bug worse —
see edge 37.

### Edge 37 — identity was resolved twice per render, and it burnt the grace

The stub log showed the refresh being called **twice, one millisecond apart**.
`getCurrentUser()` was a plain function; the root layout resolves identity and
so does every page under it. Under `supabase` that is two GoTrue round trips and
two `app.identity_profile` queries on every page anybody opens.

The cost is the smaller half. The duplicate landed *inside* the refresh path:
the second call re-presented a refresh token the first had already spent,
consuming Supabase's ten-second reuse grace at an age of **0.0 seconds** — on
the very request that created it. That grace exists for server-rendered apps,
and Orbit was spending it on itself before anything else could use it.

Fixed with React's `cache()`, which memoises for the lifetime of one request and
nothing wider — each request gets its own store, so this cannot hand one
person's identity to another's request. Watched: the double refresh is gone.
Edge 36 is unchanged by it; this stops it being self-inflicted twice over.

### Edge 38 — `redirect_to` was sent where GoTrue does not read it

`sendMagicLink` and `signUpWithPassword` computed a callback URL, passed it
down, and put it in the **JSON body** as `options.email_redirect_to`. GoTrue
reads the redirect target from a **`redirect_to` query parameter** and from
nowhere else; `options` is a supabase-js concept that never reaches the wire.
Confirmed against `auth-js`, where `signInWithOtp` and `signUp` pass
`redirectTo` as a request *option* and `lib/fetch.ts` turns it into
`qs['redirect_to']`.

Nothing errors when this happens. GoTrue falls back to the project's **Site
URL**, so every magic link and every confirmation email pointed at the app's
root instead of `/auth/callback` — and `?next=` was lost with it. The tokens
arrive in the URL *fragment*, `CompleteSignIn` only renders on `/auth/callback`,
so nobody reads them: the link appears to do nothing at all.

This also quietly falsifies a line in the runbook. Step 5.5 says the magic-link
path *"is where a mis-set Redirect URL shows up, and Orbit's callback screen
prints the sentence Supabase refused with"*. With the target never sent,
Supabase never refuses — there is nothing to print, and the failure is silent.

Fixed, and pinned by `tests/auth-gotrue.test.ts`, which asserts on the query
string of the request actually put on the wire. **A test that asserted on
arguments could not have caught this**, which is why the new suite drives a real
HTTP server rather than a mock.

### Edge 39 — an unreachable project threw instead of refusing

`gotrue()` did not catch `fetch` rejecting. A paused project, a DNS failure or a
network partition therefore threw out of the server action into the generic
error page — which says *"Orbit can't reach its database"* and names the wrong
component entirely. Every caller already renders `{ok:false}` as a sentence, so
the fix is to return one. The underlying message is deliberately not used: it is
a Node internal (`fetch failed`, `bad port`) and says nothing anybody can act on.

### `server-only` is why none of this had ever been executed

The provider's HTTP layer could not be imported by a test at all. `server-only`
throws on import unless the resolver is asked for React's `react-server`
condition, and Vitest has no reason to ask for it. That single line is most of
why `docs/STATUS.md` could say "not one line of it has ever executed" for four
sessions while the file sat in the repository looking testable.

Vitest now aliases `server-only` to its own `empty.js`. The marker still does
its real job — it is the *bundler* that must refuse a client import, and the
bundler resolves the package for itself. This is the cheapest change in the
session and it is the one that made the other four findings possible.

### What a stub does not prove, said plainly

`tests/auth-gotrue.test.ts` proves the shape of every request Orbit sends and
what it does with every answer. It does not prove:

- that the real project's email templates use the shape the callback expects;
- that a magic link arrives, or that its link works when it does;
- that a sign-up with confirmation on behaves as modelled;
- that `auth.users` → `profiles` fires, or that the ids match;
- anything whatsoever about RLS on the live project.

Rotation, the reuse interval and the revocation-on-reuse are modelled from
Supabase's published behaviour, not observed on the project. Edge 36 is
therefore **watched against a faithful stub** and still unwatched against
Supabase — though the mechanism is documented, not inferred, and the app's half
of it (a cookie that cannot be written during a render) is certain regardless.

### Verified against

- `pnpm build` — clean.
- `pnpm smoke` — **456/456**, full suite, and again without a reseed per edge 3.
- `pnpm test` — **860** across 22 files, up from 828/21: the new file is 20 of
  them. Run because `src/lib/auth/` is a pure module by the standing rule.
- `./scripts/db-test.sh` — **not run**. No policy and no definer function was
  touched, and the real project could not be reached to run it there.

---

## Session 16 — the mobile redesign: four tabs, a map, and a column for where somebody lives

Mobile is the primary surface now, and this session implemented a decided
design rather than exploring one. Seven numbered steps, each built before the
next; `pnpm smoke` **482/482** at the end, up from 479 (the phone section grew).

### The tab bar went from six to four, and the drawer became a page

Six tabs on a 390px screen is 65px each: a 22px icon under a label that has to
be abbreviated to fit under it. Four is the number at which a tab can be a
touch target and a whole word at the same time — Home, Calendar, People, More.

**Capture left the bar and became a FAB.** It was spending a sixth of the bar
to say "plus". As a floating button it is over every tab rather than beside
three of them. It is rendered once from the root layout, hangs off the same
`--tabbar` token that `<main>`'s bottom padding reads, and stands down on the
People map view where the bottom sheet owns that corner.

**Search left the bar for the header of each page that bears a list.** A tab
was the wrong shape for it: search is something you do *to* the list in front
of you, not a sixth place to stand — and in a header it can carry that page's
context into the query (`/search?kind=person` from People), which a tab
pointing at a bare `/search` never could.

**The drawer is gone and `/more` is a route.** A drawer covering the page needs
a backdrop, an Escape handler and a focus trap, all so somebody can reach
Notes; it has no URL, the back button does not close it, and the whole of the
rail has to be rendered a second time to fill it. A route needs none of that.
Removing the focus trap is the part worth saying out loud.

The sticky `CaptureBar` is now `md:` and up only. On a phone it spent a whole
row on a field that is empty almost all of the time, directly above the heading
it was pushing down. The FAB replaces it and the two are hidden at each other's
widths, so exactly one is ever on screen.

### `PRIMARY`/`SECONDARY`/`ADMIN` had to move out of `SidebarNav.tsx`

`/more` sources its groups from those arrays, and it is a Server Component.
`SidebarNav.tsx` is `'use client'`, and **a Server Component importing anything
from a client module gets a client reference, not the value** — the bundler
substitutes a proxy so the thing can cross the boundary, which is exactly right
for a component and useless for an array. It does not fail at build time. It
fails as `ADMIN.filter is not a function`, at runtime, on the page.

So the data lives in `src/lib/nav.ts`, with no directive, and both sides import
it. `SidebarNav` still re-exports all three, so nothing that already imported
them from there had to change.

### Nine task routes, one page, and the segments are links

`/tasks/[list]` collapses to one page with a horizontally scrollable filter.
The segments are `<Link>`s to the nine existing routes with the active one
derived from the route param, **not** client state — `/tasks/overdue` is a URL
somebody bookmarks and lands on from Home's "see all", so the segment has to
reflect the URL rather than recover from it. That also keeps the whole page a
server component. Counts come from the same `smartListCounts` the rail uses,
scoped to the same space, so the two cannot disagree two inches apart.

### The person↔place link — migration 0017

There was none. `queries/places.ts` exposes an association derived from
`event_attendees → events.place_id`, which is attendance history: it says
Dr Iqbal was at the surgery and would say the same of anybody who once had an
appointment there. A map drawn on that basis is a map of meetings labelled
home. So: `people.home_place_id`, nullable, `on delete set null`.

**Null is the ordinary case, not a gap.** Most people in a household organiser
have no address and never will. Every reader keeps those rows — `listPeople`
left-joins — and the map says out loud how many people it is not drawing rather
than quietly showing a shorter list. The header carries the fraction
("23 of 42 have a place") and the sheet carries a permanent row that opens the
list of the rest.

Same-space is enforced in the writing statement, not as a check constraint,
exactly as `category_id` already was: `updatePerson` resolves the id through a
subquery filtered on `p.space_id`, and the picker only offers places from the
person's own space. RLS is unchanged and needed no change.

### The map: MapLibre, lazily, and vector for one specific reason

`next/dynamic({ ssr: false })`, so ~220 KB never lands in the Home bundle —
verified, not assumed. Not a CDN script: the service worker precaches what the
build emits and cannot see a `<script src="https://…">`, and a map that only
works online in an app with an offline shell breaks exactly where a household
organiser gets used.

**Vector rather than raster because Orbit ships a real dark mode.** A raster
basemap is pixels baked at one lightness; at sunset the app goes dark and the
map stays a bright rectangle. A vector style is restyleable at runtime, which
is what lets the ground be repainted from the actual computed `--map-water` and
`--map-land` values rather than from a stock style's second opinion about what
land looks like.

Clustering is done in JavaScript on projected pixel distance rather than with
MapLibre's GeoJSON clustering, because the pins are HTML chips — an avatar and
a name — and that form is the whole reason a pin is not a coloured dot.

**The bug that only shows up with real data:** several people share one address.
Two parents and a child at one house have pins at *identical* coordinates, and
no amount of zoom separates them — so a cluster that only ever zoomed in
swallowed those taps for ever. A cluster now checks whether zooming would
actually split it; when it would not, it opens and lists its people instead.
This is the ordinary case in a household organiser, not an edge.

### A seed lesson worth more than the change that caused it

Adding `chance()`/`pick()` calls to the people loop to assign home places broke
a smoke check **about moving notes**, forty lines further down the seed. `rnd`
is one `mulberry32` stream shared by the whole file: every draw taken shifts
every draw after it, so two new calls moved a note into a different space and
the fixture shifted underneath the suite.

The assignment is now derived from the loop index and consumes no randomness.
**Anything added to an existing seed loop has to be stream-neutral**, or the
failure surfaces somewhere unrelated and looks like a regression in code nobody
touched.

### Verified against

- `pnpm build` — clean, after each numbered step.
- `pnpm smoke` — **482/482**, full suite, on a fresh build and a fresh reseed.
- `pnpm test` and `./scripts/db-test.sh` — **not run**, per the standing rule in
  `CLAUDE.md`. No pure module in `src/lib/` changed behaviour (`src/lib/nav.ts`
  is new data, moved verbatim), and no policy or definer function was touched;
  0017 adds a column and an index and leaves RLS alone.
