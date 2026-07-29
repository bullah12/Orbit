# STATUS — handoff contract

Last rewritten: **session 7**, 2026-07-29. Branch:
`claude/orbit-phase-6-lqnx20`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is: Orbit is finished.** Phases 0 through 6 are all
complete and shippable, and every box in `docs/phase-plan.md` is ticked. The
six completeness conditions in the brief are all true — see **Is it done?**
below, which goes through them one at a time.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 7 and all five were green:

```
./scripts/db-test.sh   83/83 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              595 Vitest tests in 13 files
pnpm smoke             279/279 against the running app     (needs pnpm start)
```

`pnpm smoke` was run **twice in a row without reseeding** after that rebuild
and passed both times. The three sections added this session all put things
back: sync creates one task and deletes it, the calendar section edits an event
and edits it back, and the AI section switches two consents on and off again.

---

## Is it done?

The brief's six conditions, each answered honestly.

1. **Every box in `docs/phase-plan.md` ticked, 0–6.** Yes. Phase 6's seven
   boxes were ticked this session against things that were run and watched.
2. **Every rough edge fixed or consciously accepted in writing.** Yes. Session
   6's numbers 1–12 are answered at the end of `docs/decisions-log.md`: **2**
   is fixed (the AI surface is finished), the rest are accepted with a reason
   each. 13–30 were already accepted; **19** and **20** are now fixed, and what
   remains of 20 is stated below.
3. **`./scripts/db-test.sh` green, with an isolation case for every table
   including "the outsider sees zero".** Yes — 83/83. `sync_cursors` left the
   known-empty ledger this session; three tables remain in it, all three
   deliberately unused with a paragraph each in the decisions log.
4. **Vitest covers what pgTAP cannot, including sync and conflict handling.**
   Yes. `tests/sync.test.ts` is 51 cases written before any UI, and it was the
   one gap the brief kept naming.
5. **Accessible.** Every page including `/sync` passes the shared
   `labelAuditOn(page)` audit, dialogs and live regions are in place, and
   `tests/contrast.test.ts` still passes in both themes.
6. **All five commands pass from a cold container following only "How to
   run".** Yes, verified this session from `./scripts/db-reset.sh` onwards.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **No migration this session.** `sync_cursors`, `devices` and
  `calendar_sync_state` already had every column Phase 6 wanted. The decision
  that kept it that way is that a replay is detected by comparing values rather
  than by an idempotency table — see the decisions log. Fourth phase in a row
  that extended nothing; two extensions in seven sessions total.

**pgTAP — `./scripts/db-test.sh`, 83/83**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list.
- **New this session (7 assertions):** the partner sees the sync cursor and the
  device in the space they share and neither of the ones in Alice's own; a
  free/busy participant sees no cursors and no devices, because how far a
  device has caught up is more than "busy"; and the partner can neither write a
  cursor into a space they are not in, nor register a device there, nor drag an
  existing cursor forward there.
- The known-empty ledger is down to **three** tables. `sync_cursors` left it
  this session — the seed writes 15 rows, deliberately two days behind.
  `attachments`, `person_relationships` and `space_invites` **stay unused on
  purpose**, a paragraph each in `docs/decisions-log.md`.

**TypeScript tests — `pnpm test`, 595 Vitest tests in 13 files**
- `tests/sync.test.ts` (51) — **new, and written before any UI.** The clean
  apply; a per-field merge; a field both sides changed held as a conflict with
  both values kept; deleted, locked and moved-space refused *before* any field
  is compared, in that order; a replay counted as a duplicate; a queue ordered
  by its own sequence; a device rebased so it cannot conflict with itself; and a
  clock three hours out changing no outcome at all.
- `tests/recurrence.test.ts` (38, was 26) — adds `rruleFromForm`: what it
  builds, what it refuses, and that its `UNTIL` keeps the occurrence on the day
  it was told to stop.
- `tests/integrations.test.ts` (47, was 41) — adds the provider's write side:
  create versus update, a fresh etag every time, a read-only calendar refused.
- `tests/rules.test.ts` (69), `tests/capture.test.ts` (99),
  `tests/search.test.ts` (50), `tests/travel.test.ts` (46),
  `tests/format.test.ts` (42), `tests/calendar.test.ts` (42),
  `tests/smartlists.test.ts` (32), `tests/markdown.test.ts` (30),
  `tests/ai.test.ts` (23), `tests/contrast.test.ts` (26) — unchanged.

**Smoke — `pnpm smoke`, 279 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. 64 checks are new
this session across three new sections and one extended one.

| Acting as | Result |
|---|---|
| Priya | `/sync` lists her devices and cursors with a space indicator on every row and a locked row shown as locked. Going offline, retitling a task, reloading: the edit is on the screen, marked not sent, and the server still holds the old title. Sending it applies it. Queuing a second edit and then moving the row underneath it with the ordinary form produces a **conflict** naming both versions; the server is unchanged until it is answered; "Keep theirs" resolves it. A calendar edit leaves "1 local edit waiting to go back", pushing it records a **push** and clears it. An event created with a weekly repeat is drawn on every occurrence; one that stops before it starts is refused with a sentence. A task offers to be broken into steps — refused while off, answered once on. Today offers a weekly review per space, same sequence |
| Danny (partner) | sees his own device and none of Priya's; one AI consent, his own |
| Sam Okafor (outsider) | no devices at all, and is told so rather than shown an error |

**App — Phase 6, new this session**
- **`/sync`** — two halves. The top is this browser's queue: what it has not
  sent, the conflicts that came back, and both answers, rendered from
  `localStorage` because that is where an unsent edit genuinely is. The bottom
  is the server's: devices, a cursor per kind, what has changed since, "Mark
  caught up" and "Rewind to the beginning". Space indicator on every row of
  both halves.
- **Optimistic edits on a task** — title, status, priority and *waiting on*.
  With **Work offline** on, an edit applies on the screen straight away, is
  marked *not sent yet*, survives a reload, and waits. With it off, it is sent
  as it is made. Verified in the running app, including the reload.
- **Conflicts are named, never silently resolved.** Both values are shown side
  by side with what they both started from, the fields that merged cleanly are
  named as landing either way, and nothing is written until somebody answers.
- **A push back to the provider** — `/calendar/import` now says how many local
  edits are waiting to go back per calendar, pushes them, and records the run
  as `direction = 'push'`. `events.is_dirty` is finally cleared.
- **A repeat can be created from the UI** — daily / weekly on chosen days /
  monthly / yearly, every N, until a date. Still one row plus an RRULE.
- **The AI surface is finished** — *Break it into steps* on a task, *Review the
  week ahead* on Today (once per space). Both refused while off, both recorded
  either way.

**App — Phases 0–5** (unchanged, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row; eight smart lists;
tasks, notes with versions and Markdown, people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks,
recurrence expanded from one row plus an RRULE, ICS import and provider pull;
places with geocoding, visits and links; travel with trips and derived
journeys; the rules engine with its dry run, audit trail and notifications;
search across five kinds; local-only natural-language capture; AI off by
default with per-feature, per-space consent.

---

## Stubbed / fixture-backed

**`src/lib/integrations/`.** Every `*_PROVIDER` variable genuinely selects an
implementation; the default is `fake` everywhere; an unknown value is a hard
error rather than a silent fall back.

| Interface | Fake (default, runs here) | Real |
|---|---|---|
| `CalendarProvider` | `calendar:fake` — now pulls **and pushes** | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` — in-memory outbox | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` — deterministic, offline | `ai:anthropic` — **written, never run** |

**"Written, never run" means exactly that.** No real provider here has ever
sent a request: there is no credential and no network. **Do not describe one as
working, and do not let a fake stand in for one in a "Works" claim.**
`GoogleCalendarProvider.pushEvent` is the newest example — its conditional
`If-Match` write and its 412 handling have never executed.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
- **Locked items** are modelled and enforced end to end in the database, in the
  rules engine, in the AI gate and now in the conflict resolver, but there is
  **no client-side crypto**. The UI refuses to show or edit them.
- **There is no scheduler.** A `schedule` rule runs when somebody presses "Run
  now, for real".
- **There is no service worker.** "Work offline" is a switch somebody flicks,
  not a connection the browser noticed dropping, and the page says so in those
  words.

---

## Not started

Nothing. Phases 0–6 are all complete.

---

## Known bugs and rough edges

Including the ones I introduced this session and did not fix.

### Introduced or newly noticed in session 7

1. **The outbox is one browser's, not one device's.** `localStorage` is scoped
   to the browser profile, so two tabs share a queue (which is correct) and two
   browsers on one machine have two (which is arguably not). Nothing ties the
   queue to a row in `devices`; the cursors half of `/sync` is per device and
   the queue half is per browser, and the page does not say so.
2. **Nothing flushes the queue automatically.** Going back online does not
   send: somebody presses the button. There is no `online` event listener and no
   retry, deliberately for the retry, less deliberately for the listener.
3. **A conflict is dismissible, and dismissing it loses the edit.** The button
   says so and nothing is written, but there is no undo and no record. The same
   is true of "Discard" on a queued edit.
4. **The queue survives a user switch.** Switching to Danny in the sidebar
   leaves Priya's unsent edits in the same `localStorage`; sending them then
   fails on Danny's policies, which is *correct* but reads as a confusing error
   rather than "these are not yours". The dev switcher is impersonation by
   design (edge 22 below), so this is a rough edge of that rough edge.
5. **`SYNCABLE_FIELDS` is narrower than the forms.** A task's due date, its
   category and its assignee cannot be edited offline; only the six listed
   columns can. A note's body can, an event's location can, and nothing else
   has an offline surface at all — only `/tasks/item/[id]` renders one.
6. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.**
   No pagination. A device more than 40 changes behind sees "40+" and has to
   catch up in one go, which is what "Mark caught up" does anyway.
7. **`applyWrite` interpolates column names with `tx.unsafe`.** Every name comes
   from the closed `SYNCABLE_FIELDS` list and is re-checked in the server action
   before a query is built, and every *value* is a bound parameter — but it is
   the shape that would be an injection if the list were ever opened up.
8. **The push window is every dirty event, capped at 200, oldest first.** A
   calendar with more than 200 local edits needs two presses, and nothing says
   so on the screen.
9. **A push does not delete.** An event deleted locally is gone here and stays
   on the provider. `pushEvent` has no delete verb.
10. **The repeat builder cannot express "the third Thursday".** `BYDAY` with an
    ordinal is parsed and expanded correctly — an imported rule using it works —
    but there is no way to *type* one. Nor `COUNT`; only an end date.
11. **A repeat can only be set when an event is created.** The event detail page
    still edits the whole series and cannot add, change or remove a repeat.
12. **The weekly review reads seven days from `now()`**, not the week Today is
    showing, and there is no way to choose. It also silently caps at 40 events
    and 40 tasks.
13. **`pnpm smoke` leaves more behind than it used to**: `ai_runs` rows for all
    three features, a `calendar_sync_state` push row, and the fixture calendars
    it connects. All harmless, all cleared by `pnpm seed`, and everything it
    *creates* it deletes — verified twice in a row.

### Carried over, still true

14. **Nothing runs a `schedule` rule on a schedule.** No background worker;
    adding one is a deployment decision, out of scope. Accepted (session 5).
15. **A rule's conditions and actions are never reordered.** A *condition* can
    now be edited where it sits (fixed this session); an **action** still
    cannot — `updateAction` and `editRuleActionAction` exist and are wired to
    nothing, because the action form is one select plus one free-text box that
    means a different thing per kind, and repeating that per row would need the
    form rebuilding first.
16. **The rules engine only knows about tasks**, and a sweep is capped at 500
    open tasks in one space, silently.
17. **`rule_runs` is never pruned.**
18. **A trip has no detail page.** Its dates, title and notes cannot be edited
    after creation. Accepted in writing in session 4.
19. **Derived journeys are re-derived on every render**, the derived mode is
    guessed from the distance and not remembered, and `estimateBetween()`
    swallows a provider failure without saying so on screen. Accepted (session 4).
20. **A recurring event has one detail page for the whole series** and editing
    it changes every occurrence. Creating a repeat now has a UI; editing one
    does not (edge 11 above). Expansion re-runs on every render (bounded).
21. **The calendar pull window is fixed at −180/+365 days**, and **the compose
    bar still cannot set an event's location, attendees or notes**. The rest of
    old edge 20 — nothing pushing back — is fixed this session.
22. **`switchUser` is impersonation by design.** Any seeded profile can be
    assumed with one click. **This build must not be exposed to a network you
    do not control.**
23. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
    routes are generated into `.next/types`. Also: a `redirect()` path built by
    concatenating strings loses its literal type — use one template literal.
24. **The Markdown subset has no tables, no images, no task lists.**
25. **The people list's "next date" is computed twice**, in SQL and in
    TypeScript, and neither is covered by Vitest.
26. **A person's category is resolved back from its *name*** on the detail page.
    The place page does the same thing.
27. **Contacts cannot be edited, only added and removed**; `is_primary` is never
    set from the UI.
28. **Search covers five kinds and no more**, capped at 30 per kind and 50
    merged, with a crude English-only stemmer for highlighting. Accepted.
29. **Capture's space hint is one token**, a captured note gets an empty body, a
    captured event carries no location, and the parser's matcher order is fixed.
    Accepted; the chips make each visible.
30. **The AI result is carried on the URL** — now on three pages. Nothing is
    persisted beyond the `ai_runs` row, which is deliberate; the URL is not.
    `ai_runs` still records no token counts, and `runAiFeature` still reads
    every consent row on every run. All accepted in writing.
31. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
    restarts it, or `service postgresql start` to keep the data.
32. **`pkill -f next-server` can match the shell running it**, which kills your
    own command with exit 144. Prefer
    `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done` — note the
    bracket, without it the pattern matches your own command line — start the
    server with `setsid nohup … & disown`, and if `pnpm start` logs
    `EADDRINUSE`, an old server is serving an old build.
33. **No linting.** Out of scope by instruction.
34. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`.
35. **A crashed `pnpm smoke` can leave an AI consent switched on.** The suite
    switches consents on and back off; a failure in between leaves one on, and
    the next run then fails a different assertion for a confusing reason.
    `pnpm seed`, or `update public.ai_feature_consents set is_enabled = false`,
    puts it right.

Fixed in session 7, previously listed here: **2** (only `note_summary` had a
surface), **19** in part (no UI for creating a repeat), **20** in part (nothing
pushed a local edit back to a provider), and **14** in part (a rule's
conditions could only be removed and re-added at the end).

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 83/83 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 595 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 279 checks against the running app
```

Start the server so it survives the shell that launched it:

```sh
setsid nohup pnpm start > /tmp/next.log 2>&1 < /dev/null & disown
```

Stop it without killing your own shell:

```sh
pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done
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
| `AI_PROVIDER` | `fake` | `fake` \| `anthropic`. Anthropic needs `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` optional. Never run. |
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

**A five-minute demo of Phase 6:** as Priya, open a task in **Home**. Tick
**Work offline** and retitle it in the *Edit, offline or not* panel — the new
title is on the screen at once, with a chip saying it has not been sent, and
the heading above still shows the old one because that is what the server
holds. Reload: the edit is still there. Open **Sync** — one edit waiting, with
its space indicator — and press **Send**. It applies.

Now do it again, but before sending, change the same title with the ordinary
form higher up the page. Send: a **conflict**, naming your version, theirs, and
what you both started from, with the sentence "nothing has been overwritten".
Open the task — it still says theirs. Answer **Keep theirs** and it stays that
way; **Keep mine** would have written yours. Neither happened until you said so.

Then **Mark caught up** on the device and the "changed since" list empties;
**Rewind to the beginning** and it fills again. Switch to Danny — his phone,
none of Priya's devices. Switch to Sam — nothing at all.

---

## Next three things, in order

Orbit is finished. There is no Phase 7 and inventing one is explicitly not the
job. What is left is the rough-edge list above, in the order they are worth
doing:

1. **Editing a rule's *actions* in place** (edge 15) — the query and the server
   action are already written and wired to nothing; what is missing is a form
   whose one free-text box knows which parameter it is setting. Then **a trip
   detail page** (edge 18), plain missing UI over data that already exists.
2. **Editing a repeat, not only creating one** (edges 11 and 20). The builder
   and the parser both exist; what is missing is reading an existing rule back
   into the form, and the harder half — "this occurrence" versus "the series" —
   which is a real design question worth writing down before it is built.
3. **The sync rough edges worth closing** (1–5): tie the outbox to a device row
   so the two halves of `/sync` agree; flush on the browser's `online` event;
   and put an offline surface on notes, since a note body is the field somebody
   is most likely to be typing when the connection goes.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
