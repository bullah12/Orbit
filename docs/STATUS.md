# STATUS — handoff contract

Last rewritten: **session 2**, 2026-07-28. Branch: `claude/orbit-build-8ybx2s`.

This file takes precedence over your assumptions about what is done. Read it,
then `docs/decisions-log.md`, then get the database up and pick from **Next
three things** at the bottom.

**Where the project is:** Phases 0 and 1 are complete and shippable. Phase 2
(Calendar) has not started, and is blocked on `src/lib/integrations/`, which
does not exist. Phases 3–6 have not started.

**Five commands are the whole truth about this repo.** All five were run from a
rebuilt database at the end of session 2 and all five were green:

```
./scripts/db-test.sh   52/52 pgTAP assertions
pnpm typecheck         clean
pnpm test              121 Vitest tests
pnpm build             clean
pnpm smoke             39/39 against the running app     (needs pnpm start)
```

---

## Works — verified by running it

Everything here was executed and watched. Where it says "verified", there is a
command above that proves it.

**Database**
- `./scripts/db-reset.sh` rebuilds from zero: apt-installs PostGIS/pgvector/pgTAP
  if missing, starts Postgres, applies `supabase/migrations/*.sql` in order,
  seeds. It **fails the run** if any table lacks RLS.
- 41 tables, 41 with RLS. `space_id` + `owner_id` on every space-scoped table;
  every unique constraint leads with `space_id`. Both are asserted structurally,
  so a careless new table breaks the build rather than the security model.
- `app.space_move_preview()` returns gains / loses / unchanged with a
  plain-language reason per person.
- `app.free_busy_blocks()` is the only path a `free_busy` participant has to
  event times, and returns times only.
- **New in session 2:** `app.entity_space(kind, id)` — `SECURITY INVOKER`, so an
  item you cannot read resolves to *no rows* rather than to a space id. Note
  linking uses it to refuse a link across a space boundary.

**pgTAP — `./scripts/db-test.sh`, 52/52**
- Runs as `authenticated`, not the table owner, so a policy that only appeared
  to work would fail.
- **"The outsider sees zero rows in every table in the database"** iterates over
  `pg_tables` rather than a hand-written list, so a table added tomorrow is
  covered the moment it exists. This is the assertion that catches a table
  shipped without a policy.
- Guarded against a vacuous pass by a ledger of tables that are legitimately
  empty after a fresh seed (assertion 48). It is a **subset** check: a ledger
  table filling up is fine (using the app writes to `activity_log`, and this
  suite runs against the live database), but a table *outside* the ledger being
  empty fails — that means either the seed did not run or you have shipped a
  table nothing writes to, whose policy is therefore untested.
- Also covers: partner sees shared but not private; `free_busy` sees
  availability but no content; forged `owner_id` rejected; `item_shares`
  refusing a non-member; cross-space person linking needing write on both sides;
  **person_links read from each side, including the far record resolving to
  nothing for the partner**; locked items carrying no plaintext; `activity_log`
  refusing to record a view; the move preview's gains/loses.
- `db-test.sh` also fails on a plan-count mismatch, which pgTAP reports as a
  comment rather than `not ok`.

**TypeScript tests — `pnpm test`, 121 Vitest tests**
- `tests/format.test.ts` (33) — dates across the BST/GMT boundaries. Every case
  names the boundary it stands on. `format.ts` takes an injectable `today`/`now`
  so a failure means the rule is wrong, not the container's clock.
- `tests/smartlists.test.ts` (32) — every smart-list rule as a pure predicate,
  including the overlaps (an overdue task is *also* in Today) and the 25-hour
  day on 25 October.
- `tests/markdown.test.ts` (30) — the note Markdown subset, link-target safety,
  and that unbalanced markers terminate rather than loop.
- `tests/contrast.test.ts` (26) — WCAG ratios computed from the actual tokens in
  `globals.css`, both themes. It **found four failures** on arrival (emerald,
  amber, lime, orange against their own light chip fill, 4.31–4.51); those are
  fixed.

**Smoke — `pnpm smoke`, 39 checks against the running app**
`scripts/smoke.mjs` drives Chromium against `pnpm start`. This is how "verify
RLS through the running app, not only in pgTAP" gets done, and it is repeatable.
It restores what it edits; the people run leaves one archived person behind per
invocation (rough edge 1).

| Acting as | Result |
|---|---|
| Priya | 56 tasks in All open, every row with a space indicator; 42 people; task *and* person edits round-trip to Postgres; create, link, unlink, move and archive a person all work |
| Danny (partner) | 29 rows in Home; **0 in Work**, with the free/busy chip still shown; **0 in Priya's personal space**; sees that a person link exists but *not* what is on the other side |
| Sam Okafor (outsider) | **0 rows on Today, All open, Notes and People**; a direct link to someone else's task is a **404, not a 403** |

**App — Phase 0**
- Today: due-today, overdue, the quiet "N events yesterday, no notes" row
  (decision 10 — that row is the whole feature and hides itself when there is
  nothing to say), and **Coming up** (birthdays/anniversaries, next 21 days).
- Eight smart lists at `/tasks/<list>` with sidebar counts, derived from columns.
- **Task detail is a full edit form**: title, body, status, priority, due date,
  category, assignee, estimate, waiting-on, deferral, plus delete. Category and
  assignee are resolved *in SQL against the task's own space*, so a stale form
  cannot write a cross-space reference. The header says which smart lists the
  task is in.
- Move confirmation renders `space_move_preview()` before anything is written,
  re-runs it server-side on submit, and **now states that the category will be
  cleared** and why.
- Notes: list, archive view, read, create, edit (with a `note_versions` snapshot
  on every save), **archive / restore / delete-from-archive**, and **links that
  can be added and removed** through a picker scoped to the note's own space.
- **Note and task bodies render as Markdown** — a parsed tree, not a string of
  HTML, so raw markup is never a node and there is nothing to sanitise.
- Compose passes a category; it is a client component so changing the space
  changes the category list.
- Space indicator on every task row, note row, person row, and both compose
  surfaces.
- Dev user switcher, now including the outsider.

**App — Phase 1 (People)**
- `/people`: compose bar with the space chips, list, bookmarkable name/nickname
  search, "linked" chip, next important date, space indicator on every row.
- `/people/[id]`: the linked-record panel first (two records, both exist,
  nothing merges them), then an edit form (name, known-as, pronouns, category,
  Markdown notes), contacts with `mailto:`/`tel:`, important dates with the year
  suppressed when unknown, mentions, the move confirmation, and archive.
- Contacts and dates can be added and removed. Every insert takes `space_id` and
  `owner_id` from the person's own row, never from the form.
- **Link and unlink.** The row is written once in canonical id order — the check
  constraint requires `person_a_id < person_b_id`, so which record you started
  from cannot change what gets stored. Candidates come only from spaces you can
  *write*, because the policy requires write on both sides. Unlinking leaves
  both records exactly as they were.
- **Move**, with the same preview-before-write contract as tasks, and a
  consequence line covering all three effects: contacts and dates travel with
  the person, the category cannot, and a link survives but the far side may stop
  being able to see this record.
- The link resolves through RLS in both directions. When the far record is in a
  space you cannot read, the row stays and says *"a linked record in a space you
  cannot see"* — the link's existence is not a secret, its contents are.

---

## Stubbed / fixture-backed

- **Every external integration is unimplemented, including the fakes.**
  `.env.example` declares `CALENDAR_PROVIDER`, `ICS_PROVIDER`,
  `GEOCODING_PROVIDER`, `TRAVEL_TIME_PROVIDER`, `PUSH_PROVIDER`, `AI_PROVIDER`,
  and the ADR describes the interface-plus-fake pattern — but
  **`src/lib/integrations/` does not exist.** Nothing reads those variables.
  This is still the largest gap between the documentation and the tree, and
  Phase 2 cannot ship without it.
  *No real implementation has been written either, so there is nothing yet to
  mark "written, never run".*
- **Auth** is a cookie naming a seeded profile. `AUTH_PROVIDER=dev` is the only
  implementation. No password, no OAuth; the cookie is unsigned despite
  `AUTH_COOKIE_SECRET` existing in `.env.example`. It now refuses an id that is
  not a seeded profile.
- **Locked items** are modelled and enforced end to end in the database
  (constraints, excluded from search indexes, ciphertext in `encrypted_blobs`)
  but there is **no client-side crypto**. The seed's ciphertext is a placeholder.
  The UI refuses to show locked content and refuses to edit it.
- **Rules engine**: tables and two seeded rules exist, both disabled. No
  evaluator.

---

## Not started

Phases 2–6 in `docs/phase-plan.md`: calendar UI (the 200 seeded events are not
rendered anywhere), places/travel UI, rules evaluator, search, NL capture, AI,
sync.

---

## Known bugs and rough edges

Including the ones I introduced and did not fix.

1. **`pnpm smoke` leaves one archived person behind per run.** It archives
   rather than deletes, because archiving is the reversible option and deleting
   a person is not offered in the UI. `pnpm seed` clears them. Harmless, but the
   people count creeps up if you run it repeatedly.
2. **`pnpm typecheck` needs a `pnpm build` first on a fresh clone.** Typed
   routes are generated into `.next/types`, so `tsc` fails with
   `Type '"/people"' is not assignable to type 'RouteImpl<"/people">'` until a
   build has run once. Documented in "How to run" — do not chase it.
3. **`switchUser` is still impersonation by design.** It now refuses an id that
   is not a seeded profile, but any seeded profile can be assumed with one
   click. **This build must not be exposed to a network you do not control.**
4. **Move is implemented for tasks and people only.** `previewMove()` also
   accepts notes, events and places, and `app.space_move_preview()` handles
   them — no UI reaches those three. Notes are the obvious next one.
5. **`recurrence_rules` is unused.** Tasks and events both have the FK; nothing
   writes or expands one. It is in the known-empty ledger in the pgTAP suite.
6. **The Markdown subset has no tables, no images, no task lists.** Deliberate
   for now, but a note pasted from elsewhere will lose them silently rather
   than showing them as literal text.
7. **The people list's "next date" is computed twice**, once in SQL for the
   ordering and once in TypeScript for the label (`nextOccurrence` in
   `src/app/people/page.tsx`). They agree today. They are two places to change,
   and neither is covered by a Vitest case — the anniversary maths deserves one.
8. **A person's category is resolved back from its *name*** on the detail page,
   because the query returns the category as a chip rather than an id
   (`findCategoryId`). Names are unique per space so it is correct, and the
   action re-checks the id against the space anyway, but it is a lookup that
   should not need to exist.
9. **Contacts cannot be edited, only added and removed**, and `is_primary` is
   never set from the UI — the seed is the only thing that marks a primary
   contact.
10. **Postgres does not survive container restarts.** `./scripts/db-reset.sh`
   restarts it, or `service postgresql start` if you do not want to lose data.
11. **`pkill -f next-server`, not `pkill -f "next start"`.** And start the server
   with `setsid nohup … & disown` or the tool that started it will take it down
   with it.
12. **No linting.** Out of scope by instruction. `pnpm typecheck`, `pnpm build`,
    `pnpm test`, `./scripts/db-test.sh` and `pnpm smoke` are the checks.
13. **`pnpm smoke` needs a running server** and Chromium at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Override with
    `CHROMIUM_PATH`. It is not wired into any other command on purpose.

Fixed in session 2, previously listed here: task editing; the locked-note
version-snapshot leak; the silent category drop on move; compose ignoring
categories; `listSpaces` running three times per page; note bodies rendering as
plain text; note delete/archive; people being read-only.

Also fixed within this session: the pgTAP empty-table ledger compared for
equality, so simply *using the app* failed the suite. It is a subset check now.

---

## How to run

From a cold container:

```sh
cd /home/user/Orbit
pnpm install
./scripts/db-reset.sh          # installs extensions if needed, migrates, seeds
./scripts/db-test.sh           # 52/52 must be green
pnpm build                     # also generates the typed-route definitions
pnpm typecheck                 # needs the build above on a fresh clone
pnpm test                      # 121 Vitest tests
pnpm start                     # http://localhost:3000
pnpm smoke                     # 27 checks against the running app
```

Start the server so it survives the shell that launched it:

```sh
setsid nohup pnpm start > /tmp/next.log 2>&1 < /dev/null & disown
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
| `ORBIT_URL` | `http://localhost:3000` | `pnpm smoke` only. |
| `CHROMIUM_PATH` | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | `pnpm smoke` only. |

Three Postgres roles, deliberately separated: `orbit_app` (the app, fully
policy-bound), `orbit_seed` (BYPASSRLS, seeds only), `postgres` (owner,
migrations and tests).

**Seeded profiles** — switch between them in the sidebar:

| | id | Sees |
|---|---|---|
| Priya Raghavan | `…0001` | Priya, Home, Work — the power user |
| Danny Whitehouse | `…0002` | Danny, Home; `free_busy` on Work — the partner |
| Sam Okafor | `…00ff` | nothing at all — the outsider |

---

## Next three things, in order

1. **Build `src/lib/integrations/` with the fakes.** This is the biggest
   documentation-vs-reality gap and Phase 2 is blocked on it. Define
   `CalendarProvider` and `IcsProvider`, ship the fixture-backed fakes, make the
   env var actually select one, and write Vitest coverage against the fake.
   Write the real Google/ICS implementations too — they can never be executed
   here, so mark them in STATUS as **written, never run** and do not let the
   fake stand in for them in a "Works" claim.

2. **Phase 2 — Calendar.** 200 seeded events render nowhere. Day/week/month,
   Monday-first, merged across spaces, with `free_busy` participants as
   anonymous blocks via `app.free_busy_blocks()`. `startOfWeekISO` and
   `londonMidnight` in `src/lib/format.ts` exist and are tested for exactly
   this; use them rather than reaching for `getDate()`. Add Vitest cases for the
   week grid across both BST boundaries — that is where this will break. Add a
   smoke check that Danny sees anonymous blocks and not titles.

3. **ICS import, then recurrence.** With `IcsProvider` in place, import into
   `events` and expand `recurrence_rules` (rough edge 5 — the FK exists and
   nothing writes one). Recurrence expansion is named in the completion criteria
   as something the Vitest suite must cover, and it is a bug farm: test the
   month-end cases and both BST boundaries before wiring any UI to it.

### Before you finish your session

Stop building at about three-quarters of your context. Get the tree to a state
that runs, rewrite this file completely, tick what you verified in
`docs/phase-plan.md`, append to `docs/decisions-log.md`, and push. The container
is ephemeral. Push at least hourly.
