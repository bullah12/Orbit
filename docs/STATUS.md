# STATUS — handoff contract

Last rewritten: **session 5**, 2026-07-28. Branch:
`claude/orbit-phase-4-rules-gey60v`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is:** Phases 0, 1, 2, 3 and **4** are complete and
shippable. Phases 5 and 6 have not started.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 5 and all five were green:

```
./scripts/db-test.sh   70/70 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              349 Vitest tests in 9 files
pnpm smoke             155/155 against the running app     (needs pnpm start)
```

`pnpm smoke` was run **twice in a row without reseeding** after that rebuild
and passed both times. The rules section it gained this session creates a rule
and deletes it again, so it leaves the list exactly as it found it.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **One migration this session:** `0011_travel_leg_identity.sql`, a partial
  unique index giving a derived travel leg an identity. That is the second
  schema extension in five sessions; Phase 4 itself needed no column the schema
  did not already have.
- `app.space_move_preview()`, `app.free_busy_blocks()`, `app.entity_space()` —
  unchanged, all still pinned by pgTAP.

**pgTAP — `./scripts/db-test.sh`, 70/70**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list.
- **New this session (7 assertions):** the partner sees the rule, the run and
  the notification delivery in the shared space and none of the ones in
  Alice's own; a free/busy participant sees none of the three, because a run
  records the titles of everything the rule considered and that is strictly
  more than "busy"; and the partner cannot create a rule inside a space they
  are not in.
- The known-empty ledger is down to **five** tables. `rule_runs`,
  `notification_deliveries` and `note_versions` left it this session — the seed
  writes all three now. What remains: `ai_runs` (Phase 5), `sync_cursors`
  (Phase 6), and `attachments`, `person_relationships`, `space_invites`, which
  **stay unused on purpose** — the reasoning is a paragraph in
  `docs/decisions-log.md`, not silence.

**TypeScript tests — `pnpm test`, 349 Vitest tests in 9 files**
- `tests/rules.test.ts` (69) — **new this session.** Parsing what jsonb hands
  back, every condition operator including the boundaries, `-0`, and a value
  typed as a string; every action, including the ones that correctly do
  nothing; both refusals from several directions; a whole run's counts and its
  sentence; days overdue across both 2026 clock changes; and that evaluating
  twice mutates nothing.
- `tests/integrations.test.ts` (36, was 32) — adds the real Web Push provider:
  it constructs with no credential, refuses when called without one, refuses a
  subscription that is not one, and refuses a message whose link is external.
- `tests/travel.test.ts` (46), `tests/format.test.ts` (42),
  `tests/calendar.test.ts` (42), `tests/smartlists.test.ts` (32),
  `tests/markdown.test.ts` (30), `tests/recurrence.test.ts` (26),
  `tests/contrast.test.ts` (26) — unchanged.

**Smoke — `pnpm smoke`, 155 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. 28 checks are new
this session, and they assert a *sequence* rather than a state.

| Acting as | Result |
|---|---|
| Priya | the rules list with a space indicator on every row; a new rule refuses to switch on with no action, refuses again with an action but no preview, previews, switches on, runs for real, and loses its permission to run the moment it is edited; the locked task appears as skipped; both new pages pass the label audit; the rule is deleted and the list is as it was found |
| Danny (partner) | sees the rules in the space he shares and **not** the one in the space he only has free/busy on |
| Sam Okafor (outsider) | **0 rules**, no runs; a direct link to a real rule is a **404** |

**App — Phase 4, new this session**
- **`/rules`** — every rule with its space indicator, what it would do in one
  sentence (`describeRule`), whether it is on, when it was last previewed and
  how often it has run. Recent runs and recent notification deliveries below.
- **`/rules/[id]`** — the whole rule, in the order somebody works. Rename it,
  change its trigger, add and remove conditions and actions from closed lists;
  dry-run it; read the preview item by item; switch it on; run it for real;
  read the audit trail; delete it.
- **The dry run names everything.** "Assign “Put the bins out” to Danny
  Whitehouse (it is with nobody now)". Items with a change or a skip are listed
  first; the tasks it looked at and left alone are behind a disclosure.
- **A locked task is listed as skipped**, with the reason, and its title is
  never shown — it has none. Verified in the running app, not only in Vitest.
- **A rule cannot be switched on until it has been dry-run**, and any
  structural edit switches it off and clears the preview.
- **Rules fire by themselves.** Creating, changing or completing a task runs
  the enabled rules for that trigger. Verified: creating "Take the bin bags to
  the shed" in Home assigned it to Danny and wrote a `rule_runs` row.
- **Notifications go through the `PushProvider` fake** and write a
  `notification_deliveries` row whatever the provider says. Verified: a `notify`
  action produced a `sent` row against `push:fake`.

**App — Phases 0–3** (unchanged, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row; eight smart lists;
tasks, notes with versions and Markdown, people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks,
recurrence expanded from one row plus an RRULE, ICS import and provider pull;
places with geocoding, visits and links; travel with trips and derived
journeys.

---

## Stubbed / fixture-backed

**`src/lib/integrations/`.** Every `*_PROVIDER` variable genuinely selects an
implementation; the default is `fake` everywhere; an unknown value is a hard
error rather than a silent fall back.

| Interface | Fake (default, runs here) | Real |
|---|---|---|
| `CalendarProvider` | `calendar:fake` | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` — in-memory outbox | `push:webpush` — **written, never run** (new) |
| `AiProvider` | `ai:fake` — deterministic, offline | **not written** — Phase 5 |

**"Written, never run" means exactly that.** `WebPushProvider` has never sent a
request: RFC 8030 delivery, RFC 8292 VAPID signing and RFC 8291 `aes128gcm`
payload encryption, all written from the specifications and none of it
executed against a push service. **Do not describe it as working, and do not
let the fake stand in for it in a "Works" claim.** What *is* verified: it
constructs with no credential, refuses when called without one, refuses a
malformed subscription, and refuses a message whose link is not an in-app path.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
- **Locked items** are modelled and enforced end to end in the database, and now
  in the rules engine, but there is **no client-side crypto**. The UI refuses to
  show or edit them.
- **There is no scheduler.** A `schedule` rule is evaluated by exactly the same
  code as every other rule and runs when somebody presses "Run now, for real".

---

## Not started

Phases 5 and 6 in `docs/phase-plan.md`: search, NL capture, AI; sync and
offline.

---

## Known bugs and rough edges

Including the ones I introduced this session and did not fix.

### Introduced or newly noticed in session 5

1. **Nothing runs a `schedule` rule on a schedule.** There is no background
   worker and adding one is a deployment decision, which is out of scope. The
   rule stores and shows its cron and runs when you press the button.
   Consciously accepted — see `docs/decisions-log.md`.
2. **A rule's conditions and actions are appended and removed, never edited.**
   To change "contains bin" to "contains bins" you remove it and add it again.
   Also: there is no reordering, which matters for actions and not for
   conditions.
3. **The action form is one select and one free-text box**, so the box means a
   priority for one action and a number of days for another. The label lists
   what it can be, and a wrong value is refused with a sentence, but it is a
   form that knows more than it shows.
4. **The rules engine only knows about tasks.** `entity_kind` on `rule_runs`
   allows more and the fact type is a discriminated union ready for it, but
   there is no event, note, person or place fact today.
5. **A sweep is capped at 500 open tasks** in one space, silently. At this data
   size it is not close, and there is no "showing the first 500" label.
6. **`pnpm smoke` still leaves state behind**: one archived person per run, the
   fixture calendars connected, the school-term feed imported, one place named
   "Smoke private place", and now a handful of `notification_deliveries` rows.
   All harmless, all cleared by `pnpm seed`. The rule the suite creates *is*
   deleted, and the suite passes twice in a row — verified this session.
7. **`rule_runs` is never pruned.** Every dry run is a row holding a JSON
   summary of every task it considered. Nothing deletes old ones, and a rule
   deleted takes its runs with it.

### Carried over, still true

8. **A trip has no detail page.** It is a row on `/travel` with a delete
   button; its dates, title and notes cannot be edited after creation, and
   `travel_sessions.is_active` is written once and never updated (the UI
   computes it from the dates instead). Accepted in writing in session 4.
9. **Derived journeys are re-derived on every render**, and **the derived mode
   is guessed from the distance and the guess is not remembered**, and
   **`estimateBetween()` swallows a provider failure** without saying so on the
   screen. All three accepted in writing in session 4.
10. **A recurring event has one detail page for the whole series.** Editing it
    changes every occurrence; the page says so. There is no "edit this
    occurrence only" and **no UI at all for creating a repeat**.
11. **Recurrence expansion re-runs on every render.** Bounded (400 occurrences
    per rule, 4000 candidate periods) and imperceptible at this data size.
12. **The calendar pull window is fixed at −180/+365 days**, in
    `src/lib/sync/calendar.ts`.
13. **Nothing pushes back.** Only `'pull'` is ever written to
    `calendar_sync_state.direction`, and `events.is_dirty` is set and never
    cleared.
14. **The compose bar cannot set an event's location, attendees or notes.**
15. **`switchUser` is impersonation by design.** Any seeded profile can be
    assumed with one click. **This build must not be exposed to a network you
    do not control.**
16. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
    routes are generated into `.next/types`. Also: a `redirect()` path built by
    concatenating strings loses its literal type — use one template literal.
17. **The Markdown subset has no tables, no images, no task lists.**
18. **The people list's "next date" is computed twice**, in SQL for the
    ordering and in TypeScript for the label, and neither is covered by Vitest.
19. **A person's category is resolved back from its *name*** on the detail
    page. The place page does the same thing, for the same reason.
20. **Contacts cannot be edited, only added and removed**; `is_primary` is
    never set from the UI.
21. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
    restarts it, or `service postgresql start` to keep the data.
22. **`pkill -f next-server` can match the shell running it**, which kills your
    own command with exit 144 and sometimes takes the server with it. Prefer
    `pgrep -f next-server | while read pid; do kill "$pid"; done`, start the
    server with `setsid nohup … & disown`, and if `pnpm start` logs
    `EADDRINUSE`, an old server is serving an old build and every check you run
    is testing yesterday's code.
23. **No linting.** Out of scope by instruction.
24. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`.

Fixed in session 5, previously listed here: `travel_legs` had no unique
constraint (migration 0011 gives a derived leg an identity), and a place's
capped lists did not say they were capped.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 70/70 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 349 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 155 checks against the running app
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
| `GEOCODING_PROVIDER` | `fake` | `fake` \| `nominatim`. Nominatim needs `NOMINATIM_CONTACT`. Never run. |
| `TRAVEL_TIME_PROVIDER` | `fake` | `fake` \| `openrouteservice`. ORS needs `ORS_API_KEY`. Never run. |
| `PUSH_PROVIDER` | `fake` | `fake` \| `webpush`. Web Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Never run. |
| `AI_PROVIDER` | `fake` | `fake` is the only accepted value today; anything else is a hard error. |
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

**A five-minute demo:** as Priya, open **Rules**. Three rules, all off, each
saying in one sentence what it would do. Open **Bins go to Danny** and press
**Dry run — change nothing**: it lists the one task it would act on — "Assign
“Put the bins out” to Danny Whitehouse (it is with nobody now)" — and the
locked task, which it declined to read. Only now is **Switch on** offered.
Switch it on, press **Run now, for real**, and the task is assigned. Add a
**Notify me** action and the next run writes a delivery, listed at the bottom
of `/rules` with the provider that answered. Then change the trigger and press
Save: the rule switches itself off and says why. Switch to Danny — the Work
rule is not there. Switch to Sam — nothing at all, and a direct link to a rule
is a 404.

---

## Next three things, in order

1. **Phase 5 — search, capture and AI.** Server-side search across everything
   **except** locked items — the partial indexes are already on the tables
   (`tasks_search_idx … where not is_locked` and its siblings), so the work is
   a search view and a page, not new columns. NL capture parsed **locally**, in
   a pure module under `src/lib/capture/`, never over the network, with the
   parsing tests covering UK date phrasing across a BST boundary. AI off by
   default, per-feature opt-in; `ai_feature_consents` is already seeded with
   three disclosures and `is_enabled` false. `ai_runs` leaves the pgTAP ledger
   this phase. No pgvector. Write the real `AiProvider`, mark it written, never
   run it.

2. **Phase 6 — sync and offline.** Sync cursors, conflict handling, optimistic
   local writes; `sync_cursors` leaves the ledger. Two Phase 2 gaps belong
   here: nothing pushes a local edit back to a provider (rough edge 13), and
   there is still no UI for creating a recurring event (rough edge 10).

3. **The Phase 4 rough edges worth closing** (1–4 above), in this order:
   editing a condition in place rather than removing and re-adding it; a trip
   detail page while you are in the neighbourhood (rough edge 8); and, if a
   later phase ever gives Orbit somewhere to run background work, a scheduler
   so a `schedule` rule means what it says.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
