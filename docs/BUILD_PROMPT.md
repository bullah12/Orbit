# Build prompt — Orbit

Paste everything below the line into a fresh session on this repository. Use the same
prompt every session — it is written to be re-entered, not run once.

---

Build Orbit. Work autonomously. **Do not ask me anything** — every question you might have
is already answered below or in `docs/`. If you hit something genuinely undecided, pick the
option that is easiest to reverse, write one line into `docs/decisions-log.md`, and keep
going.

This is a **multi-session build**. You will not finish in one sitting and you are not
expected to. Your job this session is to move the ball down the field and leave the next
session able to pick up in under five minutes.

## Every session starts the same way

1. Read `docs/STATUS.md` if it exists. **It is the handoff contract and it takes precedence
   over your own assumptions about what is done.** If it doesn't exist yet, you are the
   first session.
2. Read `docs/decisions-log.md` for judgement calls already made. Don't relitigate them.
3. Skim `docs/adr/0001-architecture.md` and `docs/phase-plan.md`.
4. Get the database up: `./scripts/db-reset.sh`. It needs PostGIS and pgvector for
   postgresql-16 — install them via apt if the container is fresh, then re-run. The schema
   must apply cleanly before you build anything.
5. Pick the next unstarted item from STATUS.md's "next three things" and start.

First session only: read `docs/adr/0001-architecture.md` in full, and
`supabase/tests/README.md`.

## Every session ends the same way

**Stop building while you still have room to finish cleanly** — when you're maybe
three-quarters through your context, not when you hit the wall. Then:

1. Get the working tree to a state that runs. Not mid-refactor.
2. Update `docs/STATUS.md` (format below).
3. Commit and push: `git push -u origin claude/orbit-life-os-g18nsk`.

**The container is ephemeral. Anything not pushed is gone.** Push at least hourly during
the session too, not only at the end.

Running out of context mid-slice and leaving the branch broken is the single worst outcome
available to you — worse than building nothing. A session that adds one working feature and
a clean handoff is a good session.

## `docs/STATUS.md` — the handoff contract

Rewrite it fully each session. Be honest; I would rather read "week view is broken" than
find out myself. Do not oversell.

```markdown
# Status — <date>, session N

## Works (verified by running it)
## Stubbed / fixture-backed (what would need real credentials)
## Not started
## Known bugs and rough edges   <- including ones you introduced and didn't fix
## How to run   <- exact commands, env vars
## Next three things, in order
```

"Works" means you ran it and watched it work. Not "implemented". If you didn't verify it,
it goes under rough edges.

## The schema is done

`supabase/migrations/` is finished, verified against Postgres 16 with real PostGIS and
pgvector, and 39/39 tables have RLS. **Do not redesign it.** Extend only when a feature
genuinely needs a column that isn't there, and when you do: new migration, never edit an
applied one, `space_id` and `owner_id` on any new table, add it to the RLS coverage in
`20260101000800_rls.sql`, and lead every unique constraint with `space_id`.

## Decisions — settled, do not revisit

1. **Encryption.** End-to-end (device-held key) for `is_locked` items only; server-side at
   rest for everything else. Locked items stay excluded from server-side search and from
   all AI features — that exclusion is structural in the schema; keep it that way.
2. **Partner is a light participant.** Build the full N-member model as designed, but
   optimise the shared UI for one power user and one occasional viewer. Shared surfaces
   that matter: joint events, want-to-go list, a shared task list.
3. **`free_busy`.** Role and policies stay. Only UI is anonymous busy blocks in the merged
   calendar, which you need anyway. No dedicated screens.
4. **Same-person linking.** Two records, linked permanently via `people.same_as_person_id`.
   Never collapse to one. Never auto-merge on import.
5. **Travel Mode detection.** Manual plus calendar-derived (flight/train/hotel event) only.
   **No background location, no geofencing.** Do not request the permission.
6. **Desktop is the web app in a browser.** No Tauri, no Electron, no global hotkey.
7. **No email-in capture.** Share sheet and in-app capture only.
8. **AI off by default**, per-feature opt-in, settings stating exactly what leaves the
   device. Natural-language capture parsing is **local-only** — `chrono-node` for the date
   substring plus hand-written tokenising for `@context`, `!priority`, `#tag`, `@Person`,
   `[[note]]`. It must never touch the network.
9. **No iCloud/CalDAV.** Google + `.ics` only.
10. **No post-event push prompt.** Today shows a quiet "3 events yesterday, no notes" row
    and that is the whole feature. No pgvector, no semantic search.

Standing rules from the brief, non-negotiable: **no streaks, badges, gamification or
guilt**, and **no "who viewed what" tracking, ever**.

## Environment reality — handle it, don't ask

Assume **no Supabase cloud project, no Google OAuth credentials, no API keys.** Never block
on one.

- Put **every external integration behind an interface** with two implementations: real,
  and a fixture-backed fake selected by env var. Google Calendar, ICS fetch, geocoding,
  travel time, push, Anthropic. The app must run end to end and be demoable with zero
  credentials.
- Build `pnpm seed` early, in Phase 0 — it is how the work gets verified, by you and by me.
  Two users, a household space, and realistic Birmingham data: ~40 people, ~200 events
  across categories, ~80 tasks spanning every smart list, ~30 notes with real links,
  ~15 places.
- If a dependency won't install after two honest attempts, choose another and log it.

## Order of work

Strict phase order from `docs/phase-plan.md`. **Each phase shippable before the next
starts** — it runs, the seed exercises it, tests pass, branch pushed.

Phase 0 is the priority and is not negotiable. It is genuinely usable on its own; if the
build stops after Phase 0 I have a private task and note app with sharing already real,
which is a good outcome. Everything after it is upside.

Work in **vertical slices that run**, not layers. "Tasks list renders real seeded data from
the database with the space indicator on every row" beats "all the data-access code for
every entity, wired to nothing."

## Non-negotiables while you build

**The RLS tests are the point.** Install pgTAP and get
`supabase/tests/rls_isolation_test.sql` green (it has never been executed — expect to fix
the plan count and some helper signatures). Green before Phase 0 is called done, and it
stays green. Add a case whenever you add a table. A bug in the sync engine loses data; a
bug here is a privacy breach.

**Never let the client be the arbiter of visibility.** If a query returns rows the user
shouldn't see, the fix is a policy, not a `.filter()`.

**The space indicator is a hard requirement, not a nicety.** Personal vs Shared legible at
a glance on every list row and every compose surface — consistent visual treatment, not a
small icon in a corner. Every move between spaces goes through a confirmation backed by
`app.space_move_preview()`, naming exactly what becomes visible. Get this right before
anything pretty.

**Calm and dense, not playful and sparse.** Neutral chrome; category colour is the only
strong colour on screen. Every category carries icon and label as well as colour — never
colour alone. Full dark mode. UK conventions throughout: Europe/London with correct DST,
Monday week start, DD/MM/YYYY, 24h option, GBP, metric with miles for road distance.

**Test where the bugs hide:** RLS policies, the sync engine, the category rules engine.
Table-driven where you can. Don't chase coverage elsewhere.

## Working rhythm

- Commit every vertical slice that runs. Never leave the branch broken between commits.
- Branch `claude/orbit-life-os-g18nsk`. **Do not open a pull request.**
- Keep `docs/decisions-log.md` current — every judgement call, one line each.
- If you find the design is wrong about something, fix it and write down what and why. The
  design is a starting point, not scripture — but say when you depart from it.
