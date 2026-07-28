# STATUS — handoff contract

Last rewritten: **session 3**, 2026-07-28. Branch: `claude/orbit-build-phase-2-vu20kw`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is:** Phases 0, 1 and 2 are complete and shippable. Phases
3–6 have not started. `src/lib/integrations/` now exists with all six
interfaces and their fakes, which is what Phase 2 was blocked on.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 3 and all five were green:

```
./scripts/db-test.sh   55/55 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              227 Vitest tests
pnpm smoke             76/76 against the running app     (needs pnpm start)
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
- `app.space_move_preview()` — gains / loses / unchanged, with a plain-language
  reason per person.
- `app.free_busy_blocks()` — the only path a `free_busy` participant has to
  event times. Returns times only.
- `app.entity_space(kind, id)` — `SECURITY INVOKER`, so an item you cannot read
  resolves to *no rows* rather than to a space id.
- **New in session 3:** migration `0010_recurrence_exdates.sql` adds
  `recurrence_rules.exdates`. It is the only schema change since session 1.

**pgTAP — `./scripts/db-test.sh`, 55/55**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list.
- Guarded against a vacuous pass by a subset-checked ledger of legitimately
  empty tables (assertion 51). `recurrence_rules` and `calendar_sync_state`
  **left the ledger this session** — the seed writes both now, so the outsider
  check bites on them for real.
- **New this session:** the partner sees the shared space's recurrence rule and
  not the private one; a `free_busy` participant sees no recurrence rules at
  all. How often something repeats, and from when, is content.
- Also covers: partner sees shared but not private; `free_busy` sees
  availability but no content; forged `owner_id` rejected; `item_shares`
  refusing a non-member; cross-space person linking needing write on both
  sides; person links read from each side; locked items carrying no plaintext;
  `activity_log` refusing to record a view; the move preview.

**TypeScript tests — `pnpm test`, 227 Vitest tests in 7 files**
- `tests/format.test.ts` (42) — dates across the BST/GMT boundaries, plus the
  new `zonedInstant` / `zonedWallClock` / `londonDayMinutes` helpers. Includes
  every hour of both boundary days round-tripping.
- `tests/recurrence.test.ts` (26) — RRULE parsing and expansion. Month ends
  (the 31st skips April, `BYMONTHDAY=-1`, 29 February) and the clocks (09:00
  stays 09:00 across both boundaries while the UTC instant moves).
- `tests/calendar.test.ts` (42) — the week grid, month grid, day spans and
  column packing. The 23-hour and 25-hour days are asserted directly.
- `tests/integrations.test.ts` (29) — provider selection, the fakes, the ICS
  parser end to end, and that the real implementations refuse to act without
  credentials rather than throwing at construction.
- `tests/smartlists.test.ts` (32), `tests/markdown.test.ts` (30),
  `tests/contrast.test.ts` (26) — as session 2 left them.

**Smoke — `pnpm smoke`, 76 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. This is how "verify
RLS through the running app, not only in pgTAP" gets done.

| Acting as | Result |
|---|---|
| Priya | 56 tasks, 42 people, the week/month/day calendar with a space indicator on every block; task, person and event edits round-trip to Postgres; create, link, unlink, move and archive all work; ICS import and calendar pull both run |
| Danny (partner) | 29 rows in Home; **0 in Work**; **anonymous busy blocks** in the merged calendar with no title, no category and no link; sees that a person link exists but not what is on the other side |
| Sam Okafor (outsider) | **0 rows on Today, All open, Notes, People and the calendar**; a direct link to someone else's task *or event* is a **404, not a 403** |

**App — Phase 0 and 1** (unchanged from session 2, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row and Coming up; eight
smart lists; full task edit; notes with versions, archive, links and Markdown;
people with contacts, dates, linking and moving; the space indicator
everywhere; dev user switcher.

**App — Phase 2 (Calendar), new this session**
- `/calendar/week`, `/calendar/day`, `/calendar/month`, Monday-first, merged
  across every space the caller can read. Prev/next/today, view switcher, a
  current-time line, and an all-day banner separate from the timed grid.
- Blocks are positioned as fractions of the day's **real** length, so the 23-
  and 25-hour days are right. An event crossing midnight draws on both days,
  clipped, with a continuation arrow. Overlapping events pack into lanes per
  cluster, so one busy morning does not narrow the whole day.
- **`free_busy` spaces render as anonymous blocks**: a time, a space chip and
  the word "Busy". Different type, different query — `app.free_busy_blocks()`.
  There is no code path that turns an event into one.
- `/calendar/event/[id]`: read, edit (title, date, times, all-day, status,
  category, location, Markdown notes), attendees, delete, and **move behind
  `app.space_move_preview()`**.
- **Recurring events are stored once**, as a row plus an RRULE, and expanded by
  the app on every render. The seed ships two; the calendar draws 29 stand-up
  occurrences across a month from a single row.
- ICS import at `/calendar/import`, fixture-backed by default. Re-importing the
  same feed updates rather than duplicates. Writes `recurrence_rules` (with
  EXDATEs) and `event_attendees`.
- **Connect and pull** a provider calendar from the same page. First pull is
  full, second carries the sync token and is incremental, a provider deletion
  cancels the local event. All exercised here against the fake.
- The page lists all six integrations and states, for each, whether what is
  running is a fixture-backed fake or a real implementation.
- **Notes can now be moved between spaces** too, with the link consequence
  stated before the write.

---

## Stubbed / fixture-backed

**`src/lib/integrations/` — the interface-plus-fake pattern is now real.**
Every `*_PROVIDER` variable in `.env.example` genuinely selects an
implementation; the default is `fake` everywhere; an unknown value is a hard
error rather than a silent fall back.

| Interface | Fake (default, runs here) | Real |
|---|---|---|
| `CalendarProvider` | `calendar:fake` — fixture events, sync tokens, deletions | `calendar:google` — Google Calendar API v3, **written, never run** |
| `IcsProvider` | `ics:fake` — two fixture feeds | `ics:http` — HTTP fetcher, **written, never run** |
| `GeocodingProvider` | `geocoding:fake` — Birmingham places | **not written** — Phase 3 |
| `TravelTimeProvider` | `travel:fake` — haversine × mode speed | **not written** — Phase 3 |
| `PushProvider` | `push:fake` — in-memory outbox | **not written** — Phase 4 |
| `AiProvider` | `ai:fake` — deterministic, offline | **not written** — Phase 5 |

**"Written, never run" means exactly that.** `GoogleCalendarProvider` and
`HttpIcsProvider` have never executed a request — there is no network and no
credential in this environment and there never will be. They are written
against the published APIs. Do not describe either as working. What *is*
verified is that they construct without credentials, refuse to act without
them, and that the ICS parser they share is correct.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
- **Locked items** are modelled and enforced end to end in the database but
  there is **no client-side crypto**. The UI refuses to show or edit them.
- **Rules engine**: tables and two seeded rules, both disabled. No evaluator.

---

## Not started

Phases 3–6 in `docs/phase-plan.md`: places/travel UI, the rules evaluator,
search, NL capture, AI, sync and offline.

---

## Known bugs and rough edges

Including the ones I introduced and did not fix.

1. **`pnpm smoke` leaves state behind.** One archived person per run (as
   before), and after a run the fixture calendars are connected and the school
   term feed is imported. All harmless and all cleared by `pnpm seed` — but it
   means the calendar has fixture events in it that the seed did not put there.
2. **A recurring event has one detail page for the whole series.** Clicking any
   occurrence opens the series and editing it changes every occurrence; the
   page says so. There is no "edit this occurrence only", and no UI at all for
   *creating* a repeat — the compose bar makes one-off events. Recurrence
   arrives through ICS import and the calendar pull.
3. **Recurrence expansion re-runs on every render.** A month view expands every
   rule in every visible space each time. It is bounded (400 occurrences per
   rule, 4000 candidate periods) and imperceptible at this data size, but it is
   not cached and it will be the first thing to hurt.
4. **The pull window is fixed at −180/+365 days** and is not configurable. An
   event outside it is invisible to sync until somebody widens the constant in
   `src/lib/sync/calendar.ts`.
5. **Nothing pushes back.** `calendar_sync_state` has a `direction` column and
   only `'pull'` is ever written. `events.is_dirty` is set when a synced event
   is edited locally and nothing ever clears it by sending the change.
6. **Move is now implemented for tasks, people, events and notes — not
   places.** `previewMove()` and `app.space_move_preview()` handle places;
   there is no places UI at all yet (Phase 3).
7. **The compose bar cannot set an event's location, attendees or notes.** It
   takes a title, date, times, all-day, category and space. Everything else is
   on the detail page.
8. **`switchUser` is still impersonation by design.** Any seeded profile can be
   assumed with one click. **This build must not be exposed to a network you do
   not control.**
9. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
   routes are generated into `.next/types`. Also: a `redirect()` path built by
   concatenating strings loses its literal type and fails the build — use one
   template literal.
10. **The Markdown subset has no tables, no images, no task lists.**
11. **The people list's "next date" is computed twice**, once in SQL for the
    ordering and once in TypeScript for the label, and neither is covered by a
    Vitest case. Unchanged from session 2.
12. **A person's category is resolved back from its *name*** on the detail page
    (`findCategoryId`). Correct, but a lookup that should not need to exist.
13. **Contacts cannot be edited, only added and removed**, and `is_primary` is
    never set from the UI.
14. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
    restarts it, or `service postgresql start` to keep the data. It went down
    once mid-session and every page 500s until it is back.
15. **`pkill -f next-server`, not `pkill -f "next start"`** — and beware that
    `pkill -f next-server` can match the shell command running it. Start the
    server with `setsid nohup … & disown`. If `pnpm start` logs `EADDRINUSE`,
    an old server is still serving an old build and every check you run is
    testing yesterday's code.
16. **No linting.** Out of scope by instruction.
17. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`.

Fixed in session 3, previously listed here: `src/lib/integrations/` not
existing; `recurrence_rules` being unused; move being implemented for tasks and
people only (events and notes now have it).

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 55/55 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 227 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 76 checks against the running app
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
| `CALENDAR_PROVIDER` | `fake` | `fake` \| `google`. Google needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and has never been run. |
| `ICS_PROVIDER` | `fake` | `fake` \| `http`. |
| `GEOCODING_PROVIDER` `TRAVEL_TIME_PROVIDER` `PUSH_PROVIDER` `AI_PROVIDER` | `fake` | `fake` is the only accepted value today; anything else is a hard error. |
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

**A five-minute demo:** switch to Priya, open the calendar, page through a
week. Go to Import, connect "Family (fixture)", come back — the pulled events
are there with a space indicator each. Import the `school-term` feed, then look
at the week of 23 March 2026 and the week after: the assembly is at 09:00 on
both sides of the clocks going forward, and 6 April is missing because the feed
excluded it. Switch to Danny and look at the same calendar: Work is a column of
anonymous "Busy" blocks. Switch to Sam and look again: nothing at all.

---

## Next three things, in order

1. **Phase 3 — Places and Travel.** `places` is seeded with 15 Birmingham
   locations and nothing renders them. Build the places list and detail, wire
   `GeocodingProvider` (the fake exists; write the real Nominatim one, marked
   written-never-run), then travel legs and estimates behind
   `TravelTimeProvider`. `place_visits`, `travel_legs` and `travel_sessions` are
   all in the pgTAP known-empty ledger — take them out as you start writing to
   them. Travel Mode is manual and calendar-derived only (decision 5): no
   background location, and do not request the permission. Places also need a
   move confirmation — they are the last entity type without one (rough edge 6).

2. **Phase 4 — the rules engine.** Tables and two disabled seeded rules exist;
   there is no evaluator. Dry-run preview before enabling, and a `rule_runs`
   audit trail. The brief calls it a bug farm and it is: write the evaluator as
   a pure module against the `PushProvider` fake, the way recurrence was done,
   and test it before wiring any UI to it.

3. **Recurrence in the UI, and pushing back.** Two gaps Phase 2 left open
   (rough edges 2 and 5): there is no way to *create* a repeat from the app, and
   nothing ever sends a local edit back to a provider. Both are small vertical
   slices — a repeat picker on the event form using `describeRrule()` for the
   confirmation line, and a push direction in `calendar_sync_state` that clears
   `events.is_dirty`. Neither blocks Phase 3, so do them when the calendar next
   annoys you rather than before.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
