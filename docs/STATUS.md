# STATUS — handoff contract

Rewritten in full: **session 15**, 2026-08-10. Branch
`claude/orbit-acceptance-real-project-merods`. This file takes precedence over
your assumptions about what is done.

Read this, then `docs/decisions-log.md` (session 15 is the long entry at the
bottom), then `docs/runbook.md`, then pick from **Next three things**.

---

## Read this first: what was watched, and what was not

Session 15 was handed **Brief D, the acceptance pass against the real project**.
Its one stated failure condition was *"coming back with 'authentication works'
without having watched the refresh path run"*.

**The refresh path was watched. It is broken.** It is edge 36 below, and it is
the finding of the session.

But the brief could only be half-run, and the reason matters more than the
result:

> **There are no credentials in this container.** Brief D says *"Credentials are
> in the environment"*. They are not — no `SUPABASE_URL`, no
> `SUPABASE_ANON_KEY`, no `DATABASE_URL`, no admin connection string, no `.env`.
> The brief's own **"Supabase project ref"** line is blank; the placeholder was
> never filled in.

So there are three different kinds of claim in this file and they must not be
run together:

| | What it means |
|---|---|
| **Watched against the real project** | Done from this container over the network, signed out. `/health`, the signed-out redirect, and the sign-in page's markers. That is all of it. |
| **Watched against a stub GoTrue** | The app, built and running with `AUTH_PROVIDER=supabase` pointed at a stub speaking GoTrue's REST shapes with Supabase's real rotation semantics, driven in a browser. This is where the refresh path ran. |
| **Not watched at all** | Everything needing an admin connection or a mailbox. Listed explicitly below, not left to inference. |

**Nobody signed in to the real project this session, and no account was created
on it.** Why not is argued in the decisions log; briefly, the brief's own gate
(`u.id = p.id`, an admin query) was unavailable, every path downstream needs a
mailbox, and nothing created could have been removed afterwards.

### Not watched at all — the whole of Brief D §1, and most of §2

None of this ran. Do not read anything below as evidence about any of it.

- `on_auth_user_created` existing on `auth.users`.
- `u.id = p.id` after a real sign-up. **This is still the gate**: if it is not
  `t`, every policy returns zero rows and says nothing, and the app looks empty
  rather than broken.
- `orbit_app` on the live project: that it can log in, owns nothing, and holds
  no `BYPASSRLS`. Still nothing on record confirms this, and
  `./scripts/db-test.sh`'s premise is worthless if the deployed role differs.
- `app.provision_missing_accounts()` — the inspection was never run.
- `./scripts/db-test.sh` against the real project.
- A real sign-up, sign-in, sign-out or magic link **on the real project**.
- Email confirmation on, in any form.
- An invitation redeemed by a second real account; any role, including
  `free_busy`; accept, decline, expire, revoke, remove.
- Brief D §3 in full — Today, capture, calendar, recurrence, search, offline
  edits and conflicts **against the real project's RLS**. They were exercised
  against the local database, which is what `pnpm smoke` has always done and is
  not the question Brief D asked.

A second thing blocked part of this: **the browser cannot reach the deployment
from here.** Egress policy allows `curl` and Node's `fetch` to
`orbit-taj.vercel.app` but resets Chromium's connections, so the deployed app
could not be driven with Playwright. Everything checked against the real
project was checked over HTTP.

---

## What broke — numbered, with the layer and the reproduction

Five real defects. Four are fixed in this branch with their tests; one is
written up and deliberately not fixed.

### 1. The refresh path throws the rotated token away, and the session dies — **app (provider)**, edge 36, NOT FIXED

The one `docs/STATUS.md` has named for four sessions as most likely to be wrong.
It is wrong.

GoTrue **rotates**: every refresh returns a new refresh token and revokes the
one just spent, with a 10-second reuse grace. Reuse outside that grace is
treated as theft — Supabase revokes the **entire token family**, permanently.

`currentSupabaseUser()` refreshes during a Server Component render, and a Server
Component cannot write cookies, so `persistSession()` throws into a `catch` that
discards it. The cookie keeps the spent token.

**Reproduction:** sign in; leave the tab idle until the access token expires
(one hour by default); load a page — it works; wait more than ten seconds; load
another — you are signed out, and signing in again is the only way back.

Watched, in the stub's log:

```
07:27:06.955  POST /token?grant_type=refresh_token -> 200  rotated refresh-2 -> refresh-3
07:27:21.533  POST /token?grant_type=refresh_token -> 400  !! REUSE after grace (age 14.6s)
                                                           -> FAMILY family-1 REVOKED
```

The code carried a comment asserting the opposite — *"until then the refresh
token still works"*. That comment is now a description of the bug.

**Not fixed** because the fix is middleware (the only context that may write
cookies), which needs the refresh call lifted out of a module importing
`server-only` and the `postgres` pool, and because getting middleware auth wrong
signs everybody out on every request. Argued in full in the decisions log.

### 2. `redirect_to` was sent where GoTrue does not read it — **app (provider)**, edge 38, FIXED

`sendMagicLink` and `signUpWithPassword` put the callback URL in the JSON body
as `options.email_redirect_to`. GoTrue reads it from a **`redirect_to` query
parameter** and nowhere else.

Nothing errors. GoTrue falls back to the project's **Site URL**, so every magic
link and every confirmation email pointed at the app root instead of
`/auth/callback`, losing `?next=` with it. The tokens arrive in the URL
*fragment*; `CompleteSignIn` only renders on `/auth/callback`; so nobody reads
them and **the link appears to do nothing at all**.

**Reproduction:** ask for a magic link, follow it, and land signed out.

Fixed, and pinned by `tests/auth-gotrue.test.ts` asserting on the query string
of the request actually put on the wire. This also falsifies runbook step 5.5:
with the target never sent, Supabase never refuses, so there is no sentence for
the callback screen to print.

### 3. Identity was resolved twice on every render — **app**, edge 37, FIXED

The root layout resolves identity and so does every page under it, and
`getCurrentUser()` was a plain function. Under `supabase` that is two GoTrue
round trips and two `app.identity_profile` queries per page.

The cost is the smaller half: the duplicate landed *inside* the refresh path,
re-presenting a token the first call had already spent and consuming the
ten-second reuse grace at an age of **0.0 seconds** — on the request that
created it. Fixed with React's `cache()`. Watched: the double refresh is gone.

### 4. An unreachable project threw a 500 instead of saying so — **app (provider)**, edge 39, FIXED

`gotrue()` did not catch `fetch` rejecting, so a paused project or a DNS failure
threw out of the server action into the generic error page — which says *"Orbit
can't reach its database"* and names the wrong component. Now a sentence, like
every other refusal.

### 5. The provider's HTTP layer could not be imported by a test — **tooling**, FIXED

`server-only` throws on import unless the resolver is asked for React's
`react-server` condition, which Vitest has no reason to ask for. That one line
is most of why this file could say "not one line of it has ever executed" for
four sessions. Vitest now aliases it to its own `empty.js`; the marker still
does its real job, which is making the *bundler* refuse a client import.

This is the cheapest change in the session and it is what made findings 1–4
possible.

### And one that is not a code defect — **handover**

Brief D's premise. The credentials it says are in the environment are not, and
its project-ref placeholder is empty. §1 could not be attempted.

---

## Stubbed / fixture-backed

Every `*_PROVIDER` variable genuinely selects an implementation; the default is
the one that needs no credential; an unknown value is a hard error rather than a
silent fall back.

| Interface | Default (runs here) | Real |
|---|---|---|
| `AuthProvider` | `auth:dev` | `auth:supabase` — **split, see below** |
| `CalendarProvider` | `calendar:fake` | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` | `ai:anthropic` — **written, never run** |

**`auth:supabase` does not move to "works".** Brief D said to move it there only
for paths personally watched execute, and to split the row if only some of it
ran. Only some of it ran:

| Path | Label |
|---|---|
| Password sign-in, sign-out, session read | **Exercised against a stub GoTrue.** Request shapes and answer handling are proved; the real project is still unwatched from here. In production it demonstrably works — it is how the deployment is used and how two of session 13's bugs were reported. |
| **Refresh** | **Watched, and broken.** Edge 36. The app's half — a cookie that cannot be written during a render — is certain regardless of the stub. |
| **Magic link** | **Never observed end to end.** One bug found and fixed (edge 38) that would have broken every link. No link has ever been sent, received or followed. |
| **Sign-up with email confirmation on** | **Never observed.** Both answers are handled and only the stub's version of them has run. |
| **Invitation redeemed by a second real account** | **Never observed**, on any project. |
| Unreachable-project behaviour | **Watched against a stub**, fixed (edge 39). |

The six other providers are unchanged: **"written, never run" means exactly
that.** None has ever sent a request. A deployment is not a credential.

Also still fixture-backed or absent: **locked items** have no client-side
crypto; **there is no scheduler**; **`AUTH_COOKIE_SECRET` still signs nothing.**

---

## The deployment, and what is actually confirmed about it

Orbit is deployed on Vercel at **`orbit-taj.vercel.app`** against a real
Supabase project, with `AUTH_PROVIDER=supabase`.

**Confirmed this session, over HTTP, signed out:**

- **`/health` returns `{"status":"ok"}`.** The deployed app can reach its
  database. This is the one fact about the live database anybody has recorded.
- **A signed-out visitor is redirected to `/auth/signin`** from `/`, `/spaces`,
  `/settings` and `/sync`.
- **Edge 22 is settled on the live build.** The sign-in page renders the real
  provider's branch: an email and password form and a magic-link button are
  present; *"This build is not using accounts"*, *"AUTH_PROVIDER=dev"* and
  *"Viewing as"* are all absent. Nobody can become anybody on that URL.
- **`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set on it.** The page's
  *"This server has no SUPABASE_URL…"* notice — which renders when
  `supabaseIsConfigured()` is false — is absent.
- **Authenticated HTML says `no-store`**, as the middleware intends.

`ORBIT_ALLOW_DEV_AUTH` could not be read directly, and does not matter here: it
only disarms the guard when `AUTH_PROVIDER` is `dev`, and the deployed build is
demonstrably not the dev build.

**Everything else about the deployment is unconfirmed**, including every item in
the "not watched at all" list above.

---

## Works — verified by running it

Unchanged from session 12–14 unless noted. Everything here was executed and
watched, against the **local** database under `AUTH_PROVIDER=dev`.

**New in session 15: the Supabase provider's HTTP layer is executed by a test.**
`tests/auth-gotrue.test.ts` stands up a real HTTP server speaking GoTrue's
shapes and drives sign-in, sign-up (confirmation on and off), magic link,
`/verify`, `/user`, refresh (including rotation and reuse-after-grace), and an
unreachable project. Twenty checks. It asserts on the **request Orbit puts on
the wire** — method, path, query string, headers, body — rather than on
arguments, which is the only reason edge 38 was catchable.

**Session 12's work stands**: the theme pinned before first paint via a cookie
and `<html data-theme>` with no `useEffect`; `globals.css` as one `light-dark()`
palette with 42 tokens generated and verified rather than typed;
`tests/contrast.test.ts` computing real WCAG ratios for both halves, mutation-
tested; `/settings` with theme, week start (display-only, and enforced by
construction — `WKST` belongs to the rule), default compose space re-validated
against writable spaces on every read, and devices with revoke/restore; edge 4
closed with `devices.revoked_at` getting its first write and a control beside
the assertion; edge 33 closed with a service worker that caches shell only,
`/offline` as a route handler rather than a page component so no sidebar or
count is ever stored, the policy as tested data in `src/lib/offline.ts`, and a
version bump that deletes every other cache; `no-store` on authenticated pages;
edge 7 closed with conflicts held rather than discarded and a dismissal log that
can put an edit back; edge 32 closed with an assignee picker on the row.

**Session 13's** three migrations (0014–0016) and the account-adoption path, and
**session 14's** documentation corrections, stand unchanged.

**Session 10 and earlier**: phone layout with a bottom tab bar and drawer below
`md`; navigation saying where you are via `aria-current` and weight rather than
hue; Today with ranges, a summary strip whose numbers are the lists beneath
them, and an agenda with the now-line in position; the calendar opening at now;
keyboard shortcuts as pure functions. Real accounts, the `auth.users`→`profiles`
join, space invites, `/spaces`, `/invite/[token]`, the account panel. Smart
lists; tasks; notes with versions and Markdown; people with contacts, dates and
linking; the merged week/day/month calendar with anonymous free/busy blocks;
recurrence expanded from one row plus an RRULE; ICS import; provider pull and
push; places with geocoding, visits and links; travel with trips and derived
journeys; the rules engine with its dry run, audit trail and notifications;
search across five kinds; local-only natural-language capture; AI off by default
with per-feature, per-space consent; `/sync` with its outbox, named conflicts
and per-device cursors.

---

## The five commands

All run at the end of session 15 except `db-test.sh`, which was not needed:

```
pnpm build             clean
pnpm smoke             456/456 against the running app — and again without a
                       reseed, per edge 3's standing rule
pnpm test              860 Vitest tests in 22 files   (was 828 in 21; the new
                       auth-gotrue suite is 20 of the difference)
pnpm typecheck         redundant — pnpm build type-checks
./scripts/db-test.sh   not run: no policy or definer function was touched, and
                       the real project could not be reached to run it there
```

`CLAUDE.md` is the authority: **`pnpm build` then `pnpm smoke`**, and nothing
else unless asked. `pnpm test` was run here because `src/lib/auth/` is a pure
module by that rule's own carve-out.

---

## Known bugs and rough edges

**34 entries.** 4, 7, 32, 33 and 35 are closed and are not renumbered, because
the numbers are referred to by three other documents. **36, 37, 38 and 39 are
new**; 37, 38 and 39 are closed in the same branch that opened them.

### New in session 15

36. **The refresh path discards the rotated token, and the session dies.**
    Finding 1 above. **Open, and the most serious thing in this list**: an idle
    hour costs you your session, permanently, on the live deployment. Needs
    middleware; argued in the decisions log.
37. **Closed.** Identity was resolved twice per render, and the duplicate burnt
    Supabase's reuse grace at age 0.0s. `cache()`.
38. **Closed.** `redirect_to` was sent in the body, where GoTrue does not read
    it, so every magic link and confirmation email went to the Site URL.
39. **Closed.** An unreachable Supabase threw into the database error page
    instead of returning a sentence.

### Carried over

1. **The `supabase` provider's refresh path.** *Superseded by 36: it has now
   been watched, and it is broken. This entry is kept only because three
   documents point at the number.*
2. **A raw invitation token lands in the browser's history.**
3. **`pnpm smoke` leaves invitation rows behind** — two per run. `pnpm seed`
   clears them. The suite is checked to pass **twice in a row without a
   reseed**, and it did again this session.
5. **Editing one occurrence's *details* is not built.**
6. **A trip's journeys are not re-checked against its dates.**
8. **The queue survives a user switch** and a sign-out.
9. **`SYNCABLE_FIELDS` is narrower than the forms**, and only
   `/tasks/item/[id]` has an offline surface.
10. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.**
11. **`applyWrite` interpolates column names with `tx.unsafe`** from a closed
    list re-checked in the server action.
12. **The push window is every dirty event, capped at 200, oldest first.**
13. **A push does not delete.** Still the one with the most teeth among the
    integration edges: a cancelled event stays in somebody's Google calendar.
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
    `AUTH_PROVIDER` is not `dev`, and **confirmed absent on the live
    deployment** this session. The entry stays for its description of what
    `switchUser` is.
23. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.**
24. **The Markdown subset has no tables, no images, no task lists.**
25. **The people list's "next date" is computed twice.**
26. **A person's category is resolved back from its *name*** on the detail page.
27. **Contacts cannot be edited, only added and removed.**
28. **Search covers five kinds and no more.**
29. **Capture's space hint is one token**; a captured note gets an empty body.
30. **The AI result is carried on the URL**, on three pages.
31. **Environment and tooling.** Postgres does not survive container restarts;
    `pg_ctlcluster 16 main start` brings it back without reseeding.
    Use `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done` — note
    the bracket, **and use the same trick for any other process name you kill
    from a shell**: session 15 killed its own shell twice with
    `pkill -f stub-gotrue`, because the command line contains the pattern.
    There is no linting, out of scope by instruction. `pnpm smoke` needs a
    running server, Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and **port 3101 free**.
    `pnpm start` prints a harmless `output: 'standalone'` warning.
34. **A preference belongs to a browser, not to an account.** Theme, week start
    and default compose space are cookies, so a second device starts at the
    defaults.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
pg_ctlcluster 16 main start    # if Postgres is not already up
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
pnpm build                     # also generates the typed-route definitions
pnpm start                     # http://localhost:3000
pnpm smoke                     # 456 checks; also starts a second server on :3101
```

On request only: `./scripts/db-test.sh` (175 pgTAP assertions) and `pnpm test`
(860 Vitest tests).

Start the server so it survives the shell that launched it:

```sh
setsid nohup pnpm start > /tmp/next.log 2>&1 < /dev/null & disown
```

**Env vars** — copy `.env.example` to `.env`; every value has a working default
and **no credential is required**.

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

### Running the app against a stub GoTrue

This is how the refresh path was watched, and it is worth keeping. It needs no
credential and it is the only way to exercise `AUTH_PROVIDER=supabase` here.

Write a stub serving `/auth/v1/token` (both grants), `/auth/v1/user`,
`/auth/v1/otp`, `/auth/v1/signup` and `/auth/v1/logout`. Issue access tokens
with a short `exp` and a `sub` equal to a **seeded profile id**, so
`app.identity_profile` finds a row. Rotate refresh tokens, keep a 10-second
reuse grace, and revoke the family on reuse after it — that is Supabase's
documented behaviour and it is what makes edge 36 visible.

```sh
AUTH_PROVIDER=supabase SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=anything \
DATABASE_URL='postgres://orbit_app:orbit_dev_password@localhost:5432/orbit' \
APP_URL=http://localhost:3000 NODE_ENV=production npx next start -p 3000
```

Sign in, idle past the access token's life, load a page, wait ten seconds, load
another. You will be signed out. That is edge 36.

---

## Next three things, in order

1. **Edge 36 — make the refresh path keep the token it was given.** Nothing else
   in this list matters as much: on the live deployment, an idle hour costs
   somebody their session and only a fresh sign-in recovers it. The shape of the
   fix is in the decisions log — refresh in middleware, which is the only
   context that may write cookies, with the GoTrue call lifted into a module
   that imports neither `server-only` nor the pool. It needs a real project to
   verify, so it belongs with item 2.
2. **The acceptance pass Brief D actually asked for, with credentials.** Every
   item under *"Not watched at all"* above, in the runbook's order, starting
   with the database ground: the trigger, `u.id = p.id`, `orbit_app`'s
   privileges, `provision_missing_accounts()`, then `db-test.sh` against the
   real project. Then a magic link received and followed — **edge 38's fix is
   unverified against a real project and the whole flow is unobserved** — then a
   second account and an invitation with each role including `free_busy`.
   Note the two environment constraints found this session: the browser cannot
   reach the deployment from a container like this one, and `pnpm seed` must
   never be run against the real project.
3. **Edge 13 — a push does not delete**, and **edge 16 — nothing runs a
   `schedule` rule on a schedule.** 13 means a cancelled event stays in
   somebody's Google calendar for good; 16 is why the rules engine's `schedule`
   trigger is a shape with nothing behind it.

After those, **shared lists (shopping)** is the one household verb genuinely
missing, and it is large and needs a migration.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, keep `docs/phase-plan.md` accurate,
append to `docs/decisions-log.md`, and push. The container is ephemeral. Push at
least hourly.
