# STATUS — handoff contract

Last rewritten: **session 4**, 2026-07-28. Branch:
`claude/orbit-phase-3-places-7x37yk`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is:** Phases 0, 1, 2 and **3** are complete and shippable.
Phases 4–6 have not started.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 4 and all five were green:

```
./scripts/db-test.sh   63/63 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              276 Vitest tests in 8 files
pnpm smoke             123/123 against the running app     (needs pnpm start)
```

`pnpm smoke` was run twice in a row without reseeding, and passed both times.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **No migration was added this session.** Phase 3 needed no column the schema
  did not already have. `0010_recurrence_exdates.sql` is still the only
  extension since session 1.
- `app.space_move_preview()`, `app.free_busy_blocks()`, `app.entity_space()` —
  unchanged, all still pinned by pgTAP.

**pgTAP — `./scripts/db-test.sh`, 63/63**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list.
- The known-empty ledger is down to five tables: `ai_runs`, `attachments`,
  `note_versions`, `notification_deliveries`, `person_relationships`,
  `rule_runs`, `space_invites`, `sync_cursors`. **`place_visits`,
  `travel_legs` and `travel_sessions` left it this session** — the seed writes
  all three now.
- **New this session (8 assertions):** the partner sees the shared place,
  visit, journey and trip and not the ones in Priya's own space; a `free_busy`
  participant sees **none** of those four tables. Where somebody went, and when
  they left to get there, is content — strictly more than "busy".

**TypeScript tests — `pnpm test`, 276 Vitest tests in 8 files**
- `tests/travel.test.ts` (46) — **new this session.** Mode mapping and buffers,
  door-to-door times, departure instants, whether a journey fits the gap,
  derivation from a day's events, sessions from multi-day ones, day fractions.
  Every clock case is on the real 2026 boundaries: the 23-hour day on 29 March
  and the 25-hour day on 25 October, in both directions.
- `tests/integrations.test.ts` (32, was 29) — adds the two Phase 3 real
  providers: both construct with no credential, both refuse when called, an
  empty geocode query never becomes a request, and ORS refuses `transit`.
- `tests/format.test.ts` (42), `tests/calendar.test.ts` (42),
  `tests/recurrence.test.ts` (26), `tests/smartlists.test.ts` (32),
  `tests/markdown.test.ts` (30), `tests/contrast.test.ts` (26) — unchanged.

**Smoke — `pnpm smoke`, 123 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. This is how "verify
RLS through the running app, not only in pgTAP" gets done. 47 checks are new
this session.

| Acting as | Result |
|---|---|
| Priya | 16 places listed with a space indicator on every row; place edit, geocode, visit log, event↔place link, journey save/re-estimate/delete all round-trip to Postgres; the move preview for a place |
| Danny (partner) | sees the 15 Home places and **not** the one in Priya's own space (direct link is a **404**); sees the Home trip and **not** the Work one he only has free/busy on |
| Sam Okafor (outsider) | **0 places**, **no trips**, **no journeys**, **no events to derive one from**; direct links are 404s |

**App — Phases 0, 1 and 2** (unchanged, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row; eight smart lists;
tasks, notes with versions and Markdown, people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks,
recurrence expanded from one row plus an RRULE, ICS import and provider pull.

**App — Phase 3, new this session**
- **`/places`** — the 15 seeded Birmingham places (plus one seeded into Work)
  with the space indicator on every row and on the compose bar. Search by name,
  address or postcode; show/hide archived; a coordinate summary or a "no point"
  flag per row.
- **`/places/[id]`** — edit name, address, postcode, city, category,
  coordinates and Markdown notes; log and remove visits; see the events, notes
  and people attached. **People are derived from event attendees** and the page
  says so.
- **Geocoding from the running app with no network.** "Find coordinates" calls
  the selected `GeocodingProvider`; with the default fake it resolves against a
  table of Birmingham locations and writes `geocode_source`, so a place always
  says where its point came from. The section names the provider that will
  answer, and the outcome is announced through a live region.
- **Places can be moved between spaces**, behind `app.space_move_preview()`.
  **That completes the hard requirement**: tasks, people, events, notes and now
  places all state who gains and who loses before anything is written.
- **An event can name a place** from its own space, on the event detail page.
- **`/travel`** — trips and journeys.
  - *Trips*: started by hand, or lifted from a multi-day calendar event with
    one click. Day counts are computed by counting London midnights, so the
    clock-change weekends are right.
  - *Journeys*: typed in, or derived from two events at different places. The
    derived list states the door-to-door estimate with the moving part and the
    buffer shown separately, and whether it fits: "68 min spare" or "2 min
    short". Saving one works the departure instant back from the arrival and
    asks the provider for a real estimate at that moment.
  - A saved journey can be re-estimated in another mode; the space indicator is
    on every journey and every trip row.
- **The seed writes a fixed travel day, 29 July 2026** — three placed Home
  events arranged so the first hop has room and the second does not. `/travel`
  demonstrates both verdicts on a cold container.

---

## Stubbed / fixture-backed

**`src/lib/integrations/`.** Every `*_PROVIDER` variable genuinely selects an
implementation; the default is `fake` everywhere; an unknown value is a hard
error rather than a silent fall back.

| Interface | Fake (default, runs here) | Real |
|---|---|---|
| `CalendarProvider` | `calendar:fake` | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` — Birmingham fixtures, substring match | `geocoding:nominatim` — **written, never run** (new) |
| `TravelTimeProvider` | `travel:fake` — haversine × mode speed | `travel:openrouteservice` — **written, never run** (new) |
| `PushProvider` | `push:fake` — in-memory outbox | **not written** — Phase 4 |
| `AiProvider` | `ai:fake` — deterministic, offline | **not written** — Phase 5 |

**"Written, never run" means exactly that.** `NominatimGeocodingProvider` and
`OpenRouteServiceTravelTimeProvider` have never executed a request — there is
no network and no credential in this environment and there never will be. They
are written against the published APIs and usage policies. **Do not describe
either as working, and do not let the fake stand in for one in a "Works"
claim.** What *is* verified: both construct with no credential, both refuse
when called, an empty geocode query never becomes a request, and ORS refuses
`transit` rather than answering a bus question with a driving time.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
- **Locked items** are modelled and enforced end to end in the database but
  there is **no client-side crypto**. The UI refuses to show or edit them.
- **Rules engine**: tables and two seeded rules, both disabled. No evaluator.

---

## Not started

Phases 4–6 in `docs/phase-plan.md`: the rules evaluator, search, NL capture,
AI, sync and offline.

---

## Known bugs and rough edges

Including the ones I introduced this session and did not fix.

### Introduced or newly noticed in session 4

1. **A travel leg is never attached to a trip from the UI.**
   `travel_legs.session_id` exists, the seed populates it, and the trip row
   shows a journey count — but nothing in `/travel` lets you file a journey
   under a trip. `listLegsInSession()` is written and unused.
2. **A trip has no detail page.** It is a row on `/travel` with a delete
   button. There is no way to edit its dates, its title or its notes once
   created, and `travel_sessions.is_active` is written at creation and never
   updated afterwards — a trip that is running now is shown as running by
   computing it from the dates (`sessionIsActive`), not by reading the column.
3. **Derived journeys are re-derived on every render**, like recurrence. It is
   one day's events at a time so it is far smaller than the calendar's problem,
   but it is the same shape.
4. **The derived-journey mode is guessed from the distance** (under 1.5 km
   walks, otherwise drives) and the guess is not remembered. Change it in the
   picker, save, and the *next* derived journey guesses again.
5. **`saveDerivedLeg` does not check for a duplicate before writing.** The page
   filters out journeys that already exist by `(from, to, arrival)`, so the
   button disappears — but two tabs, or a fast double-click, will write two
   rows. The `travel_legs` table has no unique constraint that would refuse it.
6. **`estimateBetween()` swallows a provider failure.** A real provider without
   a credential leaves the leg saved with `estimate_source = 'none'` and no
   message on the screen. That is deliberate — the journey is still worth
   recording — but the user is not told the provider refused.
7. **A place's visits and events are capped at 25–50 rows** with no paging and
   no "showing the most recent" label.
8. **`pnpm smoke` still leaves state behind**: one archived person per run,
   the fixture calendars connected, the school-term feed imported, and now one
   place named "Smoke private place" in Priya's own space. All harmless, all
   cleared by `pnpm seed`.

### Carried over, still true

9. **A recurring event has one detail page for the whole series.** Editing it
   changes every occurrence; the page says so. There is no "edit this
   occurrence only" and **no UI at all for creating a repeat**.
10. **Recurrence expansion re-runs on every render.** Bounded (400 occurrences
    per rule, 4000 candidate periods) and imperceptible at this data size.
11. **The calendar pull window is fixed at −180/+365 days**, in
    `src/lib/sync/calendar.ts`.
12. **Nothing pushes back.** Only `'pull'` is ever written to
    `calendar_sync_state.direction`, and `events.is_dirty` is set and never
    cleared.
13. **The compose bar cannot set an event's location, attendees or notes.**
14. **`switchUser` is impersonation by design.** Any seeded profile can be
    assumed with one click. **This build must not be exposed to a network you
    do not control.**
15. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
    routes are generated into `.next/types`. Also: a `redirect()` path built by
    concatenating strings loses its literal type — use one template literal.
16. **The Markdown subset has no tables, no images, no task lists.**
17. **The people list's "next date" is computed twice**, in SQL for the
    ordering and in TypeScript for the label, and neither is covered by Vitest.
18. **A person's category is resolved back from its *name*** on the detail
    page. The place page does the same thing, for the same reason, and it is
    the same lookup that should not need to exist.
19. **Contacts cannot be edited, only added and removed**; `is_primary` is
    never set from the UI.
20. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
    restarts it, or `service postgresql start` to keep the data.
21. **`pkill -f next-server`, not `pkill -f "next start"`** — and beware that
    `pkill -f next-server` **can match the shell running it**, which kills your
    own command with exit 144 and sometimes takes the server with it. Start the
    server with `setsid nohup … & disown`, and if `pnpm start` logs
    `EADDRINUSE`, an old server is serving an old build and every check you run
    is testing yesterday's code.
22. **No linting.** Out of scope by instruction.
23. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`.

Fixed in session 4, previously listed here: move not being implemented for
places (it is now, which completes the requirement for every entity type).

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 63/63 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 276 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 123 checks against the running app
```

Start the server so it survives the shell that launched it:

```sh
setsid nohup pnpm start > /tmp/next.log 2>&1 < /dev/null & disown
```

Dev loop: `pnpm dev`. Reseed without touching schema: `pnpm seed`.
Rebuild schema without seeding: `./scripts/db-reset.sh --no-seed`.

**Env vars** — copy `.env.example` to `.env`; every value has a working default
and **no credential is required**.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://orbit_app:orbit_dev_password@localhost:5432/orbit` | App role. Owns nothing, no BYPASSRLS, no table grants. |
| `SEED_DATABASE_URL` | `postgres://orbit_seed:…@localhost:5432/orbit` | BYPASSRLS. Seeding only — never at request time. |
| `AUTH_PROVIDER` | `dev` | Only implementation. |
| `CALENDAR_PROVIDER` | `fake` | `fake` \| `google`. Google needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Never run. |
| `ICS_PROVIDER` | `fake` | `fake` \| `http`. |
| `GEOCODING_PROVIDER` | `fake` | `fake` \| `nominatim`. Nominatim needs `NOMINATIM_CONTACT` and has never been run. |
| `TRAVEL_TIME_PROVIDER` | `fake` | `fake` \| `openrouteservice`. ORS needs `ORS_API_KEY` and has never been run. |
| `PUSH_PROVIDER` `AI_PROVIDER` | `fake` | `fake` is the only accepted value today; anything else is a hard error. |
| `ORBIT_DB_NAME` | `orbit` | Read by both scripts. |
| `ORBIT_URL` | `http://localhost:3000` | `pnpm smoke` only. |
| `CHROMIUM_PATH` | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | `pnpm smoke` only. |

Three Postgres roles, deliberately separated: `orbit_app` (the app, fully
policy-bound), `orbit_seed` (BYPASSRLS, seeds only), `postgres` (owner,
migrations and tests).

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

**A five-minute demo:** as Priya, open **Places** — 16 rows, each with a space
indicator. Open Cannon Hill Park, clear its latitude and longitude, save, then
press **Find coordinates**: it resolves with no network and says the point came
from `geocoding:fake`. Open **Travel** and go to **29 July 2026**: the calendar
implies two journeys, the first with 68 minutes spare and the second 2 minutes
short. Save the first — it works the departure time back from the arrival —
then re-estimate it as a walk and watch the duration change. Switch to Danny:
the Pembrokeshire trip is there, the Leeds one is not. Switch to Sam: nothing
at all, and a direct link to a place is a 404.

---

## Next three things, in order

1. **Phase 4 — the rules engine.** Tables and two disabled seeded rules exist;
   there is no evaluator. Dry-run preview before enabling, and a `rule_runs`
   audit trail (`rule_runs` is one of the last tables in the pgTAP known-empty
   ledger — take it out as you start writing to it). The brief calls it a bug
   farm and it is: write the evaluator as a pure module against the
   `PushProvider` fake, the way `src/lib/travel.ts` and `src/lib/recurrence.ts`
   were done, with the tests before any UI.

2. **Close the Phase 3 gaps that are worth closing** (rough edges 1, 2 and 5) —
   a trip detail page that can edit its dates and file journeys under it, and a
   unique constraint or an existence check so a derived journey cannot be
   saved twice. None of these block Phase 4; do them when travel next annoys
   you. Rough edges 3, 4, 6 and 7 are consciously accepted for now.

3. **Recurrence in the UI, and pushing back** (rough edges 9 and 12). Still
   open from Phase 2: there is no way to *create* a repeat from the app, and
   nothing ever sends a local edit back to a provider. Both are small vertical
   slices — a repeat picker using `describeRrule()` for the confirmation line,
   and a push direction in `calendar_sync_state` that clears `events.is_dirty`.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
