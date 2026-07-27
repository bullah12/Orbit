# Autonomous build prompt — Orbit

Paste everything below the line into a fresh agent session on this repository.

---

Build Orbit. Work autonomously for the next four hours. **Do not ask me anything** — every
question you might have is already answered below or in `docs/`. If you hit something
genuinely undecided, pick the option that is easiest to reverse, write it into
`docs/decisions-log.md` with one line of reasoning, and keep going.

## Start here

Read, in this order, before writing code:

1. `docs/adr/0001-architecture.md` — the stack and the four load-bearing decisions
2. `docs/phase-plan.md` — what is in and out of each phase
3. `supabase/migrations/` — the schema already exists and has been applied successfully
4. `supabase/tests/rls_isolation_test.sql` and `supabase/tests/README.md`

The schema is done and correct. Do not redesign it. Extend it only when a feature
genuinely needs a column that isn't there, and when you do: add a new migration, never
edit an applied one, put `space_id` and `owner_id` on any new table, add it to
`20260101000800_rls.sql`'s coverage, and lead every unique constraint with `space_id`.

## Decisions — these are settled, do not revisit

The design doc lists ten open questions. They are now answered:

1. **Encryption.** End-to-end (device-held key, server stores ciphertext) for items flagged
   `is_locked` only. Everything else is server-side at rest. Locked items are excluded from
   server-side search and from all AI features — that exclusion is already structural in
   the schema; keep it that way.
2. **Partner is a light participant.** Build the full N-member model as designed, but
   optimise the shared-space UI for one power user and one occasional viewer. Shared
   surfaces that matter: joint events, want-to-go list, a shared task list. Do not build
   collaborative flourishes.
3. **`free_busy`.** Role and policies stay. The only UI is anonymous busy blocks inside the
   merged calendar view — which you need anyway. No dedicated screens.
4. **Same-person linking.** Two records, linked permanently via `people.same_as_person_id`.
   Never collapse to one. Never auto-merge on import.
5. **Travel Mode detection.** Manual entry plus calendar-derived (flight/train/hotel event)
   only. **No background location, no geofencing.** Do not request the permission.
6. **Desktop is the web app in a browser.** No Tauri, no Electron, no global hotkey.
7. **Email-in capture: not built.** Share sheet and in-app capture only.
8. **AI: off by default**, per-feature opt-in, with a settings page stating exactly which
   fields leave the device for each feature. Natural-language capture parsing is
   **local-only** — `chrono-node` for the date substring plus hand-written tokenising for
   `@context`, `!priority`, `#tag`, `@Person`, `[[note]]`. It must never call the network.
9. **iCloud/CalDAV: not built.** Google + `.ics` only.
10. **No post-event push prompt.** Today shows a quiet row — "3 events yesterday, no notes"
    — and that is the whole feature. No pgvector, no semantic search; leave
    `note_embeddings` empty.

Two more standing rules, from the brief and non-negotiable: **no streaks, no badges, no
gamification, no guilt**, and **no "who viewed what" tracking, ever**.

## Environment reality — handle this without asking

You are in an ephemeral container. Assume you have **no Supabase cloud project, no Google
OAuth credentials, and no API keys.** Do not block on any of them.

- Try `supabase start` (Docker is available). If the CLI is missing, install it; if it
  cannot run, fall back to a local Postgres 16 (`pg_ctlcluster 16 main start`) and apply
  the migrations directly. PostGIS and pgvector may be unavailable locally — if so, shim
  them exactly as `supabase/tests/README.md` describes and note it. The schema must apply
  cleanly somewhere before you build against it.
- Put **every external integration behind an interface** with two implementations: the
  real one, and a fixture-backed fake selected by env var. Google Calendar, ICS fetch,
  geocoding, travel time, push notifications, Anthropic. The app must run end to end,
  fully seeded and demoable, with zero credentials.
- Write a `pnpm seed` script that creates two users, a household space, and realistic
  Birmingham-flavoured data: ~40 people, ~200 events across categories, ~80 tasks across
  every smart list, ~30 notes with real links between them, ~15 places. The seed is how
  you and I both check the app actually works. Build it early, in Phase 0.
- If a dependency will not install after two honest attempts, choose a different library
  and record it in the decisions log. Do not stall.

## What to build, in this order

Work strictly in phase order from `docs/phase-plan.md`. **Each phase must be shippable
before you start the next.** Shippable means: it runs, the seed data exercises it, the
tests pass, and the branch is pushed.

Suggested budget — treat as guidance, not a deadline to hit by cutting corners:

- **~0:00–0:20** Scaffold: Expo + React Native Web + NativeWind + TypeScript, strict mode,
  Vitest, lint, and the app shell with bottom nav. Get `pnpm test` and `pnpm web` green.
- **~0:20–2:00** Phase 0, complete. This is the priority and it is not negotiable.
- **~2:00–3:00** Phase 1 (calendar), against the ICS fake and seeded events.
- **~3:00–3:40** Phase 2 (people) as far as it goes.
- **~3:40–4:00** Stop building. Write `docs/STATUS.md`, make sure everything is pushed.

**When you run out of time, ship a smaller thing that works rather than a bigger thing
that is half-wired.** A complete Phase 0 plus a note saying calendar is unstarted is a
good outcome. Four half-built phases is a bad one. Cut scope from the *end*, never quality
from the middle.

## Non-negotiables while you build

**The RLS tests are the point.** Get `supabase/tests/rls_isolation_test.sql` running
(install pgTAP; it has not been executed yet, so expect to fix the plan count and any
helper signatures). It must be green before Phase 0 is called done, and it must stay green.
Add a case to it whenever you add a table. A bug in the sync engine loses data; a bug here
is a privacy breach.

**Never let the client be the arbiter of visibility.** No filtering by space in application
code as the only defence. If a query returns rows the user shouldn't see, the fix is a
policy, not a `.filter()`.

**The space indicator is a hard requirement, not a nicety.** Personal vs Shared must be
legible at a glance on every list row and every compose surface — a consistent visual
treatment, not a small icon in a corner. Before any item moves between spaces, show the
confirmation backed by `app.space_move_preview()`, naming exactly what becomes visible.
Get this right before you build anything pretty.

**Calm and dense, not playful and sparse.** Neutral chrome; category colour is the only
strong colour on screen. Every category carries an icon and a label as well as a colour —
never colour alone. Full dark mode. UK conventions throughout: Europe/London with correct
DST, Monday week start, DD/MM/YYYY, 24h option, GBP, metric with miles for road distance.

**Tests where the bugs hide:** RLS policies, the sync engine, and the category rules
engine. Table-driven where possible. Don't chase coverage elsewhere.

## Working rhythm

- Commit after each vertical slice that runs — roughly every 20–30 minutes. Never leave the
  branch broken between commits. Push at least every hour.
- Branch: `claude/orbit-life-os-g18nsk`. Do not open a pull request.
- Keep `docs/decisions-log.md` current as you go: every judgement call, one line each. This
  is what I will read first.
- If you discover the design is wrong about something, fix it and write down what and why.
  The design is a starting point, not scripture — but say when you depart from it.

## Finish with `docs/STATUS.md`

Written last, honestly, covering:

- what actually works, verified by running it — not what you intended to build
- what is stubbed, faked, or wired to fixtures rather than a real service
- what is not started
- every known bug and rough edge, including ones you introduced and didn't get back to
- exactly what I need to do to run it: commands, env vars, what needs real credentials
- the three things you would do next, in order

Do not oversell it. I would rather read "Phase 0 done, calendar half-built and the week
view is broken" than discover it myself.
