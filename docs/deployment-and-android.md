# Real accounts, deployment, and a narrow Android client

Written session 9. **Supersedes the first version of this file**, which
recommended a Capacitor WebView shell around the dev-auth build. That plan is
withdrawn: with real accounts the phone can talk to Supabase directly, and the
shell stops being worth building.

Nothing in this file has been run. It is a plan and two briefs, not a "Works"
claim.

---

## 1. The two decisions

**Sharing is by space, not by linking accounts.** `public.spaces` is already
"the unit of sharing" and `spaces.id` is the `space_id` on every space-scoped
table. `space_members` maps user→space with a role from
`('owner','admin','member','viewer','free_busy')`, and all 41 tables' policies
key off `app.is_space_member`, `app.can_see_space_content` (which excludes
`free_busy`) and `app.is_space_admin`. Account-to-account linking would mean
rewriting every one of those policies. Invites into a space mean writing a
redeem flow and nothing else.

`public.space_invites` already exists — `token_hash`, `role`, `expires_at`,
`accepted_at`, `accepted_by`, RLS for admins in both directions. It has no rows
because of a deliberate session-5 decision:

> *space_invites needs an auth system that can invite a stranger; auth here is a
> cookie naming a seeded profile, so an invite would be a row nothing could
> redeem.*

Brief A supplies the missing half. **That decision is being closed, not
overturned** — record it that way in `docs/decisions-log.md`.

**The Android client is deliberately narrow.** About 3,800 lines of behaviour
live in TypeScript, not in the database: `rules.ts` (890), `recurrence.ts`
(567), `travel.ts` (480), `sync/conflict.ts` (458), `calendar.ts` (294),
`search.ts` (232). 637 Vitest tests cover it. A second implementation in Kotlin
would drift, silently, about dates — session 8 already found a real `UNTIL`/BST
bug in `recurrence.ts` by writing a test the Kotlin side wouldn't have.

So the phone app does **Today, capture, tasks, calendar read, notes** and
nothing else. The rules builder, travel derivation and the sync console stay on
the web. This is why the phone app gets its own spine and its own design: it
has a different job, not a smaller screen.

---

## 2. What real auth actually changes (less than you'd think)

The minimal change keeps everything:

- The Next server verifies the Supabase session, takes `sub`, and hands it to
  the **existing** `asUser(userId, fn)` in `src/lib/db/index.ts`. That function
  already does `set local role authenticated` and sets `request.jwt.claims`.
  Every query, every policy and all 83 pgTAP assertions keep working unchanged.
- The Android client talks to PostgREST directly with its own JWT. Supabase
  sets the same GUCs from that token, so **both clients converge on the same
  RLS** with no shared code and no API layer in between.
- `AuthProvider` in `src/lib/auth/index.ts:22` was written for this. Nothing
  that calls `getCurrentUser()` changes.

Do **not** rewrite `src/lib/queries/*` to use supabase-js. That's 8,363 lines
of working, tested SQL solving a problem it doesn't have.

Three real gotchas, all to verify rather than assume:

1. **`profiles.id` has no FK to `auth.users`** and defaults to
   `gen_random_uuid()`. `auth.uid()` must return the same id or every policy
   returns zero rows, silently. Needs a trigger on `auth.users` insert. This is
   the one genuinely delicate step in Brief A.
2. **`0000_bootstrap.sql` does `create or replace function auth.uid()`**,
   unguarded. On Supabase that function is owned by `supabase_auth_admin` and
   the replace will likely fail on permissions. The shim reads the same GUCs as
   Supabase's own, so the fix is to skip it there — not to force it.
3. **The pool connects as `orbit_app`**, which must exist on Supabase, be able
   to log in, own nothing and hold no BYPASSRLS. Create it and grant it
   `authenticated`; confirm it is not a table owner, because `db-test.sh`'s
   whole premise is that policies apply to it in full.

---

## 3. Deployment, now that it can be safe

With real accounts, `switchUser` impersonation goes and the public-host route
becomes legitimate.

- **Database:** Supabase. Run `supabase/migrations/*.sql` in order; `0000` is
  mostly guarded to no-op where the roles and `auth` schema already exist. Needs
  `pgcrypto`, `postgis`, `vector`, plus `pgtap` if you want `db-test.sh` there.
- **Server:** a long-lived container — Fly.io, Railway, Render — running
  `next start` with `output: 'standalone'`. Not Vercel serverless: every page is
  `force-dynamic` and `src/lib/db/index.ts` holds a pool, which suits a
  persistent process and not a per-invocation function.
- **Connection string:** session mode (5432) is simplest. On the transaction
  pooler (6543) set `prepare: false` on the `postgres` client, or `asUser`'s
  prepared statements will break.

---

## 4. Brief A — real accounts and invites

Paste into a fresh session. Written to run without check-ins.

> ## Brief A: real accounts, space invites, deployable
>
> Work on `bullah12/Orbit`, branch `claude/orbit-real-auth`, created from
> `main`. Read `docs/STATUS.md`, then `docs/decisions-log.md`, then §1–3 of
> `docs/deployment-and-android.md` — those state the constraints and the three
> gotchas, and you should not re-derive them.
>
> **Work autonomously. Do not stop to ask me anything.** Where something is
> ambiguous, choose the option that keeps the five commands in STATUS green,
> write the choice and its reason into `docs/decisions-log.md`, and continue.
>
> ### Phase 1 — Supabase Auth behind the existing interface
> - Implement a second `AuthProvider` named `supabase`, selected by
>   `AUTH_PROVIDER=supabase`. **`dev` stays and stays the default**, because the
>   repo's standing rule is that Orbit runs end to end with zero credentials and
>   637 tests plus 337 smoke checks depend on it.
> - The provider verifies the Supabase session server-side and returns a
>   `SessionUser` whose `id` is the JWT `sub`. Pass that id to the existing
>   `asUser` — **do not change `asUser`, do not add a service-role client, and
>   do not rewrite anything in `src/lib/queries/`.**
> - Email/password and a magic link. No OAuth providers: each one is a console
>   configuration I'd have to do by hand, and you cannot verify it.
> - Sign-in, sign-up and sign-out pages, styled with existing tokens from
>   `src/app/globals.css`. Do not invent a colour — `tests/contrast.test.ts`
>   exists for a reason.
> - **`switchUser` and the sidebar's user switcher are hidden whenever
>   `AUTH_PROVIDER` is not `dev`.** Not removed — `dev` still needs them — but
>   unreachable. Assert this in smoke.
>
> ### Phase 2 — the profiles/auth.users join
> - One migration. It is expected and it is the only one this brief authorises:
>   a trigger on `auth.users` insert that creates the matching
>   `public.profiles` row with the same `id`, taking `email` and a display name.
>   Handle the `profiles_email_key` collision case explicitly.
> - Also handle the reverse direction for the seeded profiles: document how a
>   seeded id is claimed by a real account, or state plainly that seeded data is
>   dev-only and a real deployment starts empty. **Either answer is fine; an
>   unstated one is not.**
> - Add pgTAP assertions for the trigger. `select plan(...)` goes up; say by how
>   much in STATUS.
>
> ### Phase 3 — invites, which is filling in a table that already exists
> - **No migration.** `space_invites` has every column this needs. If you become
>   convinced otherwise, stop and write the argument in the decisions log
>   instead.
> - An admin of a space creates an invite: a role from `app.member_role`, an
>   expiry, an optional `invited_email`. The raw token is shown **once** on
>   screen as a link and never stored — only `token_hash`.
> - Redeeming: a signed-in user opens the link, sees which space and which role,
>   and accepts or declines. Accepting sets `accepted_at`/`accepted_by` and
>   inserts `space_members`. Expired, already-accepted and wrong-space tokens
>   each fail with a sentence, never a 500.
> - Redeem needs to write `space_members` for a user who is not yet a member, so
>   the current policies cannot express it. Use a `security definer` function in
>   the `app` schema that takes the raw token, hashes it, and does the check and
>   the insert in one transaction. **Do not loosen a policy to make this work**,
>   and do not add a service-role client.
> - An admin can revoke an unredeemed invite and remove a member.
>   `space_members.status` already has `'left'` — use it rather than deleting.
> - The `free_busy` role must be offerable, since it already works end to end.
>
> ### Phase 4 — deployable, written down and only written down
> - `output: 'standalone'` in `next.config.ts` and a Dockerfile that builds it.
> - `docs/deploy.md`: Supabase + Fly/Railway, as commands somebody can follow.
>   Include the migration order, the three gotchas from §2 of
>   `docs/deployment-and-android.md`, and the `prepare: false` pooler note.
> - **Deploy nothing. Create no hosting account. Buy nothing.**
>
> ### Rules that override anything above
> - **Do not touch RLS policies, `app.is_space_member`, `app.can_see_space_content`,
>   `app.is_space_admin`, or `asUser`.** The one new `security definer` function
>   in Phase 3 is the single authorised exception and it must be `revoke execute
>   … from public` like the ones in `0008_identity_lookup.sql`.
> - **`AUTH_PROVIDER=dev` remains the default and remains fully working.** If a
>   change would break the zero-credential run, it is the wrong change.
> - **The five commands stay green**: `./scripts/db-test.sh`, `pnpm build`,
>   `pnpm typecheck`, `pnpm test`, `pnpm smoke`. Run all five before any commit
>   that changes behaviour.
> - **Every new behaviour gets a test in the same commit** — Vitest for logic,
>   pgTAP for anything a policy decides, a `scripts/smoke.mjs` section for
>   anything with a screen. Sam Okafor the outsider gets an invite-flow case:
>   he must not be able to redeem an invite to a space he was not invited to,
>   and must get a sentence rather than a 403.
> - **You cannot test against a real Supabase project** — there is no project
>   and no credential. Say so plainly in STATUS. The `supabase` provider is
>   **written, never run**, exactly like the Google calendar provider, and must
>   be listed that way in the integration table. Do not let `dev` passing stand
>   in for it.
>
> ### Finishing
> Push hourly; the container is ephemeral. Stop at about three-quarters of your
> context, get the tree running, rewrite `docs/STATUS.md` completely, append to
> `docs/decisions-log.md` — including the note that the session-5 `space_invites`
> decision is now **closed rather than overturned** — keep `docs/phase-plan.md`
> accurate, and push. Open a PR titled "Real accounts and space invites",
> listing what a human must do by hand. Do not merge it.

---

## 5. Brief B — the Android client

**Run this only after Brief A is merged and a Supabase project exists.** It
depends on real JWTs; there is nothing to point it at otherwise.

> ## Brief B: Orbit for Android
>
> Work on `bullah12/Orbit`, branch `claude/orbit-android`, created from `main`
> after the real-auth work has landed. Read `docs/STATUS.md` and §1 and §5 of
> `docs/deployment-and-android.md` first.
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
> - Auth: email/password and magic link, matching Brief A. Session persisted
>   with `EncryptedSharedPreferences`.
> - A space switcher, since every row is space-scoped and a user is in several.
> - Its own design. It should not imitate the web layout — that sidebar is a
>   desktop shape. Bottom navigation, one screen per section. Reuse the
>   *colours* from `src/app/globals.css` so the two feel related; reuse nothing
>   else.
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
> - The five web commands must still be green when you finish, because you have
>   not touched the web app — verify rather than assume.
>
> ### Finishing
> Push hourly. Stop at three-quarters of context, rewrite `docs/STATUS.md`
> including a new section for the Android client and its honest status, append
> to `docs/decisions-log.md`, and push. Open a PR titled "Orbit for Android:
> today, capture, tasks, calendar, notes". List the by-hand steps: set the
> repository variables, download the artifact, enable unknown sources, sideload.
> Do not merge it.

---

## 6. What you do by hand

1. Create the Supabase project; run the migrations in order; create `orbit_app`
   and confirm it owns nothing.
2. Deploy the web app; set `AUTH_PROVIDER=supabase` and the connection string.
3. Sign up, create a space, invite your first person, watch them accept.
4. Set the Android repository variables; run the workflow; download the APK;
   sideload it.

Steps 1 and 2 are the ones no session can do for you, and step 3 is the only
real proof that any of it works.
