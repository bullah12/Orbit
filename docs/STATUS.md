# STATUS — handoff contract

Last rewritten: **session 9**, 2026-07-31. Branch:
`claude/orbit-real-auth-lccfs6`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is: Orbit was finished at the end of session 8, and session
9 made it usable by somebody who is not a seeded row.** Phases 0–6 built the
product; this session added real accounts, the `auth.users`→`profiles` join, and
space invites, plus a Dockerfile and a deployment guide. It is Phase 7 in
`docs/phase-plan.md` and it is complete. It did **not** add a feature to the
product, and inventing a Phase 8 is not the job.

**Five commands are the whole truth about this repo.** All five were run at the
end of session 9 from a database rebuilt with `./scripts/db-reset.sh`, and all
five were green:

```
./scripts/db-test.sh   106/106 pgTAP assertions   (was 83)
pnpm build             clean
pnpm typecheck         clean (needs the build first on a fresh clone)
pnpm test              692 Vitest tests in 15 files   (was 637)
pnpm smoke             382/382 against the running app   (was 337; needs pnpm start)
```

`pnpm smoke` was run **twice in a row without reseeding** after that rebuild and
passed both times, 382/382 each time — including the new invite section, which
revokes the invitations it makes and removes the member it adds.

---

## The one thing to understand before you touch anything

**`AUTH_PROVIDER=supabase` has never run.** There is no Supabase project, no
credential and no network in this container. The provider is a complete
implementation of Supabase's GoTrue REST API and not one line of it has ever
sent a request — exactly like `calendar:google` and `ai:anthropic`, and it is
listed on those terms in the integration table below.

**Do not let `AUTH_PROVIDER=dev` passing stand in for it.** What *is* proven is
narrower and worth stating precisely:

| Claim | How it is proven |
|---|---|
| The dev provider still works end to end with zero credentials | 692 Vitest, 382 smoke, all five commands |
| The switcher is unreachable under a real provider | a second server on :3101 with `AUTH_PROVIDER=supabase`, driven in smoke |
| The dev cookie stops being a session under a real provider | same section, with `orbit_user` deliberately set |
| A missing credential is a sentence, not a 500 | same section: the sign-in form comes back naming `SUPABASE_URL` |
| The trigger creates a profile with the auth user's id | pgTAP, against the local `auth.users` shim |
| Invites work end to end, with policies deciding | pgTAP (18 assertions) and smoke (30 checks), through the running app |
| **Signing in to Supabase works** | **nothing. It has never been attempted.** |

The invite flow, unlike the provider, **does** run here: dev auth is enough to
be a real signed-in person, so creating, previewing, accepting, declining,
revoking and removing are all exercised against real policies.

---

## Works — verified by running it

Everything here was executed and watched.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both asserted structurally.
- **One migration this session, `0012_auth_user_profiles.sql`** — the third
  schema extension in nine sessions, and the only one this brief authorised. It
  adds no table and alters none. It contains two things:
  1. a guarded `auth.users` shim (a no-op on Supabase) and a trigger on its
     insert that creates the matching `public.profiles` row **with the same id**;
  2. `app.space_invite(token, action)`, the one SECURITY DEFINER function that
     lets somebody redeem an invitation to a space they are not in.

**pgTAP — `./scripts/db-test.sh`, 106/106** (was 83, **+23**)
- Runs as `authenticated`, not the table owner.
- **"The outsider sees zero rows in every table in the database"** still iterates
  `pg_tables` rather than a hand-written list.
- **+5 for the trigger** (section 11): the trigger exists; a new auth user gets a
  profile with the same id; the display name comes from `raw_user_meta_data`;
  with no metadata it falls back to the email local part; a colliding email is
  refused rather than silently attached to the existing profile.
- **+18 for invites** (section 12): an admin can invite and an ordinary member
  cannot; the person holding the link cannot read the invite row at all; the
  function shows them the space and the role; an unissued token is `unknown`; an
  expired one is `expired`; one addressed to somebody else is `wrong_person` and
  creates no membership; accepting grants exactly the named role; the invite
  records who accepted it; a second accept is refused; joining is not a way into
  private rows; a revoked invitation stops working; a member set to `left` sees
  zero rows again.
- **The known-empty ledger is now two tables**: `attachments` and
  `person_relationships`. `space_invites` left it — the seed writes one pending
  invitation.

**TypeScript tests — `pnpm test`, 692 Vitest tests in 15 files** (was 637)
- `tests/auth.test.ts` (29, new) — which provider is live and the fact that
  anything not `dev` hides the switcher; reading a token without trusting it;
  when an access token is past using, including the 30-second margin and the
  "cannot parse it, so treat it as expired" rule; the display-name order, pinned
  against the SQL in 0012; parsing a token response into a session or a stated
  error; what a failure is allowed to say; and that `safeNextPath` refuses
  anything that could leave the site.
- `tests/invites.test.ts` (26, new) — the token is 256 bits, URL-safe and never
  repeats; it hashes to the same thing migration 0012 hashes it to (the test
  reads the migration); `free_busy` is offerable and `owner` is not, with the two
  lists together naming the whole enum; expiry parsing refuses an empty box by
  name rather than reading it as zero; and **every one of the ten statuses has a
  sentence** that names no status code.
- `tests/rules.test.ts` (78), `tests/capture.test.ts` (99),
  `tests/sync.test.ts` (59), `tests/travel.test.ts` (55),
  `tests/recurrence.test.ts` (54), `tests/search.test.ts` (50),
  `tests/integrations.test.ts` (47), `tests/calendar.test.ts` (42),
  `tests/format.test.ts` (42), `tests/smartlists.test.ts` (32),
  `tests/markdown.test.ts` (30), `tests/contrast.test.ts` (26),
  `tests/ai.test.ts` (23) — unchanged. **No new colour was introduced**, and
  `tests/contrast.test.ts` still passes.

**Smoke — `pnpm smoke`, 382 checks against the running app** (was 337)
`scripts/smoke.mjs` drives Chromium against `pnpm start`. 45 checks are new.

| Acting as | Result |
|---|---|
| Priya | `/spaces` lists her spaces and her role in each; a space names its people and its pending invitations; the seeded invitation shows when it expires; the space owner has no Remove button. She makes an invitation, its link is shown **once** and is gone on reload; she makes a second, free/busy one; she removes a member and revokes the unredeemed invitation, and the revoked row stays, marked expired |
| Sam Okafor (outsider) | 404 on a space he is not in, never 403. A token nobody issued is a **page** saying the link is not recognised — not an error, and it does not name a space. **An invitation addressed to `danny@orbit.test` is refused with a sentence naming that address**, HTTP 200, with no Accept button and no membership created. A bearer link he does hold names the space and the role first; declining says nothing was changed and the link is still live; accepting joins him as free/busy — he sees the space in the sidebar and not one event in it; accepting again is refused; after removal he sees nothing again |
| Danny (partner) | an invitation to a space he is already in says so rather than re-adding him; as an ordinary member of Home he sees the roster, is told inviting is an admin's job, and is offered no form |
| Nobody, on a second server with `AUTH_PROVIDER=supabase` | a page with no session goes to `/auth/signin` (HTTP 200, not 403); the `orbit_user` cookie naming Priya is **not** a session; **no sidebar is rendered, so the switcher is unreachable**, and there is no `button[name=userId]` anywhere; the sign-in page offers a password and a magic link and **no OAuth buttons**; signing in with no project configured comes back with a sentence naming `SUPABASE_URL`; an invitation link opened by nobody asks them to sign in |
| Priya, back on the dev server | the switcher **is** offered, there is no sign-out control because there is no session to end, and `/auth/signin` says `AUTH_PROVIDER=dev` and offers no password box |

**App — new this session**
- **`/auth/signin`, `/auth/signup`, `/auth/signout`, `/auth/callback`.** Styled
  from the tokens already in `globals.css`; no colour was invented. Under `dev`
  they render and say what is actually running rather than 404ing.
- **The sidebar's bottom slot is the switcher or an account panel, never both.**
  `usesDevAuth()` decides. `switchUser` refuses on the same condition, which is
  the boundary — the hidden button is a courtesy.
- **`/spaces` and `/spaces/[id]`.** Who is in a space, what each role can do,
  the invitation form for admins, the roster with Remove, and the invitation list
  with Revoke. People who have left are behind a disclosure rather than gone.
- **`/invite/[token]`.** Which space, which role, what that role can see, who you
  are signed in as — then Accept or Decline. Every refusal is a sentence.

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

**`src/lib/integrations/` and `src/lib/auth/`.** Every `*_PROVIDER` variable
genuinely selects an implementation; the default is the one that needs no
credential; an unknown value is a hard error rather than a silent fall back.

| Interface | Default (runs here) | Real |
|---|---|---|
| `AuthProvider` | `auth:dev` — a cookie naming a seeded profile | `auth:supabase` — **written, never run** |
| `CalendarProvider` | `calendar:fake` — pulls and pushes | `calendar:google` — **written, never run** |
| `IcsProvider` | `ics:fake` | `ics:http` — **written, never run** |
| `GeocodingProvider` | `geocoding:fake` | `geocoding:nominatim` — **written, never run** |
| `TravelTimeProvider` | `travel:fake` | `travel:openrouteservice` — **written, never run** |
| `PushProvider` | `push:fake` — in-memory outbox | `push:webpush` — **written, never run** |
| `AiProvider` | `ai:fake` — deterministic, offline | `ai:anthropic` — **written, never run** |

**"Written, never run" means exactly that.** No real provider here has ever sent
a request: there is no credential and no network. **Do not describe one as
working, and do not let a fake stand in for one in a "Works" claim.** The
Supabase provider is now the sharpest example, because it is the one somebody
will be tempted to call finished: sign-in, sign-up, the magic link, the token
refresh and the sign-out have never executed.

Also still fixture-backed or absent:
- **Locked items** are modelled and enforced end to end in the database, in the
  rules engine, in the AI gate and in the conflict resolver, but there is **no
  client-side crypto**. The UI refuses to show or edit them.
- **There is no scheduler.** A `schedule` rule runs when somebody presses "Run
  now, for real".
- **There is no service worker.** "Work offline" is a switch somebody flicks.
- **`AUTH_COOKIE_SECRET` still exists and still signs nothing.** `orbit_user` and
  `orbit_device` are unsigned, and both are dev-only affordances that name a
  profile or a device rather than a permission.

---

## Not started

Nothing from Phases 0–7. What has not been done, deliberately and by
instruction:

- **Nothing was deployed.** No hosting account, no Supabase project, nothing
  bought. `docs/deploy.md` is instructions, and says so at the top.
- **The Android client (Brief B)** has not been started. It depends on a real
  Supabase project existing, which is a by-hand step.

---

## Known bugs and rough edges

**31 entries, up from 28.** Session 8's 28 are unchanged except where noted;
three are new this session and all three are consequences of design decisions
recorded in the log rather than accidents.

### Introduced in session 9

1. **The `supabase` provider has never run, and the refresh path is the part
   most likely to be wrong.** `currentSupabaseUser()` refreshes a stale token and
   then *tries* to write the new cookies, inside a try/catch, because a Server
   Component may not write cookies in Next 15. If that catch fires on every
   render — which is exactly what would happen on a page that is not a server
   action — the app works but re-refreshes on every request. It is correct and it
   may be wasteful; nobody can tell from here.
2. **A raw invitation token lands in the browser's history.** It is passed on the
   URL to the page that shows it once. The same accepted rough edge as the AI
   result, and the alternative — a one-shot cookie — cannot be cleared during a
   render.
3. **`pnpm smoke` leaves invitation rows behind.** Every run creates two
   invitations in Work; one is revoked and one is accepted-then-the-member-is-
   removed. Nothing accumulates that breaks a later run — verified twice in a row
   — but the list on `/spaces/<work>` grows by two per run. `pnpm seed` clears it.

### Carried over, still true

4. **Naming a browser writes a device row per writable space, and there is no way
   to delete one.** `devices.revoked_at` exists and nothing sets it.
5. **Editing one occurrence's *details* is not built.** Skipping and restoring one
   is; the four questions that stopped the rest are in the decisions log.
6. **A trip's journeys are not re-checked against its dates.**
7. **A conflict is dismissible, and dismissing it loses the edit.** No undo, no
   record. **Still the one with the most teeth.**
8. **The queue survives a user switch** — and now also survives a *sign-out*
   under the supabase provider, for the same reason: `localStorage` records no
   profile. The sign-out screen says so in a sentence rather than pretending.
9. **`SYNCABLE_FIELDS` is narrower than the forms**, and only `/tasks/item/[id]`
   has an offline surface at all.
10. **`changesSince` runs five queries and caps at 40 per kind and 40 merged.**
11. **`applyWrite` interpolates column names with `tx.unsafe`** from a closed
    list that is re-checked in the server action.
12. **The push window is every dirty event, capped at 200, oldest first**, and
    nothing says so on the screen.
13. **A push does not delete.** `pushEvent` has no delete verb. **The other one
    with teeth.**
14. **The repeat builder still cannot type "the third Thursday", nor a `COUNT`.**
15. **The weekly review reads seven days from `now()`**, not the week Today is
    showing.
16. **Nothing runs a `schedule` rule on a schedule.**
17. **A rule's conditions and actions are never *reordered*.**
18. **The rules engine only knows about tasks**, capped at 500 open tasks.
19. **`rule_runs` is never pruned**, and neither is `space_invites` — a revoked
    or accepted invitation stays for ever, on purpose (it is the record) and with
    nothing to prune it.
20. **Derived journeys are re-derived on every render.**
21. **The calendar pull window is fixed at −180/+365 days**, and the compose bar
    cannot set an event's location, attendees or notes.
22. **`switchUser` is impersonation by design.** It is now unreachable whenever
    `AUTH_PROVIDER` is not `dev` — the sidebar renders an account panel and the
    action refuses — but **a build deployed with `AUTH_PROVIDER=dev` is still a
    build where anybody can become anybody.** `docs/deploy.md` says so twice.
23. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Also: a
    `redirect()` path built by concatenating strings loses its literal type — use
    one template literal, or `safeNextPath` plus a cast where the value is
    genuinely runtime-checked (`src/app/auth/actions.ts` does the latter, once,
    with a comment).
24. **The Markdown subset has no tables, no images, no task lists.**
25. **The people list's "next date" is computed twice**, in SQL and in TypeScript.
26. **A person's category is resolved back from its *name*** on the detail page.
27. **Contacts cannot be edited, only added and removed.**
28. **Search covers five kinds and no more**, capped at 30 per kind and 50 merged.
29. **Capture's space hint is one token**, a captured note gets an empty body, and
    the parser's matcher order is fixed.
30. **The AI result is carried on the URL**, on three pages.
31. **Environment and tooling**, all accepted by instruction or by nature:
    Postgres does not survive container restarts (`./scripts/db-reset.sh`
    restarts it); `pkill -f next-server` can kill your own command with exit 144
    — use `pgrep -f 'next-serv[e]r' | while read pid; do kill "$pid"; done`, note
    the bracket; there is no linting, out of scope by instruction; `pnpm smoke`
    needs a running server plus Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with
    `CHROMIUM_PATH`) **and port 3101 free**, because it starts a second server
    there for the supabase-provider section.

**About what `pnpm smoke` leaves behind.** Everything it *creates* it deletes,
revokes or removes, and it passes twice in a row — but it leaves `ai_runs` rows,
a `calendar_sync_state` push row, the fixture calendars it connects, a `devices`
row in Priya's Work space, two `space_invites` rows per run in Work, and a
`space_members` row for Sam in Work with `status = 'left'`. All harmless, all
cleared by `pnpm seed`. **Two things to know before you touch the AI or repeat
sections:** a crashed run can leave an AI consent switched on, and the next run
then fails a different assertion for a confusing reason; and a crashed run can
leave a `Smoke repeat …` event in August. `delete from events where title like
'Smoke%'` — as `orbit_seed` — or `pnpm seed`.

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
pnpm test                      # 692 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 382 checks; also starts a second server on :3101
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
| `DATABASE_PREPARE` | on | Set to `false` **only** on Supabase's transaction pooler (6543). See `docs/deploy.md`. |
| `SEED_DATABASE_URL` | `postgres://orbit_seed:…@localhost:5432/orbit` | BYPASSRLS. Seeding only — never at request time. |
| `AUTH_PROVIDER` | `dev` | `dev` \| `supabase`. Supabase: **written, never run**. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | absent | Only read when `AUTH_PROVIDER=supabase`, and read when the provider is *called*. The anon key is public by design; there is nowhere to put a service-role key. |
| `APP_URL` | `http://localhost:3000` | Where Supabase sends people back to after a magic link. |
| `CALENDAR_PROVIDER` | `fake` | `fake` \| `google`. Never run. |
| `ICS_PROVIDER` | `fake` | `fake` \| `http`. |
| `GEOCODING_PROVIDER` | `fake` | `fake` \| `nominatim`. Never run. |
| `TRAVEL_TIME_PROVIDER` | `fake` | `fake` \| `openrouteservice`. Never run. |
| `PUSH_PROVIDER` | `fake` | `fake` \| `webpush`. Never run. |
| `AI_PROVIDER` | `fake` | `fake` \| `anthropic`. Never run. |
| `ORBIT_DB_NAME` | `orbit` | Read by both scripts. |
| `ORBIT_URL` | `http://localhost:3000` | `pnpm smoke` only. |
| `ORBIT_ALT_PORT` | `3101` | `pnpm smoke` only — the second server. |
| `CHROMIUM_PATH` | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | `pnpm smoke` only. |

Two cookies under `dev`, both unsigned, both dev-only affordances: `orbit_user`
names the seeded profile you are acting as, and `orbit_device` names which device
this browser is. Under `supabase` there are two more, `orbit_sb_access` and
`orbit_sb_refresh`, both httpOnly and both `secure` in production. Neither
provider's cookies are a permission — every write goes through `asUser` and the
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

**A five-minute demo of what session 9 added.**

Open **Spaces → People and invites** on **Work**. Choose *Free/busy only*, leave
the address empty, press **Make a link**. The link appears once, with a sentence
saying it will never appear again — reload the page and it is gone, because only
its fingerprint was stored.

Copy the link. Switch to **Sam Okafor** in the sidebar and paste it. He is shown
the space, the role, and what free/busy actually means before he agrees to
anything. Press **Decline**: nothing changes, and it says the link is still live.
Open it again and **Accept** — Work appears in his sidebar, marked free/busy, and
his calendar shows not one of Priya's events. Open the link a third time: he is
told he accepted it already.

Now make a second invitation, addressed to `danny@orbit.test`, and open *that*
one as Sam. It names the address it was sent to and offers no Accept button. Try
`/invite/aaaa…` — a token nobody issued — and it says the link is not recognised
without admitting whether any space exists. Neither is a 403 and neither is a 500.

Switch back to Priya, **Remove** Sam from Work and **Revoke** the remaining
invitation. The revoked row stays, marked expired: it is the record of what was
offered. Sam's membership row stays too, as `left`.

Finally, `AUTH_PROVIDER=supabase pnpm start` on another port and open it. Every
page sends you to a sign-in screen; there is no sidebar and no switcher; and
pressing **Sign in** tells you, in a sentence, that `SUPABASE_URL` is not set.
That is as far as anybody can get from here, and it is the honest edge of this
session's work.

---

## Next three things, in order

1. **Somebody has to do the by-hand steps** — create the Supabase project, run
   the migrations, create `orbit_app`, deploy, and sign up once. `docs/deploy.md`
   is the list, and §6 of `docs/deployment-and-android.md` says the same. **Until
   that happens the supabase provider stays "written, never run" and no session
   can change that.** The first thing to check on the far side is gotcha 1:
   `select u.id = p.id from auth.users u join public.profiles p on p.id = u.id`.
   If that is not `t`, nothing works and nothing says why.
2. **Brief B, the Android client** — `docs/deployment-and-android.md` §5. It
   depends on a real project existing, so it comes after step 1 and not before.
3. **An offline surface on notes, and `SYNCABLE_FIELDS` widened to match the
   forms** (edge 9). Named first in the last two sessions and still the narrowest
   useful step inside the product itself: a note body is the field somebody is
   most likely to be typing when the connection goes. Widening the list is cheap;
   widening it without a smoke check per new field is not.

After those, a dismissed conflict leaving a record (edge 7) is the one with the
most teeth, and it probably needs a migration — read the migration rules before
you start.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, keep `docs/phase-plan.md` accurate,
append to `docs/decisions-log.md`, and push. The container is ephemeral. Push at
least hourly.
