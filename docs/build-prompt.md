# Orbit — the standing build prompt

Paste this at the start of every session until Orbit is finished. It replaces
the original build brief. It does not change between sessions; `docs/STATUS.md`
is what changes.

---

Build Orbit. Work autonomously. Do not ask me anything — every question you
might have is answered below or in `docs/`. If you hit something genuinely
undecided, pick the option that is easiest to reverse, write one line into
`docs/decisions-log.md`, and keep going.

This is a multi-session build and you will not finish it in one sitting. Your
job this session is to drive the project measurably closer to done and leave the
next session able to pick up in under five minutes. A session that closes out one
phase properly and hands over cleanly is a good session. A session that runs out
of context mid-slice and leaves the branch broken is the worst outcome available
to you — worse than building nothing.

## Every session starts the same way

1. Read `docs/STATUS.md`. It is the handoff contract and it takes precedence
   over your own assumptions about what is done. In particular, believe its
   "Known bugs and rough edges" section — the previous session wrote it against
   itself.
2. Read `docs/decisions-log.md` and don't relitigate what's there.
3. Skim `docs/adr/0001-architecture.md` and `docs/phase-plan.md`.
4. Bring the database up with `./scripts/db-reset.sh`. It needs PostGIS and
   pgTAP for postgresql-16 and will apt-install them if the container is fresh.
   Postgres does not always survive a container restart; the script restarts it.
5. Run `./scripts/db-test.sh` before you write anything. It must be green on
   arrival. If it is not, fixing it is your first job.
6. Pick the next unstarted item from STATUS.md's "Next three things" and start.

## What "complete" means

Orbit is finished when all six of these are true. Nothing here is optional and
nothing here is satisfied by a plan, a stub, or a comment saying it will be done
later.

1. **Every box in `docs/phase-plan.md` is ticked**, Phases 0 through 6, and every
   tick corresponds to something you ran and watched work.
2. **Every entry under "Known bugs and rough edges" in STATUS.md is fixed or
   consciously accepted.** Accepted means a line in `docs/decisions-log.md`
   saying why, not silence. The list as it stands at session 1 includes: no task
   editing, compose dropping `categoryId`, the move silently discarding the
   category, move being wired for tasks only, the unvalidated dev cookie, the
   note version snapshot running before the `is_locked` guard, note bodies
   rendering as plain text instead of Markdown, and unused `recurrence_rules`.
3. **`./scripts/db-test.sh` is green**, with an isolation case for every table —
   including a "the outsider sees zero" case, which is what catches a table
   shipped without a policy.
4. **A TypeScript test suite exists and passes** (Vitest, `pnpm test`), covering
   the logic pgTAP cannot reach: the rules engine, sync and conflict handling,
   smart-list derivation, recurrence expansion, NL capture parsing, and date
   formatting across BST/GMT boundaries. Test where the bugs hide.
5. **The app is accessible.** Keyboard-navigable throughout, focus managed and
   trapped in dialogs, real labels on every control, live regions where content
   updates, and contrast verified in both light and dark. A dense interface is a
   keyboard interface.
6. **`pnpm build`, `pnpm typecheck`, `pnpm test` and `./scripts/db-test.sh` all
   pass from a cold container**, following only the commands written in
   STATUS.md's "How to run".

## Every session ends the same way

Stop building at about three-quarters of your context — not when you hit the
wall. Then get the tree to a state that runs (not mid-refactor), rewrite
`docs/STATUS.md` completely, tick what you verified in `docs/phase-plan.md`,
append to `docs/decisions-log.md`, and push. The container is ephemeral; anything
not pushed is gone. Push at least hourly during the session too.

`docs/STATUS.md` is rewritten fully each session, with these sections: **Works**
(verified by running it) · **Stubbed/fixture-backed** · **Not started** · **Known
bugs and rough edges**, including ones you introduced and didn't fix · **How to
run**, exact commands and env vars · **Next three things**, in order. "Works"
means you ran it and watched it work — if you didn't verify it, it goes under
rough edges. Be honest; I'd rather read "week view is broken" than find out
myself.

## Decisions — settled, do not revisit

1. E2E encryption for `is_locked` items only, server-side at rest for the rest;
   locked items stay excluded from server-side search and all AI.
2. Partner is a light participant — full N-member model, UI optimised for one
   power user and one occasional viewer.
3. `free_busy`: policies stay, only UI is anonymous blocks in the merged
   calendar.
4. Same-person linking = two records, linked permanently, never collapsed, never
   auto-merged.
5. Travel Mode: manual + calendar-derived only, no background location, don't
   request the permission.
6. Desktop is the web app in a browser.
7. No email-in capture.
8. AI off by default, per-feature opt-in, settings stating what leaves the
   device; NL capture parsing is local-only and must never touch the network.
9. No iCloud/CalDAV — Google + `.ics` only.
10. No post-event push prompt; Today shows a quiet "3 events yesterday, no notes"
    row and that's the whole feature. No pgvector.

**Standing rules: no streaks, badges, gamification or guilt; no "who viewed
what" tracking, ever.**

## The schema

It is done and verified — 41 tables, all with RLS. Do not redesign it. Extend
only when a feature genuinely needs a column that isn't there: new migration,
never edit an applied one, `space_id` + `owner_id` on any new table, add it to
the RLS coverage and to the pgTAP suite, lead every unique constraint with
`space_id`.

## Environment reality — handle it, don't ask

There is no Supabase cloud project, no OAuth credentials and no API keys, and
there never will be. Never block on one. **The app must run end to end and be
demoable with zero credentials, and it must stay that way through every phase.**

Every external integration — Google Calendar, ICS, geocoding, travel time, push,
Anthropic — is an interface with two implementations:

- a **fixture-backed fake**, which is the default, is selected by env var, and is
  the one your tests exercise; and
- a **real implementation written against the published API**, which you will
  never be able to execute here.

Write both. Mark every real implementation in STATUS.md as *written, never run* —
do not describe it as working, and do not let the fake silently stand in for it
in a "Works" claim.

Keep the app local-only. No deployment config, no production env handling, no
migration to a hosted Supabase project. The migrations stay Supabase-compatible
so that remains a later, separate decision.

## Order of work

Strict phase order from `docs/phase-plan.md`. Each phase must be shippable —
usable and demoable, not merely merged — before the next one starts. Work in
vertical slices that run, not layers: "the week view renders real seeded events
with the space indicator on every block" beats "all the calendar data-access code
wired to nothing".

Finish Phase 0's two unticked lines before touching Phase 1.

## Non-negotiables

- **Never let the client be the arbiter of visibility.** If a query returns rows
  the user shouldn't see, the fix is a policy, not a `.filter()`. If a page needs
  data the current user can't see, that's a policy question, not a client
  question — and the answer is usually no.
- **Keep `supabase/tests/rls_isolation_test.sql` green** and add a case whenever
  you add a table. Bump `select plan(N)`; the runner fails on a mismatch.
- **The space indicator is a hard requirement** — legible at a glance on every
  row and every compose surface, with `app.space_move_preview()` behind every
  move confirmation, for every entity type that can move. Get it right before
  anything pretty.
- **Verify RLS through the running app**, not only in pgTAP. Act as the partner,
  act as an outsider, and check what actually comes back over HTTP.
- Calm and dense, neutral chrome, category colour the only strong colour and
  always with icon and label, full dark mode, UK conventions throughout.

## Explicitly out of scope — do not spend context here

ESLint, Prettier, GitHub Actions, and any other CI. `pnpm typecheck`, `pnpm
build`, `pnpm test` and `./scripts/db-test.sh` are the checks that matter; run
them yourself. Also out of scope: deployment, hosted Supabase, real credentials
of any kind, and anything on the standing-rules banned list.

## Rhythm

Commit every vertical slice that runs. Never leave the branch broken. Work on the
branch this session designates — the same one the previous session pushed to —
and do not open a pull request. Keep `docs/decisions-log.md` current.

If the design is wrong about something, fix it and write down what and why. It is
a starting point, not scripture — but say when you depart from it.
