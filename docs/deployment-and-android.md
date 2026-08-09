# Real accounts, deployment, and a narrow Android client

Written session 9. Rewritten session 14, because most of it had come true.

**Supersedes the first version of this file**, which recommended a Capacitor
WebView shell around the dev-auth build. That plan is withdrawn: with real
accounts the phone can talk to Supabase directly, and the shell stops being
worth building.

**What has changed since session 9.** Brief A (§4) has landed — real accounts,
the `auth.users`→`profiles` join and space invites are in the repository and on
a real Supabase project. Orbit is deployed on Vercel against that project, and
`AUTH_PROVIDER=supabase` is the provider serving it. Brief B (§5) is not
started and stays a brief.

**What that does not mean.** "Deployed" is not "acceptance-tested". Sign-in
against a real project has demonstrably run — two of session 13's bugs were
reported from one — but nobody has yet watched the refresh path, a magic link,
or an invitation redeemed by a second real account, and those are the parts
STATUS has flagged for four sessions as where surprises will be. Section 6 is
still a list of things a person has to do. Nothing here upgrades any other
integration: every provider still lacking a credential is *written, never run*,
and the Android client is unbuilt.

---

## 0. Two ways onto a phone, and only one of them is ready

Nothing in the first version of this file distinguished these, because when it
was written there was only one plan. There are two now and they are at very
different stages.

### Install the web app — ready, and it is what to use today

Orbit is an installable PWA. Open the deployed URL in Chrome on Android and use
**Add to home screen**; on iOS, Safari's **Share → Add to Home Screen**.

- `src/app/manifest.ts` declares the name, the standalone display mode and the
  full icon set — SVG, 192 and 512 in `any`, 192 and 512 `maskable`, and a
  monochrome mask for the OS to tint. The PNGs are committed, not build output,
  so an environment that never runs `pnpm icons` still serves them.
- Session 10 made the layout work on a phone: a bottom tab bar and a drawer
  below `md`, task rows that keep the title on screen, `--tabbar` as one token.
- Session 12 added a service worker, so an installed Orbit that loses signal
  shows a page explaining itself rather than a browser error. It is a **shell**:
  it caches `/offline`, the manifest and `/_next/static/`, and deliberately
  caches no page rendered for anybody.
- Offline *editing* is a different mechanism and it is real — `src/lib/sync/`,
  with an outbox, named conflicts and per-device cursors.

**What you get:** all of Orbit, because it is Orbit — rules, travel, places,
search, the sync console, the settings surface. **What you do not get:** a Play
Store listing, a share-target intent, or native notifications. Web push exists
as an interface and `push:webpush` is *written, never run*.

The service worker registers only on a secure origin, so over plain HTTP this is
a silent no-op and Orbit behaves exactly as it did before.

### A native APK — not started

There is no `android/` directory. §5 is the brief for one, unchanged in scope
and updated for the things that moved underneath it.

Its case is weaker than when it was written, and that is recorded rather than
hidden: session 10 made the web app usable and installable on a phone, and
session 12 made it behave when the signal drops, which was most of what a native
client was for. What remains genuinely native — a home-screen widget, a share
target, notifications the OS delivers — is not what §5 builds.

---

## 1. The two decisions

**Sharing is by space, not by linking accounts.** `orbit.spaces` is "the unit of
sharing" and `spaces.id` is the `space_id` on every space-scoped table.
`space_members` maps user→space with a role from
`('owner','admin','member','viewer','free_busy')`, and all 41 tables' policies
key off `app.is_space_member`, `app.can_see_space_content` (which excludes
`free_busy`) and `app.is_space_admin`. Account-to-account linking would mean
rewriting every one of those policies. Invites into a space meant writing a
redeem flow and nothing else.

`orbit.space_invites` already existed — `token_hash`, `role`, `expires_at`,
`accepted_at`, `accepted_by`, RLS for admins in both directions. It had no rows
because of a deliberate session-5 decision:

> *space_invites needs an auth system that can invite a stranger; auth here is a
> cookie naming a seeded profile, so an invite would be a row nothing could
> redeem.*

Brief A supplied the missing half, and that decision is **closed rather than
overturned** — recorded that way in `docs/decisions-log.md`. The table has rows
now, written through `app.space_invite()`, and no column was added to it.

**The Android client is deliberately narrow.** About 3,800 lines of behaviour
live in TypeScript, not in the database: `rules.ts` (890), `recurrence.ts`
(567), `travel.ts` (480), `sync/conflict.ts` (458), `calendar.ts` (294),
`search.ts` (232). The Vitest suite that covers those modules and the rest of
`src/lib/` stood at **828** at the end of session 13. A second implementation in Kotlin
would drift, silently, about dates — session 8 already found a real `UNTIL`/BST
bug in `recurrence.ts` by writing a test the Kotlin side wouldn't have.

So the phone app does **Today, capture, tasks, calendar read, notes** and
nothing else. The rules builder, travel derivation and the sync console stay on
the web. This is why the phone app gets its own spine and its own design: it
has a different job, not a smaller screen.

---

## 2. What real auth changed, and how the three gotchas actually resolved

The minimal change kept everything, and that prediction held:

- The Next server verifies the Supabase session, takes `sub`, and hands it to
  the **existing** `asUser(userId, fn)` in `src/lib/db/index.ts`. That function
  still does `set local role authenticated` and sets `request.jwt.claims`. Every
  query, every policy and all 175 pgTAP assertions work unchanged.
- The Android client, when it exists, talks to PostgREST directly with its own
  JWT. Supabase sets the same GUCs from that token, so **both clients converge
  on the same RLS** with no shared code and no API layer in between.
- `AuthProvider` in `src/lib/auth/index.ts` was written for this. Nothing that
  calls `getCurrentUser()` changed.
- `src/lib/queries/*` was **not** rewritten to use supabase-js. That was the
  right call: 8,363 lines of working, tested SQL solving a problem it does not
  have.

`asUser` gained one thing it did not have in session 9: an optional `identity`
argument carrying the verified `email` and display name, used by exactly one
caller — the function that gives a profile to an account that has none. It is
not a new trust boundary; the reasoning is in `src/lib/db/index.ts` and at
greater length in the decisions log.

### Gotcha 1 — `profiles.id` must equal `auth.uid()`

**Resolved, and then resolved again for a case the brief did not foresee. This
is the one that mattered.**

`0012_auth_user_profiles.sql` adds `on_auth_user_created` on `auth.users`,
calling `app.profile_for_new_auth_user()` — `SECURITY DEFINER`, `search_path`
pinned, `revoke execute … from public` — which creates the profile **with the
auth user's own id**. Not in application code, deliberately: the Android client
would talk to PostgREST directly and never run it. A `profiles_email_key`
collision raises rather than quietly attaching somebody to a seeded profile's
tasks. The display-name order is the same one `displayNameFrom()` implements in
`src/lib/auth/session.ts`, and pgTAP is what catches it if only one is changed.

The brief's second question — what happens to seeded ids — was answered
plainly, as it demanded: **seeded data is development data and a real deployment
starts empty.** Seeded ids are literals chosen so tests can name them and GoTrue
will never issue one.

Then the real project produced this, on trying to create a space:

> There is no profile for the signed-in account (c9905550-…).

A trigger on insert cannot fire for a row that is already there, and on a real
project the auth users are **normally** there first: people sign up, or get
invited from the dashboard, and *then* the schema arrives. Every such account
signs in fine — the provider falls back to the JWT's own claims, so the app
renders and says who you are — and then nothing works, because `auth.uid()`
names a profile that does not exist and every policy correctly sees a stranger.
The silent-empty-app failure this gotcha was written to prevent, arriving
through a door the gotcha did not cover.

`0016_adopt_existing_accounts.sql` closes it three ways: per request when such
an account next loads a page (`app.ensure_account`), project-wide for an
operator (`app.provision_missing_accounts`, which inspects by default and does
nothing unless asked), and once at the bottom of the migration for everybody
already waiting. The email is never a function argument — that would let an
account choose the address `app.space_invite()` matches `invited_email` against
— so `app.identity_of()` reads it from the verified claims, then `auth.users`,
then a `<uuid>@no-email.invalid` placeholder repaired later by a real token.

**Verify it on any project you deploy to**, exactly as `docs/runbook.md` says:
the trigger exists, and after one sign-up `u.id = p.id` is `t`.

### Gotcha 2 — `0000_bootstrap.sql` replacing `auth.uid()`

**Resolved by procedure, not by code, and on purpose.** The unguarded
`create or replace function auth.uid()` is still at line 41 of
`0000_bootstrap.sql` and is still expected to be refused on Supabase, where that
function belongs to `supabase_auth_admin`.

The fix is to skip it rather than force it: the shim reads exactly the same GUCs
as Supabase's own, so Supabase's version is already correct. Operationally that
means running `0000` **on its own with `ON_ERROR_STOP=0`** — under
`ON_ERROR_STOP=1` the refusal aborts the file before `create schema orbit`, and
every later migration then fails with `schema "orbit" does not exist`.
`docs/runbook.md` §0 and `docs/deploy.md` §1 both carry this, with the list of
which failures are expected and harmless.

### Gotcha 3 — `orbit_app` owns nothing and holds no BYPASSRLS

**Resolved as documented commands, and it is the one still worth checking by
hand on the live project.** The role must exist, be able to log in, own nothing
and hold no BYPASSRLS; it gets `usage` on `orbit`, `app` and `auth`, the
`authenticated` and `anon` roles, and `execute` on the two narrow identity
functions — **no table grants at all**. `docs/deploy.md` §1 has the SQL and the
two confirmation queries.

One addition since session 9: on Supabase's **transaction pooler** the role name
is tenant-qualified, `orbit_app.YOUR-REF`, which is easy to miss and fails as an
authentication error rather than as anything descriptive.

No session can verify this remotely, and no record in this repository says
anybody has. `./scripts/db-test.sh` asserts the property locally, and that
assertion is worth exactly nothing if the deployed role is different.

---

## 3. Deployment: two supported shapes

Both are supported. The choice is about the shape of the process, and at
runtime it decides three environment variables and nothing else: no code in
`src/` branches on the host, because the shape of a deployment is a deployment
decision and belongs in the deployment's own configuration rather than being
inferred by the app. The one place the host is named is `next.config.ts`, and
that is about what gets *built*, not about how anything behaves.

**Database, either way:** Supabase. Run `supabase/migrations/*.sql` in order per
gotcha 2 above; needs `pgcrypto`, `postgis` and `vector`, plus `pgtap` if you
want `db-test.sh` there. Orbit's tables live in the `orbit` schema and its
helpers in `app`, so it can share an instance with another application.

### The reasoning, which is unchanged and now resolves differently

A connection pool is **an asset in a process that outlives the request and a
liability in one that does not**. That is exactly right, and it is why the first
version of this section said "not Vercel".

What it missed is that the sentence only bites while *the app pools for itself*.
Against Supabase's transaction pooler the pooling happens in Supavisor, and the
app's own pool becomes a single connection it holds for the length of one
invocation. The liability is gone because the pool is gone — handed to the thing
built to do it.

So the same reasoning now supports both answers, and which one is better is a
cost question rather than a correctness one.

### Shape one — a long-lived container

Fly.io, Railway, or any Docker host. `next start` from `output: 'standalone'`,
which `next.config.ts` sets everywhere except Vercel, and which the Dockerfile
copies.

| | |
|---|---|
| `DATABASE_URL` | session mode, **port 5432** |
| `DATABASE_POOL_MAX` | unset — the default of 10 is what one long-lived process is for |
| `DATABASE_PREPARE` | unset — prepared statements work on a real connection |

`fly.toml` is committed because two `fly launch` defaults are wrong here and
both fail quietly: `auto_stop_machines` throws the pool away between requests,
and `internal_port` defaults to 8080 while Next listens on 3000. Point the
health check at `/health`, which runs `select 1` — "did the port open" is true
of a container that cannot serve a page.

### Shape two — a serverless function

Vercel. `next.config.ts` drops `output: 'standalone'` when `VERCEL` is set,
because that directory is for the Docker image and Vercel builds its own.

| | |
|---|---|
| `DATABASE_URL` | the **transaction pooler**, port 6543, role `orbit_app.YOUR-REF` |
| `DATABASE_POOL_MAX` | **`1`** — one process per concurrent request, each with its own pool. Ten there is ten × however many instances the platform started, which is how a quiet app exhausts a database in its first busy minute. |
| `DATABASE_PREPARE` | **`false`** — the transaction pooler hands a different backend to every statement, so a prepared statement is never there when it is used again and `asUser`'s queries fail with *prepared statement does not exist*. |

Both are environment variables rather than a code branch on `process.env.VERCEL`
— see `src/lib/db/config.ts`, where `poolMax()` also refuses to turn anything
unparseable, zero or negative into a pool of `NaN`.

**What serverless costs and buys:** it sleeps, which is the point — no idle
bill, and a cold start on the first load after a quiet spell. For an app opened
a few times a day that is the right trade. A tab that polls on an interval would
defeat it entirely. `/health` still answers but nothing consumes it, there being
no machine to take out of rotation.

**This is what is running.** Orbit is deployed on Vercel against a real Supabase
project with `AUTH_PROVIDER=supabase`. `docs/runbook.md` §4 is the current
sequence for all three hosts; `docs/deploy.md` is the reference.

Whichever shape: `AUTH_PROVIDER=supabase`, and **do not set
`ORBIT_ALLOW_DEV_AUTH`**. Since session 12 a production build refuses to serve
any page under `AUTH_PROVIDER=dev`, because `dev` is impersonation by design and
the dangerous case was never a typo — it was forgetting to set a variable.

---

## 4. Brief A — what was asked for, and what was built

**This brief has been run.** It is kept as a record rather than deleted, so the
things it specified can be checked against the things that exist. The phases
below are the brief's own; each carries what actually landed.

### Phase 1 — Supabase Auth behind the existing interface — **delivered**

`src/lib/auth/supabase.ts` implements a second provider selected by
`AUTH_PROVIDER=supabase`, written against the published GoTrue REST API —
`/token`, `/signup`, `/otp`, `/verify`, `/user`, `/logout`. `dev` stayed the
default and stayed fully working, so the zero-credential run still holds.

Three deliberate refusals, all as the brief required: **no service-role client**
(the provider establishes only *who* the caller is; `asUser` and the policies do
the rest), **no SDK** (a dependency this repo cannot execute is one nobody can
check), and **no local JWT verification** — verifying a signature needs the
project's secret or its JWKS, and a wrong answer there is a silent
authentication bypass, so `GET /auth/v1/user` asks the issuer instead.

Email/password and a magic link; no OAuth providers, since each is console
configuration nobody here can verify. Sign-in, sign-up, sign-out and callback
screens under `src/app/auth/`, built from existing tokens. Both magic-link
shapes are handled: `{{ .TokenHash }}` server-side, and the default
`ConfirmationURL` whose tokens arrive in a URL *fragment* that never reaches a
server, read in the browser by `CompleteSignIn.tsx`.

Session cookies are `httpOnly` — an access token readable by script is one XSS
away from being somebody else's session — and `secure` under
`NODE_ENV=production`.

**Delivered beyond the brief:** the brief asked for the user switcher to be
*hidden* when `AUTH_PROVIDER` is not `dev`. Session 12 went further and made a
production build with dev auth **refuse to serve any page**, naming what to set
instead, with `ORBIT_ALLOW_DEV_AUTH=1` as the escape hatch that `pnpm start`
sets and the Dockerfile deliberately does not.

### Phase 2 — the profiles/auth.users join — **delivered**

`0012_auth_user_profiles.sql`, and it was the one migration the brief
authorised. Covered in §2 above along with the case it did not anticipate.
pgTAP went up, as instructed, and has kept going up: 83 assertions at the time
of the brief, 175 today.

### Phase 3 — invites — **delivered, and with no migration of its own**

The brief's hardest constraint held: `orbit.space_invites` had every column this
needed and **no column was added**. `app.space_invite()` — the single authorised
`SECURITY DEFINER` exception, `revoke execute … from public`, granted to
`authenticated` — takes the raw token, hashes it, and does the check and the
insert in one transaction. No policy was loosened and no service-role client was
added.

An admin creates an invitation with a role, an expiry and an optional
`invited_email`; the raw token is shown **once** as a link and never stored.
Redeeming shows which space and which role before accepting. Expired,
already-accepted and wrong-space tokens each fail with a sentence. Revoking and
removing use `space_members.status = 'left'` rather than deleting, and
`free_busy` is offerable.

The brief's named acceptance case exists and is thorough: `scripts/smoke.mjs`,
section *"spaces, invites, roles"*, drives Sam Okafor the outsider through a
made-up token, an invitation addressed to somebody else, one already accepted,
one expired, and an unauthenticated redemption that lands on `/auth/signin`. He
gets a sentence every time. The section also revokes and expires everything it
creates, so the suite still passes twice in a row against the same database.

### Phase 4 — deployable, written down — **delivered**

`output: 'standalone'`, a Dockerfile that builds it, and `docs/deploy.md` with
the migration order, the three gotchas and the pooler note. The brief said
*deploy nothing*, and that session did not. `docs/runbook.md` came later and is
now the more current of the two.

### Specified but not delivered as specified

- **"One migration … the only one this brief authorises."** Three more schema
  migrations followed in session 13 — `0014_space_creation.sql`,
  `0015_default_spaces.sql`, `0016_adopt_existing_accounts.sql` — none of them
  in this brief's session, and each argued in `docs/decisions-log.md` before it
  was written. They exist because Brief A left a real account able to sign in
  and then do nothing: 0012 gives a new account a profile, and a profile owns no
  space, and every space-scoped table takes a `space_id`. A deployment whose
  first user cannot create anything is a deployment with no first user.
- **`pnpm typecheck` as a separate command.** Still green, but `pnpm build`
  type-checks, so the repository's standing instruction now treats a separate
  run as redundant on a change that builds. `pnpm smoke` is the check to run.
- **"You cannot test against a real Supabase project."** True when written, and
  no longer true. What that changes is in §2 and in the status note at the top
  of this file: sign-in has run, and most of the rest of the flow has not been
  watched.

---

## 5. Brief B — the Android client

**Not started.** Read §0 first: the PWA is the phone answer that exists, and it
covers more than this brief does. Build this one because you want a native
client, not because Orbit is unusable on a phone.

The two preconditions in the original are now met — Brief A is merged and a
Supabase project exists — so what follows is buildable rather than blocked.

> ## Brief B: Orbit for Android
>
> Work on `bullah12/Orbit`, branch `claude/orbit-android`, created from `main`.
> Read `docs/STATUS.md` and §0, §1 and §5 of `docs/deployment-and-android.md`
> first.
>
> **Work autonomously.** Every ambiguity has a rule below; where one is missing,
> pick the smaller option and write it in `docs/decisions-log.md`.
>
> ### Scope, which is the most important part of this brief
> The app does **Today, capture, tasks, calendar read, notes**. It does **not**
> do rules, travel, places, search, the sync console, or AI. That is not a
> phase-one cut to be revisited — it is the design, because those features live
> in ~3,800 lines of TypeScript that a Kotlin reimplementation would duplicate
> and then drift from. **If you find yourself porting `recurrence.ts`,
> `rules.ts`, `travel.ts` or `conflict.ts`, stop: you have left the scope.**
>
> Calendar is **read-only** for exactly this reason: displaying stored events is
> a query, but creating a repeating one needs RRULE expansion. Read the expanded
> occurrences the server already computes, or show only non-repeating events and
> say so on screen. Do not expand an RRULE in Kotlin.
>
> ### Build it
> - Kotlin, Jetpack Compose, Material 3, `min SDK 26`. A new top-level
>   `android/` directory in this repo.
> - `supabase-kt` talking to the Supabase project directly: GoTrue for auth,
>   PostgREST for data. **No Next.js server in the path and no custom API.**
> - Auth: email/password and magic link, matching what shipped in
>   `src/lib/auth/supabase.ts`. Session persisted with
>   `EncryptedSharedPreferences`.
> - A space switcher, since every row is space-scoped and an account has at
>   least two: migration 0015 gives every new account **Personal** and **Work**,
>   and Personal is `protected` — it cannot be deleted, by anybody, through any
>   path. Do not offer a control that would try.
> - Its own design. It should not imitate the web layout — that sidebar is a
>   desktop shape. Bottom navigation, one screen per section.
> - **Take the colours from `src/app/globals.css`, and note that they all
>   changed in sessions 12 and 13.** Do not work from any older list.
>   - The palette is **one set of tokens using `light-dark()`**, not two blocks
>     — each declaration holds the light value first and the dark value second.
>     Kotlin has no equivalent, so read **both halves** of each token into two
>     Compose colour schemes. A port that takes only the first half ships an app
>     with no dark mode against an app whose dark mode is half of every token.
>   - Chrome: `--bg`, `--bg-raised`, `--bg-sunken`, `--bg-hover`, `--bg-pressed`,
>     `--text`, `--text-muted`, `--text-faint`, `--line`, `--line-strong`,
>     `--accent`, `--accent-hover`, `--accent-pressed`, `--accent-text`,
>     `--focus-ring`. Status: `--danger`, `--warning`, `--success` and their
>     `-bg` pairs. Categories: ten, `--c-rose` through `--c-slate`, each with a
>     `-bg` pair — **re-solved in session 13**, so any value you remember is
>     wrong.
>   - They are `oklch()` and Compose wants sRGB. Convert once, in one place, and
>     check the result against the ratios `tests/contrast.test.ts` asserts rather
>     than by eye — the reason that test exists is that this palette is chosen
>     for measured contrast in both themes.
>   - Category colour stays the only strong colour, and never appears without an
>     icon and a label beside it.
> - **The launcher icon comes from `public/icons/src`, not from a pen.** Session
>   13 produced the icon set and the SVG sources are committed:
>   `orbit-icon.svg`, `orbit-icon-maskable.svg`, their `-dark` variants, and
>   `orbit-favicon.svg` (thickened for small sizes). Use
>   `orbit-icon-maskable.svg` as the adaptive icon's foreground — its safe zone
>   is already drawn for exactly the constraint Android's mask imposes — and
>   take the background from the same source rather than inventing one.
>   `scripts/icons.mjs` shows how the web set is rasterised. **Do not redraw the
>   mark, do not re-letter it, and do not add a badge to it.**
> - Offline: read-through cache with Room, and a write queue for capture and
>   task edits only. **Do not port `src/lib/sync/outbox.ts` or `conflict.ts`** —
>   the web outbox is `localStorage`-shaped and `conflict.ts` assumes a single
>   queue. Last-write-wins on `updated_at`, and say so in the log; a second
>   conflict resolver is out of scope.
>
> ### CI
> - `.github/workflows/android.yml`: on push to this branch and on
>   `workflow_dispatch` — JDK 21, Android SDK, `./gradlew assembleDebug`, upload
>   `app-debug.apk` as an artifact, 30-day retention.
> - Supabase URL and anon key from repository **variables** (the anon key is
>   public by design and RLS is what protects the data — do not treat it as a
>   secret, and do not put the service-role key anywhere near this repo).
> - Debug-signed only. **Generate no release keystore. Publish nowhere.**
> - Add `./gradlew testDebugUnitTest` to the workflow and write unit tests for
>   the repository layer and the write queue.
>
> ### Rules
> - **Do not modify anything under `src/`, `supabase/` or `scripts/`.** If the
>   Android client needs something the schema does not expose, write down what
>   and why in `docs/decisions-log.md` and work around it. A schema change is a
>   separate session with its own brief.
> - **This container has JDK 21 and no Android SDK, and no emulator.** You
>   cannot build or run the app here. CI is what compiles it. **Do not claim the
>   app works, do not claim a screen renders, and do not let a green workflow
>   stand in for either.** In STATUS it is *written, never run* until I have
>   installed it.
> - **The web app must still be green when you finish** — `pnpm build` then
>   `pnpm smoke`, per `CLAUDE.md` — because you have not touched it. Verify
>   rather than assume.
>
> ### Finishing
> Push hourly. Stop at three-quarters of context, rewrite `docs/STATUS.md`
> including a new section for the Android client and its honest status, append
> to `docs/decisions-log.md`, and push. Open a PR titled "Orbit for Android:
> today, capture, tasks, calendar, notes". List the by-hand steps: set the
> repository variables, download the artifact, enable unknown sources, sideload.
> Do not merge it.

---

## 6. What is still done by hand

Steps 1 to 3 have been done at least once — that is what "deployed on Vercel"
means. They are kept because they are the sequence for any new project, and
because parts of step 4 have never been finished.

1. Create the Supabase project; run the migrations in order; create `orbit_app`
   and confirm it owns nothing. `docs/runbook.md` is the ordered sequence.
2. Deploy the web app; set `AUTH_PROVIDER=supabase`, the connection string and —
   on Vercel — `DATABASE_POOL_MAX=1` and `DATABASE_PREPARE=false`.
3. Sign up, and check `u.id = p.id` before anything else. **Done**, and the two
   bugs it surfaced are closed by migrations 0014–0016.
4. **The acceptance pass, which has not happened.** Sign in, sign out, a magic
   link, and **let a session expire so the refresh path runs** — that last one
   is the specific line STATUS has flagged for four sessions. Then a second
   account, an invitation with each offerable role including `free_busy`,
   accept, decline, expire, revoke, remove. `docs/remaining-work.md` §5 is the
   prompt for the session that does this and writes down what it watched.
5. Set the Android repository variables; run the workflow; download the APK;
   sideload it. **Not reachable** — §5 is a brief, not an app.

Step 4 is the one that turns "running in production" into "works", and until
somebody does it the difference between those two phrases is the honest state of
this project.
