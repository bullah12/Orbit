# STATUS — handoff contract

Last rewritten: **session 8**, 2026-07-29. Branch:
`claude/orbit-rough-edges-qw12jt`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is: Orbit is finished, and session 8 made it better rather
than bigger.** Phases 0 through 6 are complete, every box in
`docs/phase-plan.md` is ticked, and the six completeness conditions are all
true — see **Is it done?** below, answered one at a time. There is no Phase 7
and inventing one is explicitly not the job.

Session 8 was a rough-edge session. Of the thirty-five entries it inherited it
**fixed six outright** — 1, 2, 11, 12, 15 and 18 — and **three in part**: 5 (the
outbox and cursors now agree; `SYNCABLE_FIELDS` is untouched), 10 (a rule the
builder cannot express is no longer silently narrowed, but still cannot be typed)
and 20 (the series is editable and one occurrence can be skipped; one
occurrence's *details* still cannot be edited). It added three small ones, and
fixed a real off-by-one bug in the recurrence builder that nobody had noticed.
**The list went 35 → 28.**

**Five commands are the whole truth about this repo.** All five were run at the
end of session 8 from a database rebuilt with `./scripts/db-reset.sh`, and all
five were green:

```
./scripts/db-test.sh   83/83 pgTAP assertions
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              637 Vitest tests in 13 files
pnpm smoke             337/337 against the running app     (needs pnpm start)
```

`pnpm smoke` was run **twice in a row without reseeding** after that rebuild and
passed both times, 337/337 each time. Every section that creates something
deletes it, switches something switches it back, or edits something edits it
back — including the four new ones.

---

## Is it done?

The brief's six conditions, each answered honestly.

1. **Every box in `docs/phase-plan.md` ticked, 0–6.** Yes — 56 boxes, none
   unticked. Four ticks were **rewritten** this session because the behaviour
   they describe changed: the travel and rules test-coverage lines, the "creating
   a recurring event" line (it now says creating *and editing*) and the sync
   coverage line. Two new ticked lines were added for behaviour that now runs.
2. **Every rough edge fixed or consciously accepted in writing.** Yes. Session
   7's 1–13 are each answered at the end of `docs/decisions-log.md` under
   "Accepted rather than fixed": **1, 2, 11 and 12 are fixed**, **5 and 10 are
   half fixed** with the remaining half stated, and the rest are accepted with a
   reason each. 14–35 were already accepted; **15** and **18** are now fixed.
3. **`./scripts/db-test.sh` green, with an isolation case for every table
   including "the outsider sees zero".** Yes — 83/83, unchanged. **No migration
   this session**, so no new table and no new assertions. Three tables remain in
   the known-empty ledger, all three deliberately unused with a paragraph each in
   the decisions log.
4. **Vitest covers what pgTAP cannot.** Yes — 637 tests, 42 of them new this
   session, every one added in the same commit as the module it covers. The new
   ones are the action-form spec table, `tripStanding` across both clock changes,
   `repeatFormFromRrule` in both directions, `occurrenceAt`, and device-label
   normalisation.
5. **Accessible.** Yes. Every page including the new `/travel/trip/[id]` passes
   the shared `labelAuditOn(page)` audit — the trip page was added to it — and
   the event and sync pages still pass after gaining controls. Both new forms
   carry real labels: the per-row action form keeps its words as accessible names
   so the row stays scannable. `tests/contrast.test.ts` still passes; no new
   colours were introduced.
6. **All five commands pass from a cold container following only "How to run".**
   Yes, verified at the end of this session from `./scripts/db-reset.sh` onwards.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **No migration this session.** Everything built used columns that already
  existed — including `recurrence_rules.exdates`, which migration 0010 added in
  Phase 2 and which nothing but the ICS importer had ever written. **Two
  extensions in eight sessions**; Phases 3–6 and now a rough-edge session all
  needed none.

**pgTAP — `./scripts/db-test.sh`, 83/83**
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** iterates
  `pg_tables` rather than a hand-written list, so a new table is covered the
  moment it exists.
- Unchanged this session — no new table, no new assertions, `select plan(83)`.
- The known-empty ledger is **three** tables: `attachments`,
  `person_relationships` and `space_invites`, all three deliberately unused with
  a paragraph each in `docs/decisions-log.md` (session 5). Do not reopen that.

**TypeScript tests — `pnpm test`, 637 Vitest tests in 13 files**
- `tests/rules.test.ts` (78, was 69) — **new: the action form's contract.** Every
  kind has a parameter spec; every choice the form offers is one `parseActions`
  accepts; `rawActionFrom` and `actionParamValue` are inverses for every kind; an
  empty days box is `NaN` and is refused by name rather than read as zero; a
  value from the wrong vocabulary is refused rather than coerced.
- `tests/travel.test.ts` (55, was 46) — **new: `tripStanding`.** Running,
  upcoming and past; whole days counted by midnights, so both the spring and
  autumn clock changes give the right number where 24-hour arithmetic does not;
  and it agrees with `sessionIsActive`, which is what the stored column was set
  from.
- `tests/recurrence.test.ts` (54, was 38) — **new: reading a rule back, and
  naming one occurrence.** Every repeat the builder can build round-trips
  unchanged; a `COUNT`, an ordinal `BYDAY`, a `BYMONTHDAY`, a `BYMONTH` and a
  non-Monday `WKST` each come back `null` rather than approximated; an occurrence
  is found at an instant the series really generates and refused a minute either
  side; an already-skipped instant is not an occurrence; the wall clock holds
  across the BST boundary. **One of these found a real bug** — see below.
- `tests/sync.test.ts` (59, was 51) — **new: device-label normalisation.**
  Whitespace collapsed so one browser cannot become two devices, idempotent,
  empty for whitespace-only, cut to length, and a user-agent suggestion that is
  always something a device row would accept.
- `tests/capture.test.ts` (99), `tests/search.test.ts` (50),
  `tests/calendar.test.ts` (42), `tests/format.test.ts` (42),
  `tests/integrations.test.ts` (47), `tests/smartlists.test.ts` (32),
  `tests/markdown.test.ts` (30), `tests/contrast.test.ts` (26),
  `tests/ai.test.ts` (23) — unchanged.

**A real bug the tests found.** `rruleFromForm` built `UNTIL` as
`'<endOn>T23:59:59.000Z'` — a **UTC** instant. During BST that is 00:59:59 the
next London morning, so a series repeating at 00:30 and told to stop on 31 August
produced one on 1 September, and the end date read back a day late. It is now the
end of the last *London* day, with a case that fails on the old behaviour. Found
by writing the round-trip test, not by looking.

**Smoke — `pnpm smoke`, 337 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. 58 checks are new this
session across four new sections.

| Acting as | Result |
|---|---|
| Priya | A rule's action is edited where it sits: the control changes with the kind, a value from the wrong vocabulary is not carried across, the edit lands in place and switches the rule off, and a days action gets a number box. A trip's own page renames, redates and annotates it in one save; a range ending before it starts is refused with a sentence and changes nothing; its journeys are untouched. A repeat is read back into the form pre-filled, changed to fortnightly and back, one occurrence skipped and put back, an instant the series never generates refused, and the repeat removed leaving the event alive. `/sync` says the queue is not tied to a device until the browser is named, then names it — stray whitespace normalised — and marks every row that is this browser. The browser's `online` event flushes a queued edit and says that is why; unticking *Work offline* on its own sends nothing |
| Danny (partner) | opens the trip in the space he shares; sees his own device and none of Priya's; sees the rules in the shared space |
| Sam Okafor (outsider) | **404** on the trip page — never a 403; no devices, no trips, no rules, and told so rather than shown an error |

**App — new this session**
- **A rule's action is edited where it sits.** `ACTION_PARAMS` says, per kind,
  which key of the action object the one box fills in and whether that key wants
  a choice, a number of days or a message; `RuleActionForm` renders the matching
  control and swaps it when the kind changes, and is reused per row. Editing one
  is structural like every other rule edit: it switches the rule off and clears
  its preview.
- **`/travel/trip/[id]` — a trip has its own page.** Title, dates, endpoints and
  notes editable; journeys listed with a space indicator each; notes rendered as
  Markdown; a range that ends before it starts refused with a sentence rather
  than by the check constraint. `travel_sessions.is_active` is now written from
  the dates at every write, and still read nowhere — `tripStanding()` derives it
  on every render, and the page says which of the two it is showing.
- **A repeat can be changed and removed, not only created.**
  `repeatFormFromRrule` reads a stored rule back into the builder and returns
  `null` for any rule the builder cannot express, in which case the page shows the
  rule in words and offers only to remove it.
- **One occurrence can be skipped and put back.** The first use of
  `recurrence_rules.exdates` from the UI. An occurrence is named by its own start
  instant on the URL — RFC 5545's RECURRENCE-ID, which the calendar block's key
  has carried since Phase 2 — and because that is a claim from the client,
  `occurrenceAt()` checks it against the expansion before anything is appended.
- **`/sync`'s two halves are the same device and say so.** A label in a cookie
  ties the browser's `localStorage` queue to one row in `devices` per space; the
  page defaults to this browser's device rather than `devices[0]`, marks its rows,
  and explains why one browser is several rows.
- **Coming back online sends the queue, once.** A listener on the browser's own
  `online` event. Not a retry ladder, and it does nothing while *Work offline* is
  ticked.

**App — Phases 0–6** (unchanged, all still green in smoke)
Today with the quiet "N events yesterday, no notes" row; eight smart lists;
tasks, notes with versions and Markdown, people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks,
recurrence expanded from one row plus an RRULE, ICS import, provider pull and
push; places with geocoding, visits and links; travel with trips and derived
journeys; the rules engine with its dry run, audit trail and notifications;
search across five kinds; local-only natural-language capture; AI off by default
with per-feature, per-space consent; `/sync` with its outbox, named conflicts and
per-device cursors.

---

## Stubbed / fixture-backed

**`src/lib/integrations/`.** Every `*_PROVIDER` variable genuinely selects an
implementation; the default is `fake` everywhere; an unknown value is a hard
error rather than a silent fall back. **Unchanged this session** — there is no
seventh interface and none was added.

| Interface | Fake (default, runs here) | Real |
|---|---|---|
| `CalendarProvider` | `calendar:fake` — pulls and pushes | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` — in-memory outbox | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` — deterministic, offline | `ai:anthropic` — **written, never run** |

**"Written, never run" means exactly that.** No real provider here has ever sent
a request: there is no credential and no network. **Do not describe one as
working, and do not let a fake stand in for one in a "Works" claim.**
`GoogleCalendarProvider.pushEvent` is still the sharpest example — its
conditional `If-Match` write and its 412 handling have never executed, and this
session added nothing to it.

Also still fixture-backed or absent:
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation; the cookie is unsigned despite `AUTH_COOKIE_SECRET` existing.
  The new `orbit_device` cookie is unsigned on the same terms — it names a
  device, not a permission.
- **Locked items** are modelled and enforced end to end in the database, in the
  rules engine, in the AI gate and in the conflict resolver, but there is **no
  client-side crypto**. The UI refuses to show or edit them.
- **There is no scheduler.** A `schedule` rule runs when somebody presses "Run
  now, for real". This is also why `travel_sessions.is_active` is a cache the app
  does not trust.
- **There is no service worker.** "Work offline" is a switch somebody flicks, not
  a connection the browser noticed dropping, and the page says so in those words.
  The `online` listener added this session is a real browser event, but it can
  only fire when the browser genuinely regains a network — it has nothing to do
  with the switch.

---

## Not started

Nothing. Phases 0–6 are all complete.

---

## Known bugs and rough edges

Renumbered. **28 entries, down from 35.** Fixed this session: session 7's **1**,
**2**, **11**, **12**, the dangerous half of **10**, and carried-over **15** and
**18**. Half fixed: **5** (an offline surface still exists only on a task) and
**20** (the series is editable; one occurrence's *details* still are not).
Introduced this session: **1** below, and a slightly larger smoke residue (**27**).

### Introduced or newly noticed in session 8

1. **Naming a browser writes a device row per writable space, and there is no way
   to delete one.** Three rows for one laptop is what a space-scoped cursor
   requires, and the page says so, but a browser you stop using leaves its rows
   behind for ever. `devices.revoked_at` exists and nothing sets it; there is no
   "forget this device" button.
2. **Editing one occurrence's *details* is not built.** It is EXDATE plus a new
   one-off event, and the four questions that stopped it are written out in the
   decisions log so the next session does not re-derive them. Skipping and
   restoring an occurrence *is* built; changing just Tuesday's time is not, and
   the page tells you to skip it and add an ordinary event.
3. **A trip's journeys are not re-checked against its dates.** Change a trip to a
   week later and its journeys stay where they were; the page says the journeys
   are untouched, which is the honest behaviour, but nothing offers to move them.

### Carried over from session 7, still true

4. **A conflict is dismissible, and dismissing it loses the edit.** The button
   says so and nothing is written, but there is no undo and no record. The same
   is true of "Discard" on a queued edit. **This is the one with the most teeth.**
5. **The queue survives a user switch.** Switching to Danny leaves Priya's unsent
   edits in the same `localStorage`; sending them fails on Danny's policies, which
   is *correct* but reads as a confusing error. Slightly better than it was — the
   device section now names the browser — but the queue still records no profile.
6. **`SYNCABLE_FIELDS` is narrower than the forms.** A task's due date, category
   and assignee cannot be edited offline; only the six listed columns can. **Only
   `/tasks/item/[id]` has an offline surface at all** — a note body does not, and
   it is the field somebody is most likely to be typing when the connection goes.
7. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.** No
   pagination.
8. **`applyWrite` interpolates column names with `tx.unsafe`.** Every name comes
   from the closed `SYNCABLE_FIELDS` list and is re-checked in the server action
   before a query is built, and every *value* is a bound parameter — but it is the
   shape that would be an injection if the list were ever opened up.
9. **The push window is every dirty event, capped at 200, oldest first**, and
   nothing says so on the screen.
10. **A push does not delete.** An event deleted locally is gone here and stays on
    the provider. `pushEvent` has no delete verb. **The other one with teeth.**
11. **The repeat builder still cannot type "the third Thursday", nor a `COUNT`.**
    Both parse and expand correctly, and a rule using one is now shown in words
    and left alone rather than silently narrowed — but there is still no way to
    *enter* one.
12. **The weekly review reads seven days from `now()`**, not the week Today is
    showing, and there is no way to choose. It silently caps at 40 events and 40
    tasks.

### Carried over from earlier, still true

13. **Nothing runs a `schedule` rule on a schedule.** No background worker; adding
    one is a deployment decision, out of scope. Accepted (session 5).
14. **A rule's conditions and actions are never *reordered*.** Each can now be
    edited where it sits (conditions in session 7, actions in session 8), but
    there are no up/down controls. For actions this matters more than for
    conditions, because actions are applied in order.
15. **The rules engine only knows about tasks**, and a sweep is capped at 500 open
    tasks in one space, silently.
16. **`rule_runs` is never pruned.**
17. **Derived journeys are re-derived on every render**, the derived mode is
    guessed from the distance and not remembered, and `estimateBetween()` swallows
    a provider failure without saying so on screen. Accepted (session 4).
18. **The calendar pull window is fixed at −180/+365 days**, and **the compose bar
    still cannot set an event's location, attendees or notes**.
19. **`switchUser` is impersonation by design.** Any seeded profile can be assumed
    with one click. **This build must not be exposed to a network you do not
    control.**
20. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed routes
    are generated into `.next/types`. Also: a `redirect()` path built by
    concatenating strings loses its literal type — use one template literal.
21. **The Markdown subset has no tables, no images, no task lists.**
22. **The people list's "next date" is computed twice**, in SQL and in TypeScript,
    and neither is covered by Vitest.
23. **A person's category is resolved back from its *name*** on the detail page.
    The place page does the same thing.
24. **Contacts cannot be edited, only added and removed**; `is_primary` is never
    set from the UI.
25. **Search covers five kinds and no more**, capped at 30 per kind and 50 merged,
    with a crude English-only stemmer for highlighting. Accepted.
26. **Capture's space hint is one token**, a captured note gets an empty body, a
    captured event carries no location, and the parser's matcher order is fixed.
27. **The AI result is carried on the URL**, on three pages. `ai_runs` records no
    token counts, and `runAiFeature` reads every consent row on every run.
28. **Environment and tooling**, all four accepted by instruction or by nature:
    Postgres does not survive container restarts (`./scripts/db-reset.sh` restarts
    it, or `service postgresql start` to keep the data); `pkill -f next-server` can
    match the shell running it and kill your own command with exit 144 — use
    `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done`, note the
    bracket; there is no linting, out of scope by instruction; and `pnpm smoke`
    needs a running server plus Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with
    `CHROMIUM_PATH`).

**About what `pnpm smoke` leaves behind.** Everything it *creates* it deletes,
and it passes twice in a row — but it leaves `ai_runs` rows, a
`calendar_sync_state` push row, the fixture calendars it connects, and now a
`devices` row in Priya's Work space from naming the browser. All harmless, all
cleared by `pnpm seed`. **Two things to know before you touch the AI or repeat
sections:** a crashed run can leave an AI consent switched on, and the next run
then fails a different assertion for a confusing reason (`pnpm seed` puts it
right); and a crashed run can leave a `Smoke repeat …` event in August, which
crowds the month grid and makes the *next* run's occurrence counts wrong.
`delete from events where title like 'Smoke%'` — as `orbit_seed` — or `pnpm seed`.

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
pnpm test                      # 637 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 337 checks against the running app
```

Start the server so it survives the shell that launched it:

```sh
setsid nohup pnpm start > /tmp/next.log 2>&1 < /dev/null & disown
```

Stop it without killing your own shell:

```sh
pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done
```

If `pnpm start` logs `EADDRINUSE`, an old server is still serving an old build
and every check you run is testing yesterday's code.

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

Two cookies, both unsigned, both dev-only affordances: `orbit_user` names the
seeded profile you are acting as, and `orbit_device` names which device this
browser is. Neither is a permission — every write goes through `asUser` and the
policies decide.

Three Postgres roles, deliberately separated: `orbit_app` (the app, fully
policy-bound), `orbit_seed` (BYPASSRLS, seeds only), `postgres` (owner,
migrations and tests).

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

**A five-minute demo of what session 8 added.**

Open **Rules** → *Bins go to Danny*. Every action now carries its own form, and
the box knows what it is: change *Notify me* to *Set the priority* and the free
text becomes a list of priorities, with nothing carried over from the old
vocabulary. Save it — the rule switches off and its preview clears, because that
is a structural edit like any other.

Open **Travel** and click a trip's name. It has a page now: rename it, move its
last day, write a note, save. The header says where the trip stands, worked out
from the dates every time rather than read from a column. Try setting the last day
before the first — a sentence, not a 500.

Open **Calendar → month**, click any occurrence of a repeating event. The URL
names *which* occurrence. Its page reads the stored rule back into the builder,
pre-filled; make it fortnightly and watch the month thin out; change it back. Then
press **Skip** on the occurrence you arrived from — it disappears from the
calendar, the series says one occurrence is skipped, and the same link now offers
to put it back. Nothing was deleted: an occurrence is not a row.

Open **Sync**. It says the queue is not tied to a device yet. Name the browser
*Priya — laptop* and the heading above becomes that name, three device rows get a
"this browser" chip, and the page explains that one browser is one row per space
because a cursor is space-scoped. Then tick **Work offline**, retitle a task, come
back, untick it — nothing sends — and in the console run
`window.dispatchEvent(new Event('online'))`: the queue goes, and the page says it
went because you came back online.

---

## Next three things, in order

Orbit is finished. What is left is the rough-edge list above, in the order they
are worth doing.

1. **An offline surface on notes, and `SYNCABLE_FIELDS` widened to match the
   forms** (edge 6). The narrowest useful next step and the one the last two
   briefs have both named: a note body is the field somebody is most likely to be
   typing when the connection goes, and only `/tasks/item/[id]` has an offline
   surface at all. Widening the list is cheap; **widening it without a smoke check
   per new field is not**, and that is the part to budget for.
2. **A dismissed conflict should leave a record** (edge 4). Both "Discard" and
   dismissing a conflict throw away somebody's typing with no undo and no trace.
   This one probably *does* need a migration — an outbox history table — which
   makes it the first thing in nine sessions that might, so read the migration
   rules in the brief before you start and write down why the alternative did not
   work. If you decide against the table, the fallback is to make dismissing
   two-step and say in the log why a record was not worth a table.
3. **A push that deletes** (edge 10). An event deleted locally stays on the
   provider for ever. `pushEvent` has no delete verb; adding one touches the
   interface, the fake and the Google implementation, and the Google half will be
   **written, never run** like the rest of it — say so plainly and do not let the
   fake stand in for it.

After those, edge **1** (no way to forget a device — `devices.revoked_at` exists
and nothing sets it) is small, self-contained and closes something this session
introduced.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, keep `docs/phase-plan.md` accurate,
append to `docs/decisions-log.md`, and push. The container is ephemeral. Push at
least hourly.
