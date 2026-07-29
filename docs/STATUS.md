# STATUS — handoff contract

Last rewritten: **session 6**, 2026-07-29. Branch:
`claude/orbit-phase-5-q2yu2b`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is:** Phases 0, 1, 2, 3, 4 and **5** are complete and
shippable. Phase 6 has not started.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 6 and all five were green:

```
./scripts/db-test.sh   76/76 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              526 Vitest tests in 12 files
pnpm smoke             215/215 against the running app     (needs pnpm start)
```

`pnpm smoke` was run **twice in a row without reseeding** after that rebuild
and passed both times. The two sections it gained this session both put things
back: capture creates one task and deletes it, and the AI section switches a
consent on and then off again.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **No migration this session.** Phase 5 needed no column the schema did not
  already have — the five search indexes, `ai_feature_consents` and `ai_runs`
  were all there. That is the third phase in a row that extended nothing, and
  two extensions in six sessions total.
- `app.space_move_preview()`, `app.free_busy_blocks()`, `app.entity_space()` —
  unchanged, all still pinned by pgTAP.

**pgTAP — `./scripts/db-test.sh`, 76/76**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list.
- **New this session (6 assertions):** a free/busy participant sees no
  `ai_runs`; the partner sees the run in the shared space and not the one in
  Alice's own; the run they see is the one that happened rather than the
  refusal from elsewhere; **the partner sees none of Alice's consent rows even
  in the space they share**, because the policy on `ai_feature_consents` is
  `owner_id = auth.uid()` and not the usual space-wide grant; and the partner
  can neither consent nor record an AI run inside a space they are not in.
- The known-empty ledger is down to **four** tables. `ai_runs` left it this
  session — the seed writes an `ok` row and a `refused` row. What remains:
  `sync_cursors` (Phase 6), and `attachments`, `person_relationships`,
  `space_invites`, which **stay unused on purpose** — the reasoning is a
  paragraph each in `docs/decisions-log.md`, not silence.

**TypeScript tests — `pnpm test`, 526 Vitest tests in 12 files**
- `tests/capture.test.ts` (99) — **new.** The parser's UK phrasing, the
  local-only promise checked by reading the module's own source, and
  `captureInstants` pinned on both sides of both 2026 clock changes (an all-day
  capture is 23 hours on 29 March and 25 on 25 October).
- `tests/search.test.ts` (50) — **new.** Query normalisation, the word-aligned
  snippet and its crude stemmer, and the merge that stops one kind burying the
  other four.
- `tests/ai.test.ts` (23) — **new.** The gate: locked refused first and from
  three directions, every consent failure, and that `weekly_review` sends no
  note bodies.
- `tests/integrations.test.ts` (41, was 36) — adds the real Anthropic provider:
  it constructs with no credential, is not a fake and does not claim to be, and
  refuses **before** it would touch the network, naming the variable.
- `tests/rules.test.ts` (69), `tests/travel.test.ts` (46),
  `tests/format.test.ts` (42), `tests/calendar.test.ts` (42),
  `tests/smartlists.test.ts` (32), `tests/markdown.test.ts` (30),
  `tests/recurrence.test.ts` (26), `tests/contrast.test.ts` (26) — unchanged.

**Smoke — `pnpm smoke`, 215 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. 60 checks are new
this session across three sections.

| Acting as | Result |
|---|---|
| Priya | search finds 19 things for "bins" with a space indicator and a kind on every row; narrowing to notes returns only notes; a nonsense query says so. Capture reads a line back as chips, creates the task it described, and refuses a line that is only a date. AI names its provider, ships every feature off, refuses a run while off, runs once switched on and shows what was sent, **refuses the locked note with the feature switched on**, and records the refusal as a row |
| Danny (partner) | finds the same rows as Priya in the space they share, nothing from the space he only has free/busy on, and nothing from hers alone; has **one** AI consent, his own, and sees none of Priya's three |
| Sam Okafor (outsider) | finds nothing, is told so rather than shown an error; has no space to capture into so capture is refused; no AI features and no runs |

**App — Phase 5, new this session**
- **`/search`** — one box across tasks, notes, people, events and places. Every
  result carries its space indicator, a neutral kind chip, a detail line and a
  highlighted snippet. Tick-boxes choose which of the five queries are *asked*
  — which is not the same as hiding anything.
- **Locked items are absent because there is nothing to find.** A locked row is
  constrained to an empty title and body. The page says "N locked items not
  searched" rather than being quietly short. Verified in the running app.
- **`/capture`** — type a line the way you would say it, press **Read it back**,
  and every phrase the parser consumed comes back as a chip saying what it took
  it to mean. Then create it as a task, a note or an event, into a space you
  pick with the indicator in front of you. Verified: "a week on Tuesday call the
  dentist" previews as Tuesday 11 August and creates a task with that due date.
- **Nothing in capture touches the network.** `src/lib/capture/` imports the
  date helpers and nothing else, and a test reads the source back to keep it
  that way.
- **`/ai`** — every feature off, each with the plain-language disclosure the
  seed already carried, the provider that would answer named, and whether it is
  a fake. Switching one on records the consent; running it shows what was sent
  beside what came back. Verified: refused while off, answered once on, and the
  locked note refused with it on.
- **Every attempt is an `ai_runs` row**, refusals included, content never.
  Verified: the run log holds the refusal and no note text.

**App — Phases 0–4** (unchanged, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row; eight smart lists;
tasks, notes with versions and Markdown, people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks,
recurrence expanded from one row plus an RRULE, ICS import and provider pull;
places with geocoding, visits and links; travel with trips and derived
journeys; the rules engine with its dry run, audit trail and notifications.

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
| `PushProvider` | `push:fake` — in-memory outbox | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` — deterministic, offline | `ai:anthropic` — **written, never run** (new) |

**"Written, never run" means exactly that.** `AnthropicAiProvider` has never
sent a request: there is no key and no network here. **Do not describe it as
working, and do not let the fake stand in for it in a "Works" claim.** What
*is* verified: it constructs with no credential, refuses when called without
one and names the variable, refuses *before* it would build a request, and
reports `isFake: false`.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
- **Locked items** are modelled and enforced end to end in the database, in the
  rules engine and now in the AI gate, but there is **no client-side crypto**.
  The UI refuses to show or edit them.
- **There is no scheduler.** A `schedule` rule is evaluated by exactly the same
  code as every other rule and runs when somebody presses "Run now, for real".

---

## Not started

Phase 6 in `docs/phase-plan.md`: sync cursors, conflict handling, optimistic
local writes.

---

## Known bugs and rough edges

Including the ones I introduced this session and did not fix.

### Introduced or newly noticed in session 6

1. **Search covers five kinds and no more.** Rules, trips, travel legs, place
   visits and note versions are not searched. The five that are searched are
   exactly the five with a partial GIN index; adding a sixth means adding an
   index, which is a migration.
2. **Only `note_summary` has a surface.** `task_breakdown` and `weekly_review`
   have consent rows, disclosure text and `buildPrompt` support, and nothing
   calls them. The AI page runs the first one against a note and that is all.
   `ai_runs.entity_kind` is therefore always `'note'`.
3. **The AI result is carried on the URL.** What was sent and what came back
   are query parameters, so a long note makes a long URL and a refresh
   re-displays it. Nothing is persisted beyond the `ai_runs` row, which is
   deliberate; the URL is not.
4. **`ai_runs` records no token counts.** `input_tokens` and `output_tokens`
   are always null. Nothing counts tokens and a fabricated number would be
   worse.
5. **Search is capped at 30 per kind and 50 merged**, with a line saying so
   when a kind hits its cap. There is no pagination and no "next page".
6. **The snippet stemmer is crude and English-only.** It handles the plural,
   which is the case that matters; "geese" will not embolden "goose". It never
   decides what *matches*, only what to embolden, so the cost is cosmetic.
7. **Capture's space hint is one token.** `#work` resolves; a space whose name
   has a space in it cannot be hinted, only picked.
8. **A captured note gets a title and an empty body.** The line becomes the
   title; there is no way to capture a body.
9. **A captured event cannot carry a location, attendees or notes** — the same
   gap the compose bar has (rough edge 20 below).
10. **The capture parser's matcher order is fixed and regex-based.** An
    unrecognised phrase stays in the title, which is the right failure, but a
    phrase it half-recognises will consume half of itself. The chips make that
    visible, which is the whole mitigation.
11. **`pnpm smoke` now also leaves `ai_runs` rows behind** (one refusal, one
    answer, per run), on top of the existing one archived person, the connected
    fixture calendars, the imported school-term feed, the "Smoke private place"
    and a handful of `notification_deliveries`. All harmless, all cleared by
    `pnpm seed`. The task capture creates and the consent AI switches on are
    both put back, and the suite passes twice in a row — verified this session.
12. **`runAiFeature` reads every consent row on every run** rather than the one
    it needs. Three round trips per run at this data size; not close to
    mattering, and worth knowing about before it is.

### Carried over, still true

13. **Nothing runs a `schedule` rule on a schedule.** There is no background
    worker and adding one is a deployment decision, which is out of scope.
    Consciously accepted in writing (session 5).
14. **A rule's conditions and actions are appended and removed, never edited**,
    and never reordered. The action form is one select and one free-text box
    that means different things for different actions.
15. **The rules engine only knows about tasks**, and a sweep is capped at 500
    open tasks in one space, silently.
16. **`rule_runs` is never pruned.** Every dry run is a row holding a JSON
    summary of every task it considered.
17. **A trip has no detail page.** Its dates, title and notes cannot be edited
    after creation, and `travel_sessions.is_active` is written once and never
    updated. Accepted in writing in session 4.
18. **Derived journeys are re-derived on every render**, the derived mode is
    guessed from the distance and the guess is not remembered, and
    `estimateBetween()` swallows a provider failure without saying so on the
    screen. All three accepted in writing in session 4.
19. **A recurring event has one detail page for the whole series**, editing it
    changes every occurrence, and there is **no UI at all for creating a
    repeat**. Recurrence expansion re-runs on every render (bounded).
20. **The calendar pull window is fixed at −180/+365 days**, and **nothing
    pushes back**: only `'pull'` is ever written to
    `calendar_sync_state.direction`, and `events.is_dirty` is set and never
    cleared. **The compose bar cannot set an event's location, attendees or
    notes.**
21. **`switchUser` is impersonation by design.** Any seeded profile can be
    assumed with one click. **This build must not be exposed to a network you
    do not control.**
22. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
    routes are generated into `.next/types`. Also: a `redirect()` path built by
    concatenating strings loses its literal type — use one template literal.
23. **The Markdown subset has no tables, no images, no task lists.**
24. **The people list's "next date" is computed twice**, in SQL for the
    ordering and in TypeScript for the label, and neither is covered by Vitest.
25. **A person's category is resolved back from its *name*** on the detail
    page. The place page does the same thing, for the same reason.
26. **Contacts cannot be edited, only added and removed**; `is_primary` is
    never set from the UI.
27. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
    restarts it, or `service postgresql start` to keep the data. It died once
    mid-session and the app's error page said so, which is the intended
    behaviour.
28. **`pkill -f next-server` can match the shell running it**, which kills your
    own command with exit 144 and sometimes takes the server with it. Prefer
    `pgrep -f next-server | while read pid; do kill "$pid"; done`, start the
    server with `setsid nohup … & disown`, and if `pnpm start` logs
    `EADDRINUSE`, an old server is serving an old build and every check you run
    is testing yesterday's code.
29. **No linting.** Out of scope by instruction.
30. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`.

Fixed in session 6, previously listed here: nothing — session 5's list was
carried forward intact, with number 1 already accepted in writing and 2–7
either still open above or superseded.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 76/76 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 526 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 215 checks against the running app
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
| `AI_PROVIDER` | `fake` | `fake` \| `anthropic`. Anthropic needs `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` optional (defaults to `claude-opus-5`). Never run. |
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

**A five-minute demo:** as Priya, open **Search** and type `bins`. Nineteen
results across tasks, notes and events, every one with its space indicator and
a kind, and a line at the top saying three locked items were not searched —
because they have no plaintext to search. Untick everything but Notes and the
list narrows to two. Then **Capture**: type `a week on Tuesday call the dentist
!high` and press **Read it back**. It shows two chips — the date phrase
resolved to a real Tuesday, and the priority — and one sentence describing what
it will create. Create it, and land on the task with that due date. Then **AI**:
three features, all off, each saying what would leave the device, and the
provider named as `ai:fake` with a note that nothing leaves this machine. Pick a
note and press **Summarise it** — refused, because it is switched off. Switch it
on, run it again, and read what was sent beside what came back. Now pick the
🔒 locked note and run it: refused, with the reason, and the refusal is a row
in the log below. Switch to Danny — one AI consent, his own, and none of
Priya's. Switch to Sam — nothing at all, everywhere.

---

## Next three things, in order

1. **Phase 6 — sync and offline.** Sync cursors, conflict handling, optimistic
   local writes; test coverage second only to RLS. `sync_cursors` leaves the
   pgTAP ledger this phase, which means the seed has to write a row and the
   isolation cases have to be added (see how `ai_runs` did it this session —
   `supabase/tests/rls_isolation_test.sql` around the `a8a8a8a8-…` fixtures).
   Two Phase 2 gaps belong here: nothing pushes a local edit back to a provider
   (rough edge 20 — `events.is_dirty` is set and never cleared), and there is
   still no UI for creating a recurring event (rough edge 19).

2. **Finish the AI surface** (rough edge 2). `task_breakdown` and
   `weekly_review` already have consent rows, disclosure text and prompts; what
   they lack is a button. The task detail page is the obvious home for the
   first and Today for the second. `runAiFeature` is note-only today and would
   need a subject reader per kind — the shape is already there in
   `readNoteSubject`.

3. **The Phase 4 rough edges worth closing** (14–16), in this order: editing a
   condition in place rather than removing and re-adding it; a trip detail page
   while you are in the neighbourhood (rough edge 17); and, if a later phase
   ever gives Orbit somewhere to run background work, a scheduler so a
   `schedule` rule means what it says.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
