# STATUS — handoff contract

Last rewritten: **session 12**, 2026-08-08. Branch:
`claude/brief-c-settings-offline-shell-0l1q6x`.

**Corrected in session 14, 2026-08-09**, on `claude/orbit-docs-refresh`, without
rewriting: **Orbit is deployed on Vercel against a real Supabase project and
`AUTH_PROVIDER=supabase` is the provider serving it.** The sections below that
said otherwise are fixed in place and each correction is marked. This file has
not been rewritten since session 12, so **its counts are session 12's**; session
13's are noted beside them. Nothing else was upgraded: every provider still
without a credential is *written, never run*, and the Android client is unbuilt.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/design-review.md`, then `docs/decisions-log.md`, then get the
database up and pick from **Next three things** at the bottom.

**Where the project is: Orbit was finished at the end of session 8, made usable
by a real person in session 9, made usable *on a phone* in session 10, and given
its settings surface and its offline shell in session 12.** Session 12 was Brief
C from `docs/remaining-work.md` §4. Brief C added **no table and no
migration** — the one expected for edge 7 was argued down rather than skipped,
and the argument is in `docs/decisions-log.md`. A **second pass** then closed
the four things worth doing before a deployment, and that one *did* need a
migration: `0013_free_busy_recurrence.sql`, for edge 35.

**The one sentence worth carrying forward from this session:** the offline work
was built on the rule that no page rendered for one person may ever be stored,
and then the smoke run found the browser's own HTTP cache re-serving
`/tasks/all` complete — sidebar, counts, every row — with the network disabled.
The service worker had cached nothing. It called `fetch()`, and `fetch()` was
answered from disk. That was not on any edge list, and it was only found because
the check drives a real browser with the network really off rather than
asserting that a file exists.

**Five commands were the whole truth about this repo.** All five were run at the
end of session 12, and all five were green:

```
./scripts/db-test.sh   112/112 pgTAP assertions   (was 106; migration 0013)
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              816 Vitest tests in 21 files   (was 735)
pnpm smoke             455/455 against the running app   (was 402; needs pnpm start)
```

**Corrected in session 14.** Two things have moved since that block was written.

*The counts are out of date*, because session 13 added three migrations
(0014–0016) and did not rewrite this file. Its recorded figures:
`./scripts/db-test.sh` **175/175**, `pnpm test` **828**, `pnpm smoke`
**455/455**, build and typecheck clean.

*The rule changed.* `CLAUDE.md` is now the authority on what to run: **`pnpm
build` then `pnpm smoke`**, and nothing else unless asked. `pnpm build`
type-checks, so a separate `pnpm typecheck` is redundant on a change that
builds; `./scripts/db-test.sh` and `pnpm test` cover what smoke structurally
cannot see — policies and definer functions, and the pure modules in
`src/lib/` — and are run on request. Session 14 ran `pnpm build` (clean) and
`pnpm smoke` in full (**456/456**, one more than session 13 recorded) and did
not run the other three. It changed no behaviour — two doc comments in
`src/lib/auth/` that still said this provider had never run, and documents.

`pnpm smoke` was also run **twice in a row without a reseed**, which is edge 3's
standing rule, and passed both times.

**One migration was written**, `0013_free_busy_recurrence.sql`, in the second
pass — the first schema change since 0012. Brief C itself needed none.

---

## Where the tables are

**Orbit's tables live in the `orbit` schema, not `public`**, and its helper
functions and RLS generator in `app`. That is what lets Orbit share a Postgres
instance with another application: `profiles` alone exists in both, and two
applications in one schema is a collision waiting to happen.

Every reference in the repository is schema-qualified — `orbit.tasks`, never a
bare `tasks` — so this is the name of the objects and not a `search_path` a
different connection could resolve differently. `scripts/db-reset.sh` builds the
local database the same way, so the tested shape and the deployed shape are the
same shape.

Moved in session 12's third pass; the decisions log records the three things
that say `public` and are *not* the schema, each of which had to be left alone.

---

## The one thing to understand before you touch anything

**Corrected in session 14. This section said `AUTH_PROVIDER=supabase` had never
run. It has.**

**Orbit is deployed on Vercel against a real Supabase project, and
`AUTH_PROVIDER=supabase` is the provider serving it.** The claim that there is
no project and no credential was true for four sessions and is now false. It was
already falsified inside this repository before session 14 said so: two of
session 13's bugs were **reported from a real project**, one of them naming a
real account id, and migrations 0014–0016 exist because of them.

**What has run, and what has not.** Signing in has run — that is what produced
those reports — and so has the profile/adoption path underneath it. Nobody has
yet watched **the refresh path**, a **magic link**, a sign-up with email
confirmation on, or **an invitation redeemed by a second real account**. The
refresh path is the one this file has named for four sessions as most likely to
be wrong, and it is still unwatched.

So the honest label is **running in production, not acceptance-tested** — which
is neither "never run" nor "works". `docs/remaining-work.md` §5 is the prompt
for the session that closes the gap, and §6 of
`docs/deployment-and-android.md` lists what is left by hand.

**Nothing else moved with it.** `calendar:google`, `ics:http`,
`geocoding:nominatim`, `travel:openrouteservice`, `push:webpush` and
`ai:anthropic` are still *written, never run* — a deployment is not a
credential — and the Android client is still unbuilt.

---

## Works — verified by running it

Everything here was executed and watched.

### New in session 12

**The theme can be pinned, and the choice arrives before the first paint.**
`/settings` offers system, light or dark. The server reads a cookie and writes
`<html data-theme>`, so the correct palette is resolved by the browser on its
first parse — there is deliberately no `useEffect`, no inline script and no
`localStorage` read, because each of those runs *after* something has been
painted, which is the flash. Watched in a real browser: with the OS in light
mode, pinning dark yields `data-theme="dark"` in the raw server HTML and a body
background of `oklch(0.165 0.008 265)`.

**`globals.css` is one palette now, not two.** The `globals.css` decision that
blocked this since session 10 was made on purpose: **`light-dark()`**, as
`docs/design-review.md` recommended. All 42 colour tokens hold both values in
one declaration and both `@media (prefers-color-scheme: dark)` blocks are gone,
so the override is two `color-scheme` lines and there is no second copy of the
palette to drift.

- **The conversion was generated and verified, not typed.** One script emitted
  the merged declarations from the old file; a second read them back out of the
  new one and compared. 42 pairs, identical, no token left as a single value.
- **The dark-value comments were carried across**, as a block above the merged
  tokens, rather than dropped.
- **`tests/contrast.test.ts` still computes real WCAG ratios for both themes.**
  The brace-matching is gone, as the review predicted, and three new guards
  replace it — because the failure mode inverted. A parse that returned the same
  half twice would compute every ratio and pass every assertion while silently
  checking one theme twice. So: the two halves must differ, no token may escape
  the pair, and no media query may redeclare a colour. **Mutation-tested** —
  making the parse return the light half for both turns it red.

**`/settings` exists, under More beside Rules, Sync and AI.** Administrative, so
not beside Today. Built from existing tokens with no new colour.

- **Theme**, above.
- **Week start**, Monday or Sunday. Display only, and that is enforced by
  construction: `WKST` is an RFC 5545 property of the *rule* and decides which
  occurrences a weekly rule has, so recurrence never sees this preference. The
  test asserts the consequence — the same rule expands identically under both
  settings, while `WKST` in the rule text genuinely changes it.
- **Default compose space**, re-validated against the caller's writable spaces
  on every read, so the cookie is a hint and never a capability.
- **Devices**, with revoke and restore.

**Edge 4 is closed: `devices.revoked_at` has its first ever write.** It has
existed since migration 0001 with nothing writing it. What makes revoking more
than a label is that `advanceCursor` refuses to move a revoked device's cursor,
written as a guarded insert so the `on conflict do update` is skipped too. The
smoke run asserts it **with a control beside it** — an active device advances
(`01/01/1970` → `just now`) and a revoked one does not (`01/01/1970` →
`01/01/1970`). Without the control, a cursor that never moved would pass for
free.

**Edge 33 is closed: there is a service worker, and it caches no page anybody
rendered.** Shell only, and the restriction is the design rather than a
limitation of it.

- A navigation is **network-only**, falling back to `/offline`. What is cached
  is `/offline`, the manifest and `/_next/static/` — content-hashed, immutable,
  nobody's data.
- **`/offline` is a route handler returning standalone HTML, not a page
  component.** That is the security decision: a page component is wrapped in the
  root layout, and the sidebar's space names and task counts would be baked into
  a cache entry held indefinitely. Nothing on the route reads a cookie, a user
  or the database.
- The policy is **data**, in `src/lib/offline.ts`, tested by Vitest and injected
  into the generated worker as JSON — so the tested rules and the shipped rules
  cannot disagree. `swDecision` is total and defaults to `network-only`.
- **There is a way out**: a version bump deletes every other cache on activate,
  and `/settings` can unregister the worker and empty its caches. A service
  worker with no escape hatch is how an app ships that cannot be fixed.
- Driven with the network **actually disabled** in the browser context.

**Authenticated pages now say `no-store`** (`src/middleware.ts`), with
`_next/static` keeping its immutable year. This is the hole described at the top
of this file. Both halves are asserted.

**Edge 7 is closed, and it had more teeth than the entry said.** Dismissing lost
the edit — but for three of the four conflict kinds the edit was *already* gone:
`settle` takes a conflicted write out of the queue, and `clashes[]` carries the
typed values only for `field_conflict`. A `deleted_elsewhere`,
`locked_elsewhere` or `moved_space` conflict discarded somebody's typing the
moment it was raised, before they had touched anything.

- `settle` now **holds the write behind every conflict**, and dismissing moves
  it to a discard log rather than deleting it.
- `/sync` lists what was dismissed, what each one would have written, and offers
  to **put it back** — the floor was a record, and this is the record plus the
  undo. A restored write goes to the end of the queue with a new sequence
  number, keeping its `base`, so the next send judges it against the row as it is
  now.
- **No migration**, and the argument was not close: an unsent edit has never
  been anywhere but this browser, and one of the four kinds is
  `locked_elsewhere`, so the naive server table would hold the plaintext of an
  edit to an end-to-end-encrypted row, which decision 1 forbids.
- Capped at 50, oldest dropped — an unbounded log in `localStorage` would
  eventually be why an edit could not be saved.

**Edge 32 is closed: an assignee picker on the task row.** Still **not on the
compose bar**, which is recorded twice and stands. Its own action rather than a
trip through `updateTask`, which would need every other field posted back with
it. Only `owner`, `admin` and `member` are offered — exactly the set the write
accepts — and a locked row gets no control, because the write would refuse.

**The one red smoke check was the check, not the app.** Session 11 recorded one
of 402 failing with its name lost. It was *"a busy block carries no title, no
category and no link"*, and it was a false positive, verified before it was
touched: the check scanned the whole page for a hardcoded word list described as
"the seeded Work titles", but three of the four are not seeded titles and
`'Stand-up'` is in the seed's generic `EVENT_TITLES` filler, drawn from for
**every** space. The match was `aria-label="Stand-up, all day, Danny"` — the
partner's own event in his own space. Every busy block carried `Work | Busy` and
nothing else. It now asserts the property its name claims, on the blocks
themselves, and the leak scan is kept with its forbidden set *derived* from the
app rather than guessed.

### New in the second pass — before a deployment

The Supabase migrations were applied by hand between the two passes. These are
the four things worth closing before anything is public.

**Edge 22 is enforced, not warned about.** `AUTH_PROVIDER=dev` on a production
build is refused: every page returns a sentence naming what to set instead.
`switchUser` is impersonation by design and **`dev` is the default**, so the
dangerous case was never a typo — it was forgetting to set a variable. The
escape hatch is where the design is: `pnpm start` sets `ORBIT_ALLOW_DEV_AUTH=1`
so the zero-credential run and `pnpm smoke` are untouched, and the **Dockerfile
does not** — it runs `node server.js`, so nothing in `package.json` can leak
into an image. Thrown from `authProvider()` so every entry point fails closed,
and given its own page in the layout because the existing catch would have
called it *"Orbit can't reach its database"*. Only the exact string `'1'`
disarms it. Verified against a real production server both ways.

**`/health` runs `select 1`** and answers `200` or `503`. The most likely
production failure is a `DATABASE_URL` that does not work, and the default check
on Fly and Railway is "did the port open", which is true of a container that
cannot serve a page. It returns one key and no error text on purpose — it is
unauthenticated by necessity. Verified with a working and a broken URL.

**`fly.toml` is committed**, because two `fly launch` defaults are wrong here
and both fail quietly: `auto_stop_machines` throws the connection pool away
between requests, and `internal_port` defaults to 8080 while Next listens on
3000. `AUTH_PROVIDER` is deliberately absent from `[env]`, so a deployment that
forgets it meets the guard above.

**Edge 35 is closed — migration 0013.** `app.free_busy_blocks()` filtered on the
*stored* row, and a repeating event is stored once at its DTSTART, so a weekly
stand-up that began in March never overlapped "this week": a `free_busy` grantee
saw **none** of somebody's recurring commitments. The direction was the safe one
— less, never more — which is exactly what hid it, while the availability view
answered "free" about the busiest hour of the week.

- The pgTAP fixture had recurrence *rules* and no event pointing at one, so
  nothing exercised the join. That is how this survived from Phase 2.
- `free_busy_blocks` is one-offs only now; `app.free_busy_recurring()` returns
  the series, and the app expands it with the one tested implementation.
  Duplicating RFC 5545 expansion in PL/pgSQL would be a second answer to *which
  occurrences exist*, and the two would disagree visibly.
- **That choice lets a grantee's session obtain the rule text**, which is a real
  departure from *"the shape of somebody's week is content"*. Argued in the
  decisions log; what is rendered is unchanged, and `BusyBlock` has no field a
  rule could live in.
- Watched: Priya has nine Work events in a week, five of them stand-up
  occurrences. Danny saw four busy blocks before and sees nine now, with no
  title leaked. The smoke check asserts the two **agree** rather than counting
  blocks — counting alone passed throughout the bug.

### Session 10 and earlier — unchanged and still green

It works on a phone: `viewport`, a bottom tab bar and a drawer below `md`, task
rows that keep the title on screen, `--tabbar` as one token, a manifest.
Navigation says where you are, via `aria-current` and weight rather than hue.
Today queries events, with a range switch on `?range=`, a summary strip whose
numbers are the lists beneath them, and an agenda with the now-line in position.
Assignment on the row and `/tasks/mine`. The calendar opens at now. Keyboard
shortcuts, with the rules in `src/lib/shortcuts.ts` as pure functions.

Real accounts, the `auth.users`→`profiles` join, space invites, `/spaces`,
`/invite/[token]`, the account panel. Smart lists; tasks, notes with versions and
Markdown, people with contacts, dates and linking; the merged week/day/month
calendar with anonymous free/busy blocks, recurrence expanded from one row plus
an RRULE, ICS import, provider pull and push; places with geocoding, visits and
links; travel with trips and derived journeys; the rules engine with its dry
run, audit trail and notifications; search across five kinds; local-only
natural-language capture; AI off by default with per-feature, per-space consent;
`/sync` with its outbox, named conflicts and per-device cursors.

---

## Stubbed / fixture-backed

Unchanged from session 9. Every `*_PROVIDER` variable genuinely selects an
implementation; the default is the one that needs no credential; an unknown
value is a hard error rather than a silent fall back.

| Interface | Default (runs here) | Real |
|---|---|---|
| `AuthProvider` | `auth:dev` | `auth:supabase` — **running in production, not acceptance-tested** (corrected session 14) |
| `CalendarProvider` | `calendar:fake` | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` | `ai:anthropic` — **written, never run** |

**"Written, never run" means exactly that.** None of the six providers still
carrying the label has ever sent a request. Do not describe one as working, and
do not let a fake stand in for one in a "Works" claim. `auth:supabase` left the
label by being deployed and signed into, not by being improved — and it has not
reached "Works", which in this file means *executed and watched*.

Also still fixture-backed or absent: **locked items** have no client-side
crypto; **there is no scheduler**; **`AUTH_COOKIE_SECRET` still signs nothing.**

The service worker is no longer on this list — see above — but note what it is
*not*: it is a shell, not offline browsing. Offline **editing** is a different
mechanism entirely and it is real; it lives in `src/lib/sync/` and the offline
page says so and links to `/sync`.

---

## Not started

- ~~**Nothing was deployed.**~~ **Corrected in session 14: Orbit is deployed**,
  on Vercel, against a real Supabase project. `docs/runbook.md` §4 is the
  current sequence and `docs/deployment-and-android.md` §3 explains why
  serverless is now a supported shape rather than a warning — the pool is an
  asset in a process that outlives the request and a liability in one that does
  not, and against Supabase's transaction pooler with `DATABASE_POOL_MAX=1` and
  `DATABASE_PREPARE=false` the app stops pooling for itself. `docs/deploy.md`
  still opens with "nothing in this file has been run"; that line is now about
  the *commands*, not the outcome.
- **The acceptance pass has not happened.** Deployed is not tested: the refresh
  path, magic links and a real invitation redeemed by a second account are all
  still unwatched. This is the first item under **Next three things**.
- **The Android client (Brief B)** has not been started, and session 10 weakened
  the case considerably: the web app is usable on a phone and installable, which
  was most of what Brief B was for. Session 12 weakens it further — an installed
  Orbit now behaves when the signal drops.
- **Shared lists (shopping)** — the one household verb genuinely missing, per
  the comparison table in `docs/design-review.md`. Large, and needs a migration.

---

## Known bugs and rough edges

**31 entries.** Session 10's 33 carried over; **4, 7, 32 and 33 are closed** and
are not renumbered, because the numbers are referred to by three other
documents. Two are new.

### New in session 12

34. **A preference belongs to a browser, not to an account.** Theme, week start
    and default compose space are cookies, so a second device starts at the
    defaults. For a theme that is arguably correct — a phone at night and a
    desktop at noon want different answers — and for the default space it is a
    mild annoyance. Moving them onto `profiles` is a migration *and* a decision
    about whether they are per-account or per-device.
35. **Closed in the second pass.** A `free_busy` viewer saw none of somebody's
    recurring commitments. See below.

### Carried over

1. **The `supabase` provider's refresh path has never been watched**, and it is
   still the part most likely to be wrong. *Corrected in session 14: the
   provider itself has run — it is what serves the deployment — so this entry is
   now about the one path inside it that nobody has seen execute, not about the
   whole of it.*
2. **A raw invitation token lands in the browser's history.**
3. **`pnpm smoke` leaves invitation rows behind** — two per run. `pnpm seed`
   clears them. The suite is checked to pass **twice in a row without a
   reseed**, and session 12's new sections were written to hold that: the
   revoke section rewinds the cursor it advanced, because a caught-up cursor
   empties the "changed since" feed a later check reads.
5. **Editing one occurrence's *details* is not built.**
6. **A trip's journeys are not re-checked against its dates.**
8. **The queue survives a user switch** and a sign-out.
9. **`SYNCABLE_FIELDS` is narrower than the forms**, and only
   `/tasks/item/[id]` has an offline surface.
10. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.**
11. **`applyWrite` interpolates column names with `tx.unsafe`** from a closed
    list re-checked in the server action.
12. **The push window is every dirty event, capped at 200, oldest first.**
13. **A push does not delete.** Now the one with the most teeth, edge 7 having
    been closed.
14. **The repeat builder cannot type "the third Thursday", nor a `COUNT`.**
15. **The weekly review reads seven days from `now()`**, not the range Today is
    showing.
16. **Nothing runs a `schedule` rule on a schedule.**
17. **A rule's conditions and actions are never *reordered*.**
18. **The rules engine only knows about tasks**, capped at 500 open tasks.
19. **`rule_runs` is never pruned**, and neither is `space_invites`.
20. **Derived journeys are re-derived on every render.**
21. **The calendar pull window is fixed at −180/+365 days.**
22. **`switchUser` is impersonation by design.** Unreachable whenever
    `AUTH_PROVIDER` is not `dev`, but **a build deployed with
    `AUTH_PROVIDER=dev` is a build where anybody can become anybody.**
23. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Session 12
    hit this the ordinary way: `/settings` is a new route, and typed routes do
    not know about it until a build has run.
24. **The Markdown subset has no tables, no images, no task lists.**
25. **The people list's "next date" is computed twice.**
26. **A person's category is resolved back from its *name*** on the detail page.
27. **Contacts cannot be edited, only added and removed.**
28. **Search covers five kinds and no more.**
29. **Capture's space hint is one token**, a captured note gets an empty body.
30. **The AI result is carried on the URL**, on three pages.
31. **Environment and tooling.** Postgres does not survive container restarts;
    `pg_ctlcluster 16 main start` brings it back without reseeding, which
    `./scripts/db-reset.sh` would not. Use
    `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done`, note the
    bracket. There is no linting, out of scope by instruction. `pnpm smoke`
    needs a running server, Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and **port 3101 free**.
    `pnpm start` prints a warning about `output: 'standalone'`; it is harmless
    and the suite drives that server.

### Closed in session 12

- **22 — a build deployed with `AUTH_PROVIDER=dev`** is one where anybody can
  become anybody. Orbit now refuses to serve any page on a production build
  unless a real provider is chosen. The escape hatch is `ORBIT_ALLOW_DEV_AUTH=1`,
  set by `pnpm start` and deliberately not by the Dockerfile. Entry 22 above is
  kept for its description of what `switchUser` is.
- **35 — a recurring event was not busy time.** `app.free_busy_blocks()`
  filtered on the *stored* row, and a series is stored once at its DTSTART, so a
  weekly stand-up that began in March never overlapped "this week". Migration
  0013 splits one-offs from series; the app expands the rule with the one tested
  implementation rather than growing a second one in SQL. That choice lets a
  grantee's session obtain the rule text, which is a real departure from a
  recorded position and is argued in the decisions log.
- **4 — a device row nothing could revoke.** `/settings` revokes and restores,
  and a revoked device stops advancing its cursor.
- **7 — a dismissed conflict lost the edit.** Kept, shown on `/sync`, and
  restorable. No migration; the argument is in the decisions log.
- **32 — assignment could not be set from a list.** A picker on the row.
- **33 — installable with no service worker.** There is one, and it caches no
  page anybody rendered.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
pg_ctlcluster 16 main start    # if Postgres is not already up
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 106/106 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 816 Vitest tests
pnpm start                     # http://localhost:3000
pnpm seed && pnpm smoke        # 455 checks; also starts a second server on :3101
```

If Postgres has stopped but the data is still there, start it rather than
resetting: `pg_ctlcluster 16 main start`.

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
and **no credential is required**. Session 12 added no variable. It added three
**cookies**, all unsigned and none of them a permission: `orbit_theme`,
`orbit_week_start` and `orbit_space`. The last is validated against the caller's
writable spaces on every read, so a forged value can at most prefer a space they
can already write to.

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

**A five-minute demo of what session 12 added.**

Open `http://localhost:3000` and go to **More → Settings**. Press **Dark**. The
page is dark before it is drawn — reload it and watch: there is no pale flash,
because the choice is in the `<html>` tag the browser parses first rather than
in an effect that runs after a paint. Set your operating system to light mode
and it stays dark; press **System** and it follows the OS again.

Press **Sunday** under *Week starts on*, then open the **Calendar**. The week
begins on Sunday and the month grid's column headings have moved with it — and
the events are all still there, because the query range is cut from the same
preference as the grid. Set it back to Monday.

Scroll to **Devices**. Press **Revoke** beside one, then go to **Sync**, pick
that device and press **Mark caught up**. The cursor does not move. Press
**Restore** on Settings and try again: it moves. That column has existed since
migration 0001 and nothing had ever written it.

Now the offline shell. On **Sync**, tick **Work offline**, edit a task, and come
back — then use your browser's dev tools to go offline properly and reload. You
get a page that says what Orbit can and cannot do without a network and links
back to Sync, rather than a browser error. It is deliberately not your
`/tasks/home`: every page is rendered for you specifically, and a stored copy
could be shown to whoever picks the phone up next.

Finally, on **All open**, use the small control on a row to give a task to
Danny. It is on the row and not on the compose bar, deliberately — and if a
conflict ever comes back on **Sync**, pressing **Dismiss** no longer loses what
you typed: it drops into a *Dismissed* list underneath with a **Put it back**
button.

---

## Next three things, in order

**`docs/runbook.md` is the ordered sequence for item 1** — the console and CLI
steps, with what to check after each and what going wrong looks like. Its step 0
matters: migration `0013` was written *after* the migrations were applied by
hand, so it still needs running.

1. **Corrected in session 14 — the by-hand steps are done; the acceptance pass
   is not.** The project exists, the migrations are applied, the app is deployed
   on Vercel and somebody has signed up: that is what closed the loop, and what
   surfaced the bugs migrations 0014–0016 fix. What remains is **driving real
   authentication end to end and writing down what happened** — sign in, sign
   out, a magic link, and letting a session expire so **the refresh path**
   runs, then a second account and an invitation with each offerable role
   including `free_busy`, accepted, declined, expired and revoked.
   `docs/remaining-work.md` §5 is the prompt for exactly that session, and its
   two placeholders can now be filled in. Still first by a distance: everything
   below improves an app whose riskiest path is still unproven.
2. **Edge 13 — a push does not delete**, and **edge 16 — nothing runs a
   `schedule` rule on a schedule.** With 7 closed, 13 is the one with the most
   teeth: a provider push that cannot delete means a cancelled event stays in
   somebody's Google calendar for good. 16 is the reason the rules engine's
   `schedule` trigger is a shape with nothing behind it.
3. **Edge 35, the new one** — a `free_busy` viewer does not see a recurring
   event's occurrences as busy blocks, so the partner's availability view says
   she is free at 10:30 when she is not. Small, probably, and it is a
   correctness bug in the one feature the product owner settled by name
   (decision 3).

After those, **shared lists (shopping)** is the one household verb genuinely
missing, and it is large and needs a migration.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, keep `docs/phase-plan.md` accurate,
append to `docs/decisions-log.md`, and push. The container is ephemeral. Push at
least hourly.
