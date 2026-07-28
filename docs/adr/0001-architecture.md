# ADR 0001 — Orbit Architecture

Status: accepted (session 1)
Date: 2026-07-27

## Context

Orbit is a personal "life OS": tasks, notes, people, calendar, places, and a rules
engine, built for one power user and one occasional participant (the "partner"),
inside shared **spaces**. It must run end to end with **zero credentials** — no
Supabase cloud project, no OAuth client, no API keys — and still be demoable.

## Decision

### 1. Postgres is the application, the app is a thin shell

All authorisation lives in the database as Row Level Security. The client is never
the arbiter of visibility. If a query returns a row the user should not see, the
bug is a policy, not a missing `.filter()`.

Every request opens a connection, sets `role authenticated` and
`request.jwt.claims`, and runs inside a transaction. The app has **no** service-role
path in the request cycle — only migrations, seeds, and tests use the superuser
connection.

### 2. Supabase-compatible, Supabase-independent

The schema is written to be Supabase-compatible: an `auth` schema with
`auth.uid()`, roles `anon` / `authenticated` / `service_role`, RLS policies written
against `auth.uid()`. Locally this is provided by `supabase/migrations/0000_bootstrap.sql`,
which creates those objects on a plain Postgres 16. This means:

- local dev needs only `postgres` + `postgis` + `pgtap` — no Docker, no Supabase CLI
- the same migrations apply unchanged to a real Supabase project later

We do **not** depend on PostgREST, Supabase Auth, Supabase Storage, or Realtime.
Data access is `postgres.js` from server-side TypeScript.

### 3. One Next.js app, server-first

Single Next.js App Router application at the repo root (not a monorepo — a monorepo
is friction we would pay for every session and benefit from in none). React Server
Components read Postgres directly through the RLS-scoped connection. Client
components exist only where interaction demands it.

### 4. Every external integration is an interface with a fake

Google Calendar, ICS import, geocoding, travel time, push, and Anthropic each sit
behind a TypeScript interface with two implementations: a real one and a
fixture-backed fake. Selection is by env var, defaulting to **fake**. The app must
never require a credential to boot. See `src/lib/integrations/`.

### 5. Spaces are the unit of sharing

Every domain table carries `space_id` and `owner_id`. Membership in a space is the
primary grant; item-level `shares` narrow or widen within a space. The **space
indicator** — a legible chip carrying colour, icon, and label — appears on every
row and every compose surface. Moving an item between spaces goes through
`app.space_move_preview()`, which reports exactly who gains and loses access, and
the confirmation shows that before the move happens.

### 6. Encryption

`is_locked` items are end-to-end encrypted: the server stores an opaque ciphertext
envelope in `encrypted_blobs` and never the plaintext. Locked items are excluded
from server-side search and from every AI path — enforced in the database by
partial indexes and by `WHERE NOT is_locked` in the search view, not by client
code. Everything else is encrypted at rest by the storage layer only.

### 7. AI is off by default

Per-feature opt-in, recorded in `ai_feature_consents`. Settings state plainly what
leaves the device. Natural-language capture parsing is **local-only** and must
never touch the network; it lives in `src/lib/capture/` with no network import
allowed (enforced by a lint rule, see Known gaps).

## Consequences

- Testing concentrates on RLS, sync, and the rules engine — that is where the bugs
  are. `supabase/tests/rls_isolation_test.sql` is pgTAP and must stay green.
- Because the app never holds a service-role key at request time, a policy mistake
  fails closed (no rows) rather than open.
- Choosing plain Postgres over the Supabase CLI means we do not test Supabase Auth
  behaviour locally. Accepted: `auth.uid()` is the only surface we consume.

## Rejected alternatives

- **Supabase CLI + Docker locally.** Needs a working Docker daemon and image pulls;
  the container may not have either. Rejected for reliability.
- **Prisma / Drizzle.** An ORM that generates its own client encourages
  application-side filtering, which is precisely the failure mode RLS exists to
  prevent. We use SQL.
- **pgvector-backed semantic search.** Explicitly out of scope (decision 10). The
  extension is installed because the bootstrap script installs it, but nothing in
  the schema uses it.
