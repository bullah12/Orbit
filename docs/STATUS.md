# STATUS — handoff contract

Last rewritten: **session 1**, 2026-07-27. Branch: `claude/orbit-build-89i6ki`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next three
things** at the bottom.

> **Session 1 found an empty repository.** The brief says the schema is done and
> verified — it wasn't there. No `supabase/`, no `docs/`, one commit containing a
> README. So session 1 *wrote* the schema to the brief's constraints rather than
> extending it. From now on the "do not redesign it" rule applies normally.
>
> It is **41 tables**, not 39. The brief's number referred to a schema that did
> not exist; 41 is what the domain needed. All 41 have RLS.

---

## Works — verified by running it

Everything here was executed and watched, not assumed.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: installs PostGIS/pgvector/pgTAP if
  missing, starts Postgres, applies `supabase/migrations/*.sql` in order, then
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id` — both are asserted structurally
  by the test suite, so a careless new table breaks the build rather than the
  security model.
- `app.space_move_preview()` returns gains / loses / unchanged with a
  plain-language reason per person.
- `app.free_busy_blocks()` is the only path a `free_busy` participant has to
  event times, and it returns times only — no title, no attendees.

**Tests — `./scripts/db-test.sh`, 42/42 green**
- Runs as the `authenticated` role, not the table owner, so a policy that only
  appeared to work would fail.
- Covers: the outsider seeing nothing; the partner seeing shared but not private;
  `free_busy` seeing availability but no content; forged `owner_id` rejected;
  `item_shares` refusing a non-member; cross-space person linking needing write
  on both sides; locked items carrying no plaintext; `activity_log` refusing to
  record a view; and the move preview's gains/loses.
- `db-test.sh` also fails on a **plan-count mismatch**, which pgTAP reports as a
  comment rather than `not ok` and would otherwise pass silently.

**Seed — `pnpm seed`**
- Deterministic. 2 profiles (Priya Raghavan, Danny Whitehouse), 4 spaces, 42
  people, 200 events, 81 tasks spanning every smart list, 30 notes, 30 note
  links, 15 places with real Birmingham postcodes and PostGIS points.
- Danny is a full member of **Home** and a `free_busy` participant of **Work** —
  that combination is what makes the sharing model demoable in one click.
- Includes one locked task with a real ciphertext row, and AI consents seeded
  **off**.

**App — `pnpm build && pnpm start`**
- Today: due-today and overdue sections, plus the quiet "N events yesterday, no
  notes" row (decision 10 — that row is the entire feature, and it hides itself
  when there is nothing to say).
- Eight smart lists at `/tasks/<list>` with sidebar counts, derived from columns
  and never stored.
- Task detail with a **move confirmation** that renders `space_move_preview()`
  before anything is written, and re-runs it server-side on submit.
- Notes list, note editor (saves a `note_versions` snapshot on every save), and
  resolved links to tasks/people/places/events.
- Space indicator on every task row, every note row, and both compose surfaces.
- Dev user switcher in the sidebar.

**RLS verified through the running app, not just in pgTAP** — this is the check
that matters most, so it was done by hand with real HTTP requests:

| Acting as | Sees | Does not see |
|---|---|---|
| Priya | Home, Priya, Work | anything in Danny's personal space |
| Danny | Home, Danny | Priya's personal space; Priya's `private` tasks in Home; **any** Work task (0 rows, with the free/busy chip shown) |

The move preview for a Home task moving to Priya's space correctly reported
*"Danny Whitehouse — loses access"* and *"Priya Raghavan — unchanged"*.

---

## Stubbed / fixture-backed

- **Every external integration is unimplemented, including the fakes.**
  `.env.example` declares `CALENDAR_PROVIDER`, `ICS_PROVIDER`,
  `GEOCODING_PROVIDER`, `TRAVEL_TIME_PROVIDER`, `PUSH_PROVIDER`, `AI_PROVIDER`,
  and the ADR describes the interface-plus-fake pattern — but
  **`src/lib/integrations/` does not exist yet.** Nothing reads those variables.
  This is the largest gap between the documentation and the tree.
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation. No password, no OAuth, and the cookie is not signed despite
  `AUTH_COOKIE_SECRET` existing in `.env.example`.
- **Locked items** are modelled and enforced end to end in the database
  (constraints, excluded from search indexes, ciphertext in `encrypted_blobs`)
  but there is **no client-side crypto**. The seed's ciphertext is a literal
  placeholder string. The UI correctly refuses to show locked content.
- **Rules engine**: tables and two seeded rules exist, both disabled. No
  evaluator.

---

## Not started

Phases 1–6 in `docs/phase-plan.md`. Concretely: people UI, calendar UI (the 200
seeded events are not rendered anywhere), places/travel UI, rules evaluator,
search, NL capture, AI, sync.

---

## Known bugs and rough edges

Including the ones I introduced and did not fix.

1. **Task editing does not exist.** The phase-plan line says "list, smart lists,
   create, complete, edit" — create and complete work, edit does not. The task
   detail page is read-only apart from the move control. Same for notes: create,
   read, and edit work, but there is no delete and no archive.
2. **`switchUser` writes an unvalidated cookie.** Any UUID can be set as
   `orbit_user` and the app will act as that profile. It is a dev switcher and
   the whole point is impersonation, but it means **this build must not be
   exposed to a network you do not control.**
3. **No `is_locked` guard on the notes editor's write path.** `updateNote` has
   `and not is_locked` in its `UPDATE`, so a locked note cannot be overwritten —
   but the version snapshot is inserted *before* that check, so editing a locked
   note would write a `note_versions` row containing its (empty) title and body.
   Harmless today because locked rows carry no plaintext; still wrong.
4. **`moveTaskToSpace` silently drops the category.** Categories are per-space so
   the old one cannot follow, but the preview screen does not warn about it. The
   user finds out afterwards.
5. **Move is implemented for tasks only.** `previewMove()` accepts notes, people,
   events, and places, and `app.space_move_preview()` handles them — but no UI
   reaches them.
6. **Compose ignores categories.** `ComposeTask` posts no `categoryId`, so
   quick-added tasks are uncategorised and render without a category chip.
7. **`listSpaces` is called on every request in the layout** and again in most
   pages. Three round trips per page load where one would do.
8. **The dev server needs `pkill -f next-server`, not `pkill -f "next start"`.**
   I lost time to a stale process serving an old build and reporting phantom
   permission errors. If the app behaves as though your change did not happen,
   check for an orphaned `next-server` first.
9. **Postgres does not survive container restarts.** It stopped mid-session with
   no warning. `./scripts/db-reset.sh` restarts it, or `service postgresql start`
   if you do not want to lose data.
10. **No linting.** No ESLint, no Prettier, no CI. `pnpm typecheck` and
    `pnpm build` are the only automated checks on the TypeScript.
11. **`recurrence_rules` is unused.** Tasks and events both have the FK; nothing
    writes or expands one.
12. **Note bodies render as plain text**, not Markdown, despite being authored
    and stored as Markdown.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 42/42 must be green
pnpm build && pnpm start       # http://localhost:3000
```

Dev loop: `pnpm dev`. Reseed without touching schema: `pnpm seed`.
Rebuild schema without seeding: `./scripts/db-reset.sh --no-seed`.

**Env vars** — copy `.env.example` to `.env`; every value has a working default
and **no credential is required**.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://orbit_app:orbit_dev_password@localhost:5432/orbit` | App role. Owns nothing, no BYPASSRLS, no table grants. |
| `SEED_DATABASE_URL` | `postgres://orbit_seed:…@localhost:5432/orbit` | BYPASSRLS. Seeding only — never at request time. |
| `AUTH_PROVIDER` | `dev` | Only implementation. |
| `*_PROVIDER` | `fake` | Declared, **not yet read by anything**. |
| `ORBIT_DB_NAME` | `orbit` | Read by both scripts. |

Three Postgres roles, and the separation is deliberate: `orbit_app` (the app,
fully policy-bound), `orbit_seed` (BYPASSRLS, seeds only), `postgres` (owner,
migrations and tests).

---

## Next three things, in order

1. **Build `src/lib/integrations/` with the fake implementations.** This is the
   biggest documentation-vs-reality gap: the ADR and `.env.example` both promise
   an interface-plus-fake for six integrations and none exist. Start with
   `CalendarProvider` and `IcsProvider` since Phase 2 needs them, define the
   interface, ship the fixture-backed fake, and make the env var actually select
   it. Do not add a real implementation yet.

2. **Finish Phase 0's two unticked lines: task editing and note deletion.** Task
   detail needs an edit form (title, body, due date, priority, category,
   assignee) and `ComposeTask` needs to pass `categoryId`. While there, fix rough
   edges 3, 4, and 6 — they are all in the same two files
   (`src/app/actions.ts`, `src/components/ComposeTask.tsx`). Then tick the boxes
   in `docs/phase-plan.md`, and Phase 0 is genuinely shippable.

3. **Phase 1 — People.** The schema and 42 seeded people are ready, including a
   deliberately linked-not-merged pair of "Dr Iqbal" records across Home and
   Work. Build the list and detail pages, surface the link as two records that
   point at each other (never a merge), and add the pgTAP cases for
   `person_links` visibility from each side. **Bump `select plan(N)`** when you
   do — the runner fails on a mismatch.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
