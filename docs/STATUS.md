# STATUS — handoff contract

Last updated: **session 11**, 2026-08-08. Branch:
`claude/project-completion-status-kkqpxo`. The body below the session 11 section
is session 10's and is still accurate except where that section corrects it.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/remaining-work.md`, then `docs/design-review.md`, then
`docs/decisions-log.md`, then get the database up and pick from
**Next three things** at the bottom.

---

## Session 11 — one schema, and what the five commands actually say

Session 11 built no feature. It re-ran the five commands from a cold container
to check whether this file was still true, and then moved Orbit into a single
schema so it can be deployed into a Supabase project that is already carrying
other work.

**Orbit lives in one schema, `orbit`.** Tables, enums, and every helper
the policies call. There is no `app` schema any more and nothing is created in
`public`. The single object outside `orbit` is the trigger on `auth.users` in
migration 0012, which is unavoidable — that table is Supabase's and the profile
row has to exist when an account does. `tests/schema.test.ts` holds the whole
invariant, including that 0012 stays the only exception.

**The five commands, run from a cold container at the end of session 11:**

```
./scripts/db-test.sh   106/106 pgTAP assertions   (unchanged)
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              744 Vitest tests in 18 files   (was 735 in 17)
pnpm smoke             402/402 against the running app
```

No migration was added, so pgTAP is unchanged at 106. The nine new Vitest cases
are `tests/schema.test.ts`.

**Two things this move found, and one thing it did not.**

1. **`orbit.space_invite()` could not have worked on Supabase.** It is SECURITY
   DEFINER with `search_path` pinned to `orbit, pg_temp`, and it hashed the
   invitation token with pgcrypto's `digest()` — an extension that lives in
   `public` locally and `extensions` on Supabase, neither on that path. Every
   redemption raised. It uses `sha256()` from `pg_catalog` now. Caught by
   `tests/invites.test.ts`, which reads the migration source and compares it to
   the TypeScript.
2. **A bare `create extension` would have installed PostGIS into `orbit`**, once
   `orbit` was first on the search_path. 0000 places extensions in `extensions`
   where that schema exists and `public` where it does not, and leaves an
   already-installed one alone.
3. **The one red smoke check was a false positive, not a failure, and it was red
   before this session started.** "a busy block carries no title" searched the
   page for the seeded Work titles, and the seed draws every space's titles from
   one pool — Danny legitimately has a "Stand-up" of his own. There is no leak:
   `orbit.free_busy_blocks()` is `returns table (starts_at, ends_at, all_day)`,
   so a title has nowhere to travel. The check now strips the three things a
   busy block may render and requires nothing to be left.

**What did not change:** every policy, `asUser`, the `dev` provider being the
default, and the seven providers that are still written and never run. A schema
move is not evidence about any of them.

**Still true and still the most important sentence in this file:**
`AUTH_PROVIDER=supabase` has never run.

---

**Where the project is: Orbit was finished at the end of session 8, made usable
by a real person in session 9, and made usable *on a phone* in session 10.**
Session 10 was a design and functionality review and the work it argued for. It
added no table and no migration. It is not a phase in `docs/phase-plan.md` and
it did not need one.

**The one sentence worth carrying forward:** before this session Orbit was
unusable on a phone — not unpolished, unusable — and it is a household
organiser, which is a phone product. At 390px the sidebar took 62% of the
screen and task titles were pushed off it entirely.

**Five commands are the whole truth about this repo.** All five were run at the
end of session 10, and all five were green. (Session 11 re-ran them; the counts
it saw are in the section above.)

```
./scripts/db-test.sh   106/106 pgTAP assertions   (unchanged)
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              735 Vitest tests in 17 files   (was 692)
pnpm smoke             402/402 against the running app   (was 382; needs pnpm start)
```

No migration was written this session, which is why pgTAP is unchanged at 106.

---

## The one thing to understand before you touch anything

**`AUTH_PROVIDER=supabase` has never run.** Unchanged from session 9 and still
the most important sentence in this file. Session 11 found a bug in that path
without running it — see the section above — which is a reason to trust it less,
not more. There is no Supabase project, no
credential and no network in this container. The provider is a complete
implementation of Supabase's GoTrue REST API and not one line of it has ever
sent a request — exactly like `calendar:google` and `ai:anthropic`.

Nothing in session 10 touched authentication. **"Signing in to Supabase works"
is still proven by nothing.**

---

## Works — verified by running it

Everything here was executed and watched.

### New in session 10

**It works on a phone.** Ten smoke checks now run at 390×844 and every one of
them fails on the previous commit.

- `viewport` is exported from `src/app/layout.tsx`. Without it a phone assumed a
  ~980px layout viewport and scaled the page down. `maximum-scale` is
  deliberately not set: pinching to zoom is somebody's accessibility.
- The 240px rail is `hidden … md:flex`. Below `md` a **bottom tab bar** carries
  Today, Calendar, Capture, Search and People, and **More** opens a drawer
  holding the whole rail. The drawer closes on navigation, on Escape and on the
  backdrop — all three, because it covers the page.
- `SidebarNav` is **one** component with two homes. The bottom slot (the dev
  switcher, or the account panel) is passed in as a slot, because
  `usesDevAuth()` is a server decision and the boundary is `switchUser`
  refusing, not the button being absent.
- A task row is **two lines on a phone and one on a desktop**, and the title
  never moves. It was a single row with a `shrink-0` metadata block that won.
- `--tabbar` is one token, so the bar's height and the padding that clears it
  cannot disagree. It is `0px` from `md` up.
- `src/app/manifest.ts` exists, so Orbit installs to a home screen. **No icons
  are declared** — an icon pointing at a file that does not exist is a broken
  image on somebody's home screen, and there is no artwork in this repo.

**Navigation says where you are.** Every link used to render an identical
`className` and none set `aria-current`, so on `/` the word "Today" looked
exactly like "Travel". Selection is now weight plus a raised surface — no hue,
because the nav sits directly above ten coloured space chips. Rules, Sync and AI
moved under a **More** heading; they had been beside Today at the same weight.

**Today answers what is on today.** The landing page queried tasks, birthdays
and yesterday's notes and **never queried events**. It now has:

- a **range switch** on `?range=today|week|month`, in the URL so it survives a
  reload and can be sent to somebody;
- a **summary strip** whose three numbers are the lengths of the three lists
  rendered below them, so they cannot disagree;
- an **agenda** of real events against the time gutter, category colour on the
  left edge only, with the now-line in position;
- the whole capped at `--measure` (64rem).

This is also where the adopted design finally got built. Commit `74789ce` took
the revised `globals.css` from `docs/design_handoff/` and left the surfaces it
was written for: `.seg`, `.stat`, `.stat-num`, `.block-time`, `.block-now` and
`.now-line` had **zero** uses in any `className` in `src`. All six are now spent.

**A bug the strip was designed to prevent, found by building it.** The `today`
smart list is "due today **or** overdue and still open", so counting all of it
as due and the remainder as overdue reported *35 due and 0 overdue* on a day
when 34 of the 35 were weeks past their date — with the sidebar saying 34 two
inches away. Split now.

**Assignment is visible at last.** `assignee_id` has been on `tasks` since
migration 0002, with `tasks_assignee_idx`, a partial index on open tasks by
assignee — an index built for a query nothing wrote. `listTasks` had been
selecting `assigneeName` and computing `isMine` on every row since Phase 0 and
nothing rendered either.

- The row now says whose job it is. **Somebody else's name is `--text-muted`
  and your own is "You" at `--text-faint`**, that way round because in your own
  lists nearly every row is yours and what the eye hunts for is the two that are
  not.
- **`/tasks/mine`** is the ninth smart list and the query that index was for. It
  does not render the assignee at all — a column saying "You" on every row of a
  list called Mine is a column saying nothing.
- **It can be set by typing `@danny` into capture**, which has worked since
  Phase 5 and had never been driven end to end by a check. It still cannot be
  set from the compose bar, deliberately. See "Known bugs" 32.

**The calendar opens where the day is.** It opened at 00:00 with roughly seven
empty night hours filling the viewport. `scrollToMinute` **already existed** in
`src/lib/calendar.ts`, already had tests, and was called from nowhere; it now
also knows about `now`, and `ScrollToFocus` moves the scroll position on
arrival. Also:

- the now-line wears `.now-line` and is `--accent`, not `--danger`. Red means
  "careful" everywhere else and the current time is not a warning;
- `.now-line::before` (the dot) now sits at the line's own left edge, with
  `.now-line-gutter` as the one exception for the agenda. As the default it put
  the dot in the **previous day's column**;
- blocks take the category colour on the **left edge only**. Every border was
  taking it, which `globals.css` warns against by name two lines from the token;
- a compact block no longer repeats the time it is already positioned against.
  Five identical "Team st…" standups are finally told apart by their titles.

**Keyboard shortcuts.** `globals.css` justifies the focus ring with "a dense
interface is a keyboard interface"; the app had one `addEventListener` in `src`
and it listened for `online`.

```
g t/c/m/i/p/l/n/r/s   go somewhere
/                     search
c                     capture
?                     the list of them
Esc                   close whatever is open
```

Three rules, all in `src/lib/shortcuts.ts` as pure functions so they are tested
without a DOM: **never take a key from somebody who is typing** (`c` is Capture,
and typing "citrus" into a task title must not navigate away); **never take a
key from the browser** (anything with ⌘, Ctrl or Alt); **never be the only way
to do anything** (every one duplicates a link still on screen, and `?` lists
them). `g` is a prefix that forgets itself after 1.2s.

**The compose bar opens when you reach it.** Three rows and about a quarter of
the first screen of every list, on a phone. Collapsed it is one row and
focusing the title opens the rest — which does **not** weaken the space
safeguard, because focusing the title is what opens the chips, so there is no
state in which somebody types a task without the space on screen.

### Session 9 and earlier — unchanged and still green

Real accounts, the `auth.users`→`profiles` join, space invites, `/spaces`,
`/invite/[token]`, the account panel. The quiet "N events yesterday, no notes"
row; smart lists; tasks, notes with versions and Markdown, people with contacts,
dates and linking; the merged week/day/month calendar with anonymous free/busy
blocks, recurrence expanded from one row plus an RRULE, ICS import, provider
pull and push; places with geocoding, visits and links; travel with trips and
derived journeys; the rules engine with its dry run, audit trail and
notifications; search across five kinds; local-only natural-language capture; AI
off by default with per-feature, per-space consent; `/sync` with its outbox,
named conflicts and per-device cursors.

---

## Stubbed / fixture-backed

Unchanged from session 9. Every `*_PROVIDER` variable genuinely selects an
implementation; the default is the one that needs no credential; an unknown
value is a hard error rather than a silent fall back.

| Interface | Default (runs here) | Real |
|---|---|---|
| `AuthProvider` | `auth:dev` | `auth:supabase` — **written, never run** |
| `CalendarProvider` | `calendar:fake` | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` | `ai:anthropic` — **written, never run** |

**"Written, never run" means exactly that.** No real provider here has ever sent
a request. Do not describe one as working, and do not let a fake stand in for
one in a "Works" claim.

Also still fixture-backed or absent: **locked items** have no client-side
crypto; **there is no scheduler**; **there is no service worker** — and the app
is now installable, which makes that a real gap rather than a nicety (see
"Known bugs" 33); **`AUTH_COOKIE_SECRET` still signs nothing.**

---

## Not started

- **Nothing was deployed.** No hosting account, no Supabase project, nothing
  bought. `docs/deploy.md` is instructions and says so at the top.
- **The Android client (Brief B)** has not been started. Note that session 10
  weakens the case for it considerably: the web app is now usable on a phone and
  installable to a home screen, which was most of what Brief B was for.
- **A manual light/dark override.** Deliberately not started, and *not* because
  it is hard — see `docs/design-review.md`, "Item 7, and why it is not a small
  job". It needs a decision about `globals.css` that should be made on purpose.

---

## Known bugs and rough edges

**33 entries.** Session 9's 31 are carried over except where noted; two are new.

### New in session 10

32. **Assignment cannot be set from the compose bar.** *(Corrected before the
    session ended: an earlier draft of this entry said it could not be set
    anywhere but the detail page. That was wrong — see below.)* `ComposeTask`
    has no assignee control, and it is not getting one: that bar already carries
    a title, a date, a category and one chip per writable space, and on a phone
    that was three rows before anything was added. A picker on the row itself is
    the remaining gap worth filling.

    **`@person` in capture has worked end to end since Phase 5.**
    `parseCapture` produces `assigneeHint`, `resolveAssignee` in
    `src/lib/queries/capture.ts` matches it against active members of the target
    space by display name or first name, and `createFromCapture` writes it.
    Typing `bins out tomorrow @danny #home` reads back "assign to danny" as a
    chip *before* anything is created, and the row lands with Danny on it. It
    had **no end-to-end check** until session 10 added four; the capability was
    there and nothing was watching it.
33. **Orbit is installable and has no service worker.** `src/app/manifest.ts`
    means it can be added to a home screen, and an installed app that shows a
    network error when the connection drops is a worse impression than a
    bookmark. The offline machinery in `src/lib/sync/` is real; what is missing
    is the shell.

### Carried over

1. **The `supabase` provider has never run**, and the refresh path is the part
   most likely to be wrong.
2. **A raw invitation token lands in the browser's history.**
3. **`pnpm smoke` leaves invitation rows behind** — two per run. `pnpm seed`
   clears them. **Two runs without reseeding will fail the revoke checks**, and
   this bit twice during session 10.
4. **Naming a browser writes a device row per writable space, and there is no
   way to delete one.** `devices.revoked_at` exists and nothing sets it.
5. **Editing one occurrence's *details* is not built.**
6. **A trip's journeys are not re-checked against its dates.**
7. **A conflict is dismissible, and dismissing it loses the edit.** Still the
   one with the most teeth.
8. **The queue survives a user switch** and a sign-out.
9. **`SYNCABLE_FIELDS` is narrower than the forms**, and only
   `/tasks/item/[id]` has an offline surface.
10. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.**
11. **`applyWrite` interpolates column names with `tx.unsafe`** from a closed
    list re-checked in the server action.
12. **The push window is every dirty event, capped at 200, oldest first.**
13. **A push does not delete.** The other one with teeth.
14. **The repeat builder cannot type "the third Thursday", nor a `COUNT`.**
15. **The weekly review reads seven days from `now()`**, not the range Today is
    showing — and Today now *has* a range, so this reads slightly worse than it
    did.
16. **Nothing runs a `schedule` rule on a schedule.**
17. **A rule's conditions and actions are never *reordered*.**
18. **The rules engine only knows about tasks**, capped at 500 open tasks.
19. **`rule_runs` is never pruned**, and neither is `space_invites`.
20. **Derived journeys are re-derived on every render.**
21. **The calendar pull window is fixed at −180/+365 days.**
22. **`switchUser` is impersonation by design.** Unreachable whenever
    `AUTH_PROVIDER` is not `dev`, but **a build deployed with
    `AUTH_PROVIDER=dev` is a build where anybody can become anybody.**
23. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.**
24. **The Markdown subset has no tables, no images, no task lists.**
25. **The people list's "next date" is computed twice.**
26. **A person's category is resolved back from its *name*** on the detail page.
27. **Contacts cannot be edited, only added and removed.**
28. **Search covers five kinds and no more.**
29. **Capture's space hint is one token**, a captured note gets an empty body.
30. **The AI result is carried on the URL**, on three pages.
31. **Environment and tooling.** Postgres does not survive container restarts —
    **and this happened mid-session 10**; `pg_ctlcluster 16 main start` brings it
    back without reseeding, which `./scripts/db-reset.sh` would not. Use
    `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done`, note the
    bracket. There is no linting, out of scope by instruction. `pnpm smoke`
    needs a running server, Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and **port 3101 free**.

**One smoke check was fixed that had nothing to do with this session's work.**
"a pulled recurring event is drawn from its rule" looked for an event the
fixture places at `today + 2` in the week containing *today*, so it passed
Monday to Friday and failed at the weekend. Session 10 ran on a Saturday.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 106/106 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 744 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 402 checks; also starts a second server on :3101
```

If Postgres has stopped but the data is still there, start it rather than
resetting: `pg_ctlcluster 16 main start`.

Everything is in the `orbit` schema, so `psql -d orbit` on its own will find
nothing: `set search_path = orbit, public, extensions;` first, or qualify.

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
and **no credential is required**. Session 10 added no variable, and the table
in session 9's history still describes every one of them.

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

**A five-minute demo of what session 10 added.**

Open `http://localhost:3000` and **make the window 390px wide**. The rail is
gone; a bar sits along the bottom with Today under a rule marking where you are.
Every task title is on the screen. Press **More** — the whole rail slides in;
press Escape and it goes. Widen the window past 768px and the bar disappears
while the rail comes back.

Back at full width, look at **Today**. It now opens with the day spelled out,
three numbers, and an agenda of what is actually on — with an accent hairline
across it marking now. Press **Week**: the same page at a coarser grain, seven
days of agenda, the range in the URL. Check the numbers against the sidebar —
"overdue" agrees with it, which it did not before.

Press **`?`** for the list of shortcuts, Escape to close it, then **`g`** then
**`c`** to land on the calendar. It opens at the current hour rather than at
midnight, with the now-line in today's column and its dot at that column's edge.
Five Team stand-ups now read as five Team stand-ups.

Press **`g`** then **`m`** for **Mine** — the ninth smart list, and the first
query ever written against `tasks_assignee_idx`. Then click into any other list
and note the names on the rows: somebody else's is legible, your own is a quiet
"You".

Finally, go to **Capture** and type `bins out tomorrow at half seven @danny
#home`. It reads the line back as chips — `@danny → assign to "danny"` — before
creating anything, and the task lands in Home with Danny's name on the row. That
has worked since Phase 5; until session 10 nothing checked it.

---

## Next three things, in order

1. **Somebody has to do the by-hand steps** — create the Supabase project, run
   the migrations, create `orbit_app`, deploy, and sign up once.
   `docs/deploy.md` is the list. **Until that happens the supabase provider
   stays "written, never run" and no session can change that.** Unchanged from
   session 9 and still first.
2. **Decide the light/dark question, then build the settings page.**
   `docs/design-review.md` sets out the two options — `light-dark()`, or
   duplicate-and-pin — and why guessing between them is the wrong move. The
   settings page then has somewhere to live, and edge 4 (a device row that
   nothing can revoke, with `devices.revoked_at` sitting unused) has an obvious
   home on it.
3. **A service worker** (edge 33). The app is installable now, and the sync
   machinery underneath it is real; an installed app that shows a network error
   when the connection drops undoes much of what session 10 built. This has
   moved up sharply because of what shipped, not because it got easier.

After those, a dismissed conflict leaving a record (edge 7) is still the one
with the most teeth, and it probably needs a migration — read the migration
rules before you start.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, keep `docs/phase-plan.md` accurate,
append to `docs/decisions-log.md`, and push. The container is ephemeral. Push at
least hourly.
