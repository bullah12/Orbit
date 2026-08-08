# Orbit — what is done, what remains, and the prompts to finish it

Written session 11, 2026-08-08, on branch `claude/project-completion-status-kkqpxo`.
This session **built nothing**. It read the handoff documents and then re-ran
the repository's own five commands from a cold container to check whether the
claims in `docs/STATUS.md` are still true. They are.

This file does not replace `docs/STATUS.md`, which remains the handoff contract.
It answers one question — *how much of Orbit is finished and what is left* — and
carries the two prompts that finish it.

---

## 1. Verified in this session, not taken on trust

From a cold container: `pnpm install`, `pg_ctlcluster 16 main start`,
`./scripts/db-reset.sh`.

| Command | Result | STATUS claimed |
|---|---|---|
| `./scripts/db-test.sh` | **106/106 pgTAP assertions** | 106 ✓ |
| `pnpm build` | **clean**, 27 routes, standalone output | clean ✓ |
| `pnpm typecheck` | **clean** | clean ✓ |
| `pnpm test` | **735 tests, 17 files, all green** | 735 ✓ |
| `pnpm smoke` | **401 of 402** — one check failed | 402 ✗ |

Four of five clean. `docs/STATUS.md` is accurate on the four that matter most —
its numbers were not aspirational — and one smoke check is red.

**About that one check.** The run was captured tail-only, so the failing
check's name was lost and it has not been re-run; it is a single check out of
402 and the suite was otherwise identical to STATUS's count. It is recorded here
as unidentified rather than guessed at. The first thing a next session should do
is `pnpm seed && pnpm smoke` with the whole output kept, because the two
documented candidates are cheap to rule out: **edge 3** (a run leaves two
invitation rows behind and a second run without reseeding fails the revoke
checks) and the date-sensitive fixture check that STATUS records as having
passed Monday to Friday and failed at the weekend — session 10 fixed that one,
and this session also ran on a Saturday.

Scale, for context: 27,095 lines of TypeScript/TSX in `src/`, 10,730 lines of
tests and migrations, 13 migrations, 79 commits on `main`.

---

## 2. How much is complete

**The product is complete. The deployment is not.**

Every phase in `docs/phase-plan.md` is ticked except two boxes at the very end:

| | |
|---|---|
| Phase 0 — tasks, notes, spaces, RLS | **done** |
| Phase 1 — people | **done** |
| Phase 2 — calendar, recurrence, ICS | **done** |
| Phase 3 — places and travel | **done** |
| Phase 4 — rules engine | **done** |
| Phase 5 — search, capture, AI | **done** |
| Phase 6 — sync and offline | **done** |
| Phase 7 — real accounts and space invites | **done, never run against a real project** |
| Session 10 — phone, Now page, nav, shortcuts | **done** |
| Session 10 — settings and a light/dark override | **not started**, blocked on a decision |
| Session 10 — a service worker | **not started** |

A fair headline number: **feature work is ~90% done; the project as a
*deployed, in-use thing* is ~60%**, because nothing has ever been deployed and
the single most important code path — real authentication — has never executed.

### The one sentence that governs everything below

**`AUTH_PROVIDER=supabase` has never run.** It is a complete implementation of
GoTrue's REST API and not one line of it has ever sent a request. The same is
true of `calendar:google`, `ics:http`, `geocoding:nominatim`,
`travel:openrouteservice`, `push:webpush` and `ai:anthropic`. Every one of them
is *written, never run*. No session in this container can change that, because
there is no project, no credential and no network for them.

---

## 3. What remains, in three buckets

### Bucket A — only a human can do it (blocks everything else)

1. **Create the Supabase project**, run `supabase/migrations/*.sql` in order,
   create the `orbit_app` login role with no ownership and no BYPASSRLS, and
   check the `on_auth_user_created` trigger exists. `docs/deploy.md` §1 is the
   command list, including the three gotchas — of which *"`profiles.id` must
   equal `auth.uid()`"* is the one that fails **silently**: every policy returns
   zero rows and the app looks empty rather than broken.
2. **Deploy the container** to Fly.io or Railway (not Vercel serverless — every
   page is `force-dynamic` and `src/lib/db/index.ts` holds a pool). `docs/deploy.md` §2.
3. **Sign up once**, and confirm `u.id = p.id`.

Until those three happen, "signing in works" stays proven by nothing.

### Bucket B — an agent can finish these, unattended

Ordered as `docs/STATUS.md` orders them, with its edge numbers.

| | Item | Cost | Migration? |
|---|---|---|---|
| B1 | **Light/dark override + a settings page** (edge 4, review item 7) — blocked on choosing `light-dark()` vs duplicate-and-pin, *not* on effort | medium | no |
| B2 | **A service worker** (edge 33) — the app is installable and shows a network error offline, while `src/lib/sync/` underneath it is real | medium | no |
| B3 | **A dismissed conflict leaves a record** (edge 7) — "the one with the most teeth"; dismissing currently loses the edit | medium | **yes** |
| B4 | **Device revoke** (edge 4) — `devices.revoked_at` exists and nothing sets it; lives on the settings page from B1 | small | no |
| B5 | **A push that deletes** (edge 13) and **a scheduler** so `schedule` rules run (edge 16) | medium | maybe |
| B6 | **An assignee picker on the task row** (edge 32) — deliberately *not* on the compose bar | small | no |
| B0 | **Identify and fix the one red smoke check** (§1) — reseed first, keep the whole output | small | no |
| B7 | **The remaining 27 edges** in STATUS — the invite token in browser history (2), smoke leaving invite rows (3), per-occurrence detail edits (5), `SYNCABLE_FIELDS` narrower than the forms (9), contacts that cannot be edited (27), and the rest | varies | some |
| B8 | **Shared lists (shopping)** — the one household verb genuinely missing, per the comparison table in `docs/design-review.md` | large | **yes** |

### Bucket C — deliberately not being done

- **The Android client (Brief B).** Session 10 weakened its case to near zero:
  the web app is responsive and installable, which was most of what it was for.
- **Client-side crypto for locked items.** Locked items are modelled end to end
  — constrained to empty title and body, refused by the rules engine and the AI
  evaluator, absent from search by construction — but nothing encrypts anything.
- **OAuth sign-in providers.** Each is console configuration nobody here can verify.
- **Linting.** Out of scope by standing instruction.

---

## 4. Prompt A — finish Bucket B autonomously

Paste into a fresh session. Written to run without check-ins.

> ## Brief C: the settings surface, the offline shell, and the edges
>
> Work on `bullah12/Orbit`, branch `claude/orbit-settings-and-offline`, created
> from `main`. Read `docs/STATUS.md` first, then `docs/design-review.md`
> ("Item 7, and why it is not a small job"), then `docs/decisions-log.md`. Those
> state the constraints and the reasoning; do not re-derive them.
>
> **Work autonomously. Do not stop to ask me anything.** Where something is
> ambiguous, choose the option that keeps the five commands in STATUS green,
> write the choice and its reason into `docs/decisions-log.md`, and continue.
>
> ### Phase 0 — get the fifth command green before building anything
>
> Session 11 ran the five commands from a cold container: pgTAP 106/106, build,
> typecheck and 735 Vitest tests were clean, and **one of 402 smoke checks
> failed**. That run was captured tail-only so the check's name was lost.
> `pnpm seed` first (edge 3), then `pnpm smoke` keeping the entire output, and
> fix whatever it names — or record why it is environmental. **Do not start
> Phase 1 with a red suite**: everything below is judged by the five commands,
> and a suite that was already red cannot tell you what you broke.
>
> ### Phase 1 — decide the theme question, then build settings
>
> - **Make the `globals.css` decision on purpose and record it before writing
>   any CSS.** The two options and their costs are set out in
>   `docs/design-review.md`: `light-dark()` (one declaration per token, the
>   contrast test gets *simpler*, but the dark-value comments are lost) or
>   duplicate-and-pin (the file reads as it does today, plus ~60 lines that only
>   a new test keeps honest). **`light-dark()` is the recommendation** — carry
>   the lost comments across as a comment block above the merged token list
>   rather than dropping them.
> - `tests/contrast.test.ts` finds the dark palette by brace-matching
>   `@media (prefers-color-scheme: dark)` and treats every `oklch()` outside it
>   as a light value. **Whichever option you pick, that test must still compute
>   real WCAG ratios for both themes afterwards** — it is the reason the token
>   system is trustworthy, and a version of it that silently checks one theme
>   twice is worse than no test.
> - Build `/settings`, from existing tokens. No new colour.
>   - **Theme: system / light / dark**, persisted, and **with no flash on
>     load** — the choice must be applied before first paint, not by a
>     `useEffect`. A cookie read on the server is the shape that fits this app;
>     every page is already `force-dynamic`.
>   - **Devices** (edge 4): list this account's device rows per space and let one
>     be revoked, setting `devices.revoked_at` — the column has existed since
>     migration 0001 and nothing has ever written it. A revoked device must stop
>     advancing its sync cursor; assert that, do not assume it.
>   - **Default compose space**, and **week start**, if they fit without a
>     migration. If either needs one, skip it and say so in STATUS.
> - Put `/settings` under **More** in the navigation, beside Rules, Sync and AI.
>   It is administrative and it does not belong beside Today.
>
> ### Phase 2 — the service worker (edge 33)
>
> - `src/app/manifest.ts` makes Orbit installable, and an installed app that
>   shows a network error when the connection drops is a worse impression than a
>   bookmark. `src/lib/sync/` is real and already holds the queue.
> - **Shell only, and be honest about it on screen.** Cache the app shell and
>   the static assets; serve an offline page that says what Orbit can and cannot
>   do while offline and links to `/sync`. **Do not** cache authenticated page
>   HTML — every page is `force-dynamic`, RLS-scoped and per-user, and a cached
>   `/tasks/home` served to the next person who opens the phone is a data leak,
>   not a nicety. Write that reasoning into the decisions log.
> - The registration must be a no-op when `serviceWorker` is absent, and there
>   must be a way to unregister — a stale service worker is the classic way to
>   ship an app that cannot be updated.
> - Smoke checks: installable, registers, and the offline page renders. Drive it
>   through the running app with the network disabled in the browser context,
>   not by asserting a file exists.
>
> ### Phase 3 — the two edges with teeth
>
> - **Edge 7, a dismissed conflict loses the edit.** This is the one with the
>   most teeth and it probably needs a migration; **read the migration rules
>   before you start** and write the argument in the decisions log first. The
>   minimum honest behaviour: dismissing keeps a record of what was discarded and
>   the record is reachable from `/sync`. Undo is better; a record is the floor.
> - **Edge 4's other half and edge 32**: an assignee picker on the task row.
>   **Not on the compose bar** — that decision is recorded twice and stands.
>
> ### Rules that override anything above
>
> - **Do not touch RLS policies, `app.is_space_member`,
>   `app.can_see_space_content`, `app.is_space_admin`, or `asUser`.** Any new
>   `security definer` function must `revoke execute … from public` like the ones
>   in `0008_identity_lookup.sql`.
> - **`AUTH_PROVIDER=dev` remains the default and remains fully working.** If a
>   change would break the zero-credential run, it is the wrong change.
> - **Do not describe a "written, never run" provider as working**, and do not
>   let a fake stand in for one in a claim.
> - **No streaks, badges, gamification or guilt. No view tracking.** Category
>   colour stays the only strong colour and never appears without an icon and a
>   label. Calm, dense, neutral, full dark mode, UK conventions.
> - **The five commands stay green**: `./scripts/db-test.sh`, `pnpm build`,
>   `pnpm typecheck`, `pnpm test`, `pnpm smoke`. Run all five before any commit
>   that changes behaviour. Note `pnpm typecheck` needs a `pnpm build` first on a
>   fresh clone, and `pnpm smoke` needs a running server plus a reseed (edge 3:
>   two runs without `pnpm seed` fail the revoke checks).
> - **Every new behaviour gets a test in the same commit** — Vitest for logic,
>   pgTAP for anything a policy decides, a `scripts/smoke.mjs` section for
>   anything with a screen. Put the logic in a pure module in `src/lib/` so it
>   can be tested without a DOM, as `shortcuts.ts` and `conflict.ts` are.
>
> ### Finishing
>
> Push hourly; the container is ephemeral. Stop at about three-quarters of your
> context, get the tree to a state that runs, **rewrite `docs/STATUS.md`
> completely**, append to `docs/decisions-log.md`, keep `docs/phase-plan.md`
> accurate, and push. Open a PR listing what a human must still do by hand. Do
> not merge it.

---

## 5. Prompt B — the acceptance pass, once Bucket A is done

Use this **after** somebody has done the by-hand steps in §3 Bucket A. It is not
a building prompt; it is the one that turns "written, never run" into either
"works" or a list of what broke. Fill in the two placeholders.

> ## Brief D: first run against a real project, and the acceptance pass
>
> Work on `bullah12/Orbit`, branch `claude/orbit-first-real-run`, created from
> `main`. Read `docs/STATUS.md`, then `docs/deploy.md` in full.
>
> There is now a real Supabase project and a real deployment:
>
> - Supabase project ref: `<REF>`
> - Deployed URL: `<URL>`
> - Credentials are in the environment; do not print them, do not commit them,
>   and do not write them into any document.
>
> **This is the first time `AUTH_PROVIDER=supabase` has ever executed.** STATUS
> has said for three sessions that this is where surprises will be, and names
> the refresh path as the part most likely to be wrong. Treat every claim about
> it as unproven until you have watched it.
>
> ### 1. Prove the ground is right before blaming the app
>
> In this order, because the first failure makes the others meaningless:
>
> 1. `on_auth_user_created` exists on `auth.users`.
> 2. After one sign-up, `u.id = p.id` for that account. **If this is not `t`,
>    stop.** Every policy returns zero rows and says nothing about why — the app
>    will look empty rather than broken, and you will waste the session in the
>    wrong layer.
> 3. `orbit_app` can log in, owns nothing, and holds no BYPASSRLS. The entire
>    security model is that policies apply to it in full.
> 4. `./scripts/db-test.sh` against the real project if `pgtap` is installed
>    there. 106/106 or an explanation per failure.
>
> ### 2. Drive real authentication end to end, and write down what actually happened
>
> Sign up, sign in, sign out, magic link, **and let a session expire so the
> refresh path runs** — that last one is the specific line STATUS flags. Then:
> a second account, an invitation to a space with each offerable role including
> `free_busy`, accept, decline, expire, revoke, and remove a member. Every
> refusal must still be a sentence, not a 403 and not a 500.
>
> **Confirm the dev switcher is unreachable.** A build deployed with
> `AUTH_PROVIDER=dev` is a build where anybody can become anybody (edge 22);
> verify the deployed build is not that build.
>
> ### 3. Then the rest of the app, as a person would use it
>
> On a phone-sized viewport and a desktop one: Today at each range, capture a
> task by typing a sentence with `@person` and `#space`, the calendar at each
> view, a recurring event with an occurrence skipped and put back, search, an
> offline edit that lands, and a conflict that is named rather than resolved.
>
> ### 4. What to produce
>
> - **Update the integration table in `docs/STATUS.md`**: `auth:supabase` moves
>   out of "written, never run" **only for the paths you personally watched
>   execute**. Split the row if only some of it ran. The other six providers stay
>   where they are unless you ran them too.
> - **A numbered list of everything that broke**, each with the exact reproduction
>   and the layer it is in (database, provider, app, deployment).
> - **Fix what is small and safe and provable from here**, in the same commit as
>   its test. Leave anything that needs a migration or a schema decision as a
>   written argument in `docs/decisions-log.md`.
> - **Do not run `pnpm seed` against the real project.** Seeded data is
>   development data; the trigger in 0012 will refuse an account whose email
>   collides with a seeded profile, which is correct and an unwelcome surprise.
> - Keep the five local commands green. Rewrite `docs/STATUS.md` completely,
>   append to `docs/decisions-log.md`, push, open a PR, do not merge.
>
> **The one thing that would make this session a failure** is coming back with
> "authentication works" without having watched the refresh path run. Say what
> you watched, and say what you did not.

---

## 6. If you only do one thing

Do Bucket A. Everything in Bucket B improves an app nobody can reach yet, and
the riskiest code in the repository — the one path that fails silently and
looks like an empty app rather than an error — cannot be tested until somebody
creates a project and signs up once.
