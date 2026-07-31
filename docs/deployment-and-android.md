# Deploying Orbit, and putting it on an Android phone

Written session 9. Nothing in this file has been *run* — it is a plan and a
brief, not a "Works" claim. Treat it the way `docs/STATUS.md` treats the
integration table: written, never run.

---

## 1. What the code decides for you

Four facts from the tree constrain every deployment choice. They are not
opinions.

1. **Every page is `force-dynamic` and server-rendered**, and all writes go
   through one Server Action file (`src/app/actions.ts`). There is no static
   export and there never can be one. The UI cannot be shipped inside an APK —
   whatever runs on the phone has to talk to a running Node server.
2. **The database is not a commodity Postgres.** `0000_bootstrap.sql` needs
   `pgcrypto`, `postgis` and `vector`, creates the `anon` / `authenticated` /
   `service_role` roles, and installs an `auth.uid()` shim reading
   `request.jwt.claims`. `./scripts/db-test.sh` additionally needs `pgtap`.
   The whole schema is deliberately Supabase-shaped.
3. **`asUser()` opens a transaction and runs `set local role authenticated`.**
   That works through a transaction-mode pooler, but the `postgres` driver's
   prepared statements do not — a pooler needs `prepare: false` on the client.
4. **Auth is impersonation.** `AUTH_PROVIDER=dev` is the only implementation,
   the `orbit_user` cookie is unsigned, and `switchUser` lets any visitor become
   any seeded profile with one click. STATUS says it in capitals and it is
   right: **this build must not be exposed to a network you do not control.**

Point 4 is the whole deployment problem. Points 1–3 are just plumbing.

---

## 2. Two honest deployment shapes

### A. Private network (recommended for a phone in your pocket)

Run Orbit on a box you own — a home server, a NAS, a €5 VPS — and join both
the box and the phone to a **Tailscale** tailnet (or WireGuard). The app is
then reachable at `http://orbit:3000` from your phone and from nowhere else.

- **The impersonation hole stops mattering**, because the only devices on the
  network are yours. No auth work required.
- Costs nothing beyond the box. Postgres runs locally exactly as
  `./scripts/db-reset.sh` sets it up, so nothing about the database changes.
- Downside: an HTTP origin. A **service worker and PWA install both require a
  secure context** — `localhost` counts, a bare LAN IP does not. Use Tailscale
  Serve / MagicDNS to get a real `*.ts.net` HTTPS hostname, which is free and
  is the reason this option stays viable for the Android work below.

### B. Public host + a real gate

`Fly.io`, `Railway` or `Render` running the Node server, with **Supabase** as
the database. This is the shape the schema was designed for.

- Add `output: 'standalone'` to `next.config.ts` and a Dockerfile; `next start`
  in a long-lived container suits a connection pool far better than Vercel's
  serverless functions, which would open a pool per invocation.
- On Supabase: run `supabase/migrations/*.sql` in order. `0000` is guarded to
  be a no-op where the roles and `auth` schema already exist, which is exactly
  the Supabase case. Create the `orbit_app` and `orbit_seed` roles yourself.
- Connection string: the **session-mode** port (5432) is simplest. If you use
  the transaction pooler (6543), set `prepare: false` in `src/lib/db/index.ts`.
- **You must close the impersonation hole before this is safe.** Three ways,
  cheapest first:
  1. A reverse-proxy gate in front of everything — Cloudflare Access, or basic
     auth in Caddy/nginx. Zero code, and it is a real perimeter.
  2. A Next middleware requiring a passphrase cookie before any route renders,
     plus removing `switchUser` from the sidebar when it is on.
  3. A real `AuthProvider` implementation. The interface in
     `src/lib/auth/index.ts` was built for this and nothing calling
     `getCurrentUser()` would change. It is also the most work by an order of
     magnitude.

**Do not skip the gate and reason that the URL is unguessable.** Every seeded
profile including the power user is one click away behind that URL.

---

## 3. Android: yes, three ways

You cannot ship the pages inside the APK (fact 1). Everything below is a
native shell around a server you run.

| Route | What you get | Cost |
|---|---|---|
| **PWA only** | Chrome's "Add to home screen". Own icon, own window, no address bar, offline shell. No APK, no store. | Smallest. Needs HTTPS. |
| **TWA via Bubblewrap** | A real signed APK that runs Chrome full-screen with no browser UI. Needs a valid PWA plus a Digital Asset Links file served from the origin. | Small, but the asset-links check makes a private hostname fiddly. |
| **Capacitor shell** | A real APK wrapping a WebView pointed at your host. Gives you native APIs — FCM push, share targets, biometrics — and does **not** need asset links. | Largest, and the one worth doing. |

**Recommendation: PWA first, then Capacitor.** The PWA work is a prerequisite
for both of the others and it independently closes a rough edge STATUS has
carried since Phase 6 — *"there is no service worker."* Orbit already has an
outbox, a device registry, per-device cursors and an `online` listener; a
service worker is the missing half of work somebody already did.

Two build facts that shape the brief:

- **This container has JDK 21 and no Android SDK.** The APK cannot be built
  here. GitHub Actions' `ubuntu-latest` runner ships the Android SDK, so the
  APK gets built in CI and uploaded as a downloadable artifact. That is also
  what makes the whole thing hands-off: push, wait, download, sideload.
- **Capacitor requires a `webDir` to exist** even when `server.url` points at a
  remote host. A minimal loading page is enough, and it is the right place to
  put a "can't reach Orbit" message.

---

## 4. The prompt

Paste the whole of the next section into a fresh Claude Code session on this
repo. It is written to run to completion without check-ins: every choice that
would normally warrant a question has a decision rule attached, and the stop
conditions are explicit.

---

> ## Brief: put Orbit on an Android phone
>
> You are working on `bullah12/Orbit`, branch `claude/orbit-android-shell`.
> Create it from `main` if it does not exist. Read `docs/STATUS.md` first, then
> `docs/decisions-log.md`, then `docs/deployment-and-android.md` §1–3 — those
> sections state the constraints you are working inside and you should not
> re-derive them.
>
> **Work autonomously. Do not stop to ask me anything.** Every ambiguity below
> has a decision rule. Where one is missing, choose the option that keeps the
> five commands in STATUS green, write the choice and its reason into
> `docs/decisions-log.md`, and keep going.
>
> ### What to build, in this order. Do not start a phase before the one above it is green.
>
> **Phase 1 — PWA foundation.**
> - `src/app/manifest.ts` (Next's typed metadata route): name Orbit, short name
>   Orbit, `display: 'standalone'`, `start_url: '/'`, theme and background
>   colours taken from the existing tokens in `src/app/globals.css` — do not
>   invent a colour, `tests/contrast.test.ts` exists for a reason.
> - Icons at 192px, 512px and a 512px maskable, generated as SVG-sourced PNGs
>   into `public/icons/`. Keep them plain; this is not a branding exercise.
> - `viewport` export in `src/app/layout.tsx` with `themeColor` and
>   `viewportFit: 'cover'`, and safe-area padding on the sidebar and main
>   column so the layout survives a phone's notch and gesture bar.
> - The sidebar is a desktop layout. Make it usable at 390px wide — a bottom
>   bar or a collapsible drawer, your call, but **every existing accessible
>   name must survive**: `labelAuditOn(page)` in `scripts/smoke.mjs` runs on
>   every page and must stay green.
>
> **Phase 2 — a real service worker.**
> - `public/sw.js` plus a small client registrar. Precache the app shell and
>   the icons; use network-first for pages and stale-while-revalidate for
>   static assets. **Never cache a Server Action POST and never cache a page
>   response as if it were another user's** — this app is RLS-scoped and a
>   cached page from Priya's session must not be served to Danny. If you cannot
>   guarantee that, cache only static assets and say so in the log.
> - Wire the service worker's own `online`/`offline` transitions to the outbox
>   flush that `src/lib/sync/` already implements. Do not build a second queue.
> - **This changes what STATUS says about "Work offline".** That switch is
>   currently honest about being a manual flick. Update every sentence in the
>   app and in the docs that says there is no service worker. Do not leave a
>   claim behind that the code has outgrown.
>
> **Phase 3 — the Android shell.**
> - Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`. Init with
>   app id `dev.orbit.app`, name Orbit.
> - `capacitor.config.ts` reads the host from `ORBIT_APP_URL` at config time
>   with **no default that points anywhere real** — an unset variable must fail
>   the build with a sentence naming the variable, not silently ship an APK
>   aimed at localhost.
> - `webDir` is a minimal `www/` containing one page that says Orbit could not
>   be reached and names the configured host. That page is what somebody sees
>   when the server is down, so write it like a real error screen.
> - `android/` is committed. Add the Gradle build outputs to `.gitignore`.
>
> **Phase 4 — CI that hands me an APK.**
> - `.github/workflows/android.yml`: on push to this branch and on
>   `workflow_dispatch`, set up JDK 21, set up the Android SDK, `pnpm install`,
>   `npx cap sync android`, `./gradlew assembleDebug`, and upload
>   `app-debug.apk` as an artifact with a retention of 30 days.
> - `ORBIT_APP_URL` comes from a repository variable, so the workflow is
>   readable without a secret.
> - Debug-signed only. **Do not generate, commit or reference a release
>   keystore**, and do not add any step that publishes anywhere.
> - Verify the workflow parses. You cannot run it here; do not claim you did.
>
> **Phase 5 — the deployment path, written down and only written down.**
> - `output: 'standalone'` in `next.config.ts`, and a Dockerfile that builds it.
> - `docs/deploy.md`: the Tailscale route and the Fly/Supabase route from
>   §2 of `docs/deployment-and-android.md`, as commands somebody can follow.
> - Include the `prepare: false` pooler note and the migration order.
> - **Do not deploy anything and do not create any hosting account.**
>
> ### Rules that override anything above
>
> - **Do not weaken the auth warning.** `AUTH_PROVIDER=dev` stays the only
>   implementation and `switchUser` stays impersonation. Your job is to make it
>   *reachable from a phone on a network I control*, not to make it public. If
>   a change would make exposure safer-looking without making it safer, don't.
> - **No migration.** Nothing here needs a schema change. If you become
>   convinced one is required, stop that phase, write the argument in
>   `docs/decisions-log.md`, and do the other phases instead.
> - **Do not touch RLS, policies, or `src/lib/db/index.ts`'s `asUser`.**
> - **The five commands in STATUS stay green**: `./scripts/db-test.sh` 83/83,
>   `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm smoke`. Run all five
>   before each commit that changes behaviour. A phase is not done until they
>   are green.
> - **Every new behaviour gets a test in the same commit**, matching the
>   existing pattern: Vitest for logic, a `scripts/smoke.mjs` section for
>   anything with a screen. Add smoke coverage for the manifest being served,
>   the service worker registering, and the mobile layout keeping its labels.
> - **Written-never-run stays written-never-run.** The APK will not have been
>   installed on a phone by you. Say that plainly in STATUS. Do not let CI
>   going green stand in for "it works on the phone".
>
> ### Finishing
>
> Push to `claude/orbit-android-shell` at least hourly — the container is
> ephemeral. Stop building at about three-quarters of your context, get the
> tree to a state that runs, then: rewrite `docs/STATUS.md` completely so it
> describes the tree as it now is, append this session's decisions to
> `docs/decisions-log.md`, keep `docs/phase-plan.md` accurate, and push.
>
> Open a pull request when Phase 4 is green, titled "Android shell and PWA
> foundation". In the body, list what a human still has to do by hand: set
> `ORBIT_APP_URL`, deploy the server, download the artifact, enable unknown
> sources, sideload. Do not merge it.

---

## 5. What you do by hand at the end

None of this can be done from a session, and no prompt will change that.

1. Stand up the server (§2 A or B) and give it an HTTPS hostname.
2. Set the `ORBIT_APP_URL` repository variable to that hostname.
3. Let the workflow run; download `app-debug.apk` from the run's artifacts.
4. On the phone: enable installing from unknown sources for your file manager,
   then open the APK.
5. If you took route A, the phone needs the Tailscale app running for Orbit to
   resolve.
