# Decisions Log

Append-only. One line per decision, newest at the bottom of its section. Do not
relitigate anything here — if you depart from a decision, add a new line saying
what changed and why.

## Settled by the product owner (do not revisit)

1. **E2EE scope** — end-to-end encryption for `is_locked` items only; everything
   else is server-side at rest. Locked items are excluded from server-side search
   and from all AI paths.
2. **Partner is a light participant** — full N-member model in the data, UI
   optimised for one power user and one occasional viewer.
3. **free_busy** — policies stay as they are; only the UI changes: anonymous
   blocks in the merged calendar.
4. **Same-person linking** — two records, linked permanently, never collapsed,
   never auto-merged.
5. **Travel Mode** — manual + calendar-derived only. No background location. Do
   not request the permission.
6. **Desktop** — is the web app in a browser. No native shell.
7. **No email-in capture.**
8. **AI off by default**, per-feature opt-in, settings state what leaves the
   device. NL capture parsing is local-only and must never touch the network.
9. **No iCloud / CalDAV** — Google + `.ics` only.
10. **No post-event push prompt.** Today shows a quiet "3 events yesterday, no
    notes" row. That is the whole feature. **No pgvector.**

Standing rules: no streaks, badges, gamification or guilt. No "who viewed what"
tracking, ever.

## Session 1 — 2026-07-27

- **Branch is `claude/orbit-build-89i6ki`**, not `claude/orbit-life-os-g18nsk`. The
  task description named the latter but the session's designated branch is the
  former, and pushing elsewhere is not permitted. Same work, different name.
- **The repo was empty.** The brief says "the schema is done, 39/39 tables have
  RLS" — there was no `supabase/` directory and no `docs/`. Session 1 therefore
  *wrote* the schema rather than extending it. It is designed to match the brief's
  constraints (`space_id` + `owner_id` everywhere, RLS on every table, unique
  constraints led by `space_id`) so that from session 2 onward the "do not
  redesign it" rule applies normally.
- **Plain Postgres 16, not the Supabase CLI.** Supabase local requires Docker; the
  container has no guaranteed daemon. `0000_bootstrap.sql` creates the `auth`
  schema, `auth.uid()`, and the `anon`/`authenticated`/`service_role` roles so the
  same migrations apply unchanged to a real Supabase project later. Reversible: if
  we adopt the CLI, delete the bootstrap migration.
- **`postgres.js` over an ORM.** An ORM's fluent client invites application-side
  filtering, which is the exact failure mode RLS exists to prevent. SQL it is.
- **Single Next.js app at the repo root, not a monorepo.** Cheaper per session.
  Reversible: move `src/` into `apps/web/` later if a second deployable appears.
- **pgvector is installed but unused.** `scripts/db-reset.sh` installs it because
  the session brief says the reset needs it; decision 10 says we do not use it.
  Both are satisfied by installing the extension and referencing it nowhere.
- **Dev auth is a signed cookie naming a seeded user**, swappable behind
  `src/lib/auth/`. No OAuth, no password. `AUTH_PROVIDER=dev` is the default and
  the only implementation that exists.
- **The schema is 41 tables, not 39.** The brief's count referred to a schema
  that was not in the repository. 41 is what the domain needed; all 41 have RLS.
  Departure from the brief, recorded rather than hidden.
- **Identity lookup goes through two SECURITY DEFINER functions**
  (`app.identity_profile`, `app.identity_profiles`), not a table grant.
  Resolving a cookie to a profile happens before there is an `auth.uid()` to
  check against, so it cannot run under RLS. A plain `grant select on profiles`
  returns *zero rows* under RLS rather than erroring, which would have invited
  widening the grant until it worked. The functions cannot be widened by
  accident. `orbit_app` holds no table grants at all.
- **`apply_standard_rls()` deliberately does not use `force row level
  security`.** The table owner must bypass RLS so migrations, seeds, and pgTAP
  setup can write. Safety comes from the application connecting as
  `authenticated`, which is not the owner. If a future session ever makes the
  app connect as the owner, this stops protecting anything.
- **TypeScript pinned to 5.9.** 7.x resolved by default and Next 15's config
  loader fails on it with `Cannot read properties of undefined (reading
  'fileExists')`. Revisit when Next supports it.
- **Money is `numeric(12,2)` and dates are `date`/`timestamptz`, never text.**
  UK conventions (DD/MM/YYYY, 24h, £, Monday-first weeks) are a *formatting*
  concern and live in `src/lib/format.ts` only.

## Session 2 — 2026-07-28

- **Vitest, not Jest, and no test framework for React components.** The suite
  covers pure logic — dates, smart-list rules, Markdown, colour maths. Rendering
  is verified by driving the real app (`pnpm smoke`), which catches the things a
  shallow render cannot: whether the *server action* wrote to Postgres, and
  whether RLS holds over HTTP. Reversible: add a component runner later if a
  component grows logic worth isolating.
- **`format.ts` functions take an injectable `today`/`now`.** A date test that
  depends on the container's clock tests the container. Callers are unaffected —
  the parameter defaults to real time.
- **Smart-list rules exist twice on purpose**: as SQL in `queries/tasks.ts` for
  listing, and as pure predicates in `smartlists.ts` for the task detail page,
  the tests, and the optimistic path Phase 6 will need. Duplication accepted;
  the module comment and the test names say to change both. The alternative —
  fetching from Postgres to answer "which lists is this task in?" — costs a
  round trip on every render.
- **Markdown is a hand-written subset, not a dependency.** It parses to a typed
  tree that React renders, so raw HTML is never a node and the sanitiser
  question does not arise. Link targets are filtered to http/https/mailto and
  in-app paths. No tables, images or task lists yet — recorded as a rough edge,
  not a silent gap.
- **Contrast is a test, not a judgement.** `src/lib/colour.ts` converts oklch to
  sRGB and computes WCAG ratios from the tokens in `globals.css`. It found four
  real failures on its first run (emerald, amber, lime and orange against their
  own light chip fill, 4.31–4.51:1); those tokens were darkened. A new colour
  that reads badly now fails `pnpm test`.
- **`app.entity_space()` is SECURITY INVOKER, deliberately.** It exists so note
  linking can refuse a cross-space link. As SECURITY DEFINER it would hand back
  a space id for an item the caller cannot read, which is a membership
  disclosure. There is a pgTAP case pinning this.
- **The outsider check iterates `pg_tables` rather than listing tables.** A
  per-table hand-written case is the thing you forget. The cost is that it can
  pass vacuously on an empty table, so assertion 44 is a ledger of the tables
  that are legitimately empty today; a new table appearing there means nothing
  writes to it.
- **A third seeded profile, Sam Okafor, a member of nothing.** pgTAP proves an
  outsider sees zero; this makes the same thing provable *through the app*, in
  one click of the dev switcher. Its UUID is a literal, not a `uid()` call, so
  adding it shifted no other seeded id.
- **`pnpm smoke` is a first-class check, not a scratch script.** "Verify RLS
  through the running app, not only in pgTAP" is a standing instruction; a
  repeatable command is the only way that survives a session boundary. It is
  deliberately not wired into `pnpm test` — it needs a running server.
- **Archive before delete, everywhere it is offered.** Notes archive by default
  and can only be deleted from the archive. Tasks delete outright because a task
  is a smaller thing to lose and `status = 'dropped'` already exists for the
  reversible case. Departure from nothing in particular; recorded because the
  asymmetry is deliberate.
- **`ComposeTask` became a client component.** Categories belong to a space, so
  changing the space has to change the category list without a round trip.
  Rendering every space's categories at once and letting the server sort it out
  is how a task ends up silently uncategorised — which is exactly the bug
  session 1 recorded as rough edge 6.
