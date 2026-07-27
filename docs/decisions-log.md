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
- **Money is `numeric(12,2)` and dates are `date`/`timestamptz`, never text.**
  UK conventions (DD/MM/YYYY, 24h, £, Monday-first weeks) are a *formatting*
  concern and live in `src/lib/format.ts` only.
