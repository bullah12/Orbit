# Runbook — from applied migrations to a working deployment

The steps a person has to do, in order, with what to check after each one and
what going wrong looks like. `docs/deploy.md` is the reference; this is the
sequence.

**Nothing in this file has been run from this repository.** There is no
Supabase project, no hosting account and no network here. Where a step cannot
be verified from a session, it says so.

Two conventions throughout:

**Before anything else, prove you are pointed at the right database and that
Orbit's schema is not already there.** This is the check that would have saved
an hour: `$ADMIN_URL` pointing at another project looks exactly like a fresh one
until a migration fails on a table you did not create.

```sh
psql "$ADMIN_URL" -c "select current_database(), current_user"
psql "$ADMIN_URL" -c "\
  select coalesce(string_agg(nspname, ', ' order by nspname), '(none)') as orbit_schemas \
  from pg_namespace where nspname in ('orbit','app')"
```

`(none)` means a clean start. If it lists `orbit`, the migrations have already
run here — do not run them again; `0001`–`0007` use plain `create table` and are
not re-runnable. Tables in `public` belonging to some other application are
fine and expected: Orbit keeps to its own schema.

```sh
# The admin connection: Settings → Database → Connection string → URI.
# Session mode, port 5432, as `postgres`. Migrations create roles and a trigger
# on auth.users, which a pooled app role cannot do.
export ADMIN_URL='postgresql://postgres:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres'
```

Every `psql` below uses `-v ON_ERROR_STOP=1` so a failure stops rather than
scrolling past.

---

## 0. Build the schema, from this repository's migrations

Orbit's tables live in **`orbit`**, its helper functions and RLS generator in
**`app`**, and nothing of Orbit's goes in `public`. That is what lets it share a
Postgres instance with another application — `profiles` alone exists in both.

If an earlier attempt already created an `orbit` schema by transforming the
migration files by hand, **rebuild rather than patch**. The repository is now
the source of that naming, and a schema built from an ad-hoc transformation can
differ in ways that do not show up until a policy misbehaves — a `search_path`
left at `public`, or `app.apply_standard_rls` still generating policies against
the wrong schema. There is no data yet, so this costs nothing:

```sh
psql "$ADMIN_URL" -c "drop schema if exists orbit cascade"
psql "$ADMIN_URL" -c "drop schema if exists app cascade"
```

Extensions first. `pgtap` only if you want to run the suite here too:

```sh
psql "$ADMIN_URL" -c 'create extension if not exists pgcrypto'
psql "$ADMIN_URL" -c 'create extension if not exists postgis'
psql "$ADMIN_URL" -c 'create extension if not exists vector'
psql "$ADMIN_URL" -c 'create extension if not exists pgtap'   # optional
```

**`0000` runs on its own and is expected to fail partway.** Its
`create or replace function auth.uid()` belongs to `supabase_auth_admin` on
Supabase and will be refused — which is fine, because Supabase's own version
reads exactly the same GUCs. Under `ON_ERROR_STOP=1` that refusal aborts the
file *before* it creates the schemas, and every later migration then fails with
`schema "orbit" does not exist`:

```sh
psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -f supabase/migrations/0000_bootstrap.sql
```

Expected failures, all harmless: `auth.uid()` / `auth.role()` (permission),
`create role anon|authenticated|service_role` (already exist), `create schema
auth` (already exists). **Anything else is real** — read it rather than pressing
on.

```sh
psql "$ADMIN_URL" -c "\
  select nspname from pg_namespace where nspname in ('orbit','app') order by 1"
# expect two rows: app, orbit
```

Then the rest, in order. `0001`–`0007` use plain `create table` and are **not
re-runnable**, so this stops at the first real error rather than continuing into
a half-built schema:

```sh
for f in supabase/migrations/000[1-9]_*.sql supabase/migrations/001[0-9]_*.sql; do
  echo "▸ $(basename "$f")"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "STOPPED at $f"; break; }
done
```

**Check it landed:**

```sh
# 41 tables, every one with RLS enabled. The second number is the one that
# matters — a table without RLS is a table anybody can read.
psql "$ADMIN_URL" -c "\
  select count(*) as tables, count(*) filter (where c.relrowsecurity) as with_rls \
  from pg_tables t join pg_class c on c.relname = t.tablename \
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname \
  where t.schemaname = 'orbit'"
# expect: 41 | 41

# Migration 0013's two functions. Neither may be executable by PUBLIC: they
# return times the caller cannot otherwise select, so who may call them is the
# whole control.
psql "$ADMIN_URL" -c "\
  select p.proname, p.prosecdef as security_definer, \
         has_function_privilege('public', p.oid, 'execute') as public_can_execute \
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace \
  where n.nspname = 'app' and p.proname like 'free_busy%' order by 1"
# expect: two rows, t, f
```

**Optionally run the pgTAP suite against the real project.** It runs in a
transaction and rolls back, so it leaves nothing behind:

```sh
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
```

Expect `112/112`. Three of those assertions are about the `auth.users` shim and
the trigger — the ones worth watching here, because a container with no Supabase
could only ever test them against a shim.

---

## 1. Create the `orbit_app` role

The entire security model is that the application connects as a role the
policies apply to **in full**. `./scripts/db-test.sh` asserts that locally, and
every one of those assertions is worthless if the deployed role is different.

Generate a real password first — do not type one:

```sh
openssl rand -base64 32
```

```sh
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
create role orbit_app login password 'PASTE THE GENERATED PASSWORD' noinherit;

grant connect on database postgres to orbit_app;
grant usage on schema orbit, app, auth to orbit_app;
grant authenticated, anon to orbit_app;

-- The identity seam: two narrow functions, and no table grants at all.
grant execute on function app.identity_profile(uuid) to orbit_app;
grant execute on function app.identity_profiles() to orbit_app;
SQL
```

**Check what it is not.** These four are the assertions, not the creation:

```sh
# 1. Not a superuser, and no BYPASSRLS. Either one makes every policy advisory.
psql "$ADMIN_URL" -c "\
  select rolname, rolsuper, rolbypassrls, rolcanlogin \
  from pg_roles where rolname = 'orbit_app'"
# expect: orbit_app | f | f | t

# 2. Owns nothing. A table's owner is exempt from its own RLS by default.
psql "$ADMIN_URL" -c "\
  select count(*) from pg_tables \
  where schemaname in ('orbit','app') and tableowner = 'orbit_app'"
# expect: 0

# 3. It holds no table privileges of its own. `orbit_app` is created
#    `noinherit`, so being a member of `authenticated` grants it nothing until
#    it says SET ROLE — which is exactly what asUser() does, scoped to a
#    transaction so a pooled connection cannot carry one request's identity
#    into the next.
#
#    "ERROR: permission denied for table tasks" is the CORRECT answer.
psql "$APP_URL" -c "select count(*) from orbit.tasks"

# 4. And with the role it actually uses, RLS still declines: there is no JWT
#    on this connection, so auth.uid() is null and every policy returns
#    nothing. This is the half that proves the policies are switched on.
psql "$APP_URL" -c "set role authenticated; select count(*) from orbit.tasks"
# expect: 0
```

where `$APP_URL` is `orbit_app`'s own connection string — the tenant-qualified
role on the pooler, not the `postgres` one:

```sh
export APP_URL='postgresql://orbit_app.YOUR-REF:ORBIT-APP-PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres'
```

> **If check 3 succeeds instead of erroring**, `orbit_app` was created without
> `noinherit` and is using privileges directly. Not fatal — the policies still
> apply to `authenticated` — but it is a wider surface than the design intends.
> `alter role orbit_app noinherit;` puts it back.
>
> **If check 3 says "permission denied for schema orbit"**, the `grant usage`
> did not take — re-run step 1.
>
> **If check 4 returns a non-zero count, stop.** The role is reading rows with
> no session behind it, which means RLS is not applying and nothing below is
> safe.

---

## 2. Verify the `auth.users` → `profiles` trigger

This is the one that fails **silently**. `orbit.profiles.id` defaults to
`gen_random_uuid()` and has no foreign key to `auth.users`; every policy keys
off `auth.uid()`, which is `auth.users.id`. If the two ever differ, every policy
returns zero rows and says nothing — **the app looks empty rather than broken**,
and you will spend the evening in the wrong layer.

```sh
psql "$ADMIN_URL" -c "\
  select tgname from pg_trigger \
  where tgrelid = 'auth.users'::regclass and not tgisinternal"
# expect: on_auth_user_created
```

> **If it is missing**, migration `0012_auth_user_profiles.sql` did not fully
> apply. Re-run just that file and read the errors rather than suppressing them.

You cannot finish this check until somebody has signed up — that is step 5.

---

## 3. Supabase Auth settings

All console work, none of it verifiable from a session.

1. **Authentication → Providers → Email**: on. Decide whether *Confirm email*
   is on. If it is, sign-up returns no session and Orbit's sign-up screen says
   so; if it is not, the account is usable immediately. Either is handled.
2. **Authentication → URL Configuration**:
   - *Site URL* → your app's public origin, e.g. `https://orbit-yourname.fly.dev`
   - *Redirect URLs* → add `https://orbit-yourname.fly.dev/auth/callback`
   A magic link with an unlisted redirect target is refused by Supabase, and
   Orbit's callback screen shows you the sentence it refused with.
3. **Do not create a service-role key for this app.** There is nowhere to put
   one: `src/lib/db/index.ts` has a single pool as `orbit_app`, and adding a
   privileged client would be a second, unpoliced way into the data.

You will not know the URL until step 4 — so either deploy first and come back,
or use `fly domain` / `railway domain` to reserve the hostname before deploying.

---

## 4. Deploy
**Vercel is the recommended host**, which reverses what `docs/deploy.md` said
for three sessions. The reasoning there was the connection pool: a pool is an
asset in a process that outlives the request and a liability in one that does
not. That holds only while the app pools for itself. Against Supabase's
**transaction pooler**, with `DATABASE_POOL_MAX=1`, the pooling happens in
Supavisor and serverless is a good fit — a better one for an app somebody opens
a few times a day and would rather not pay to keep warm.

Fly and Railway both still work and are described afterwards. Pick one.

### Vercel

Nothing to build locally: Vercel builds from the repository.

```sh
npx vercel link          # or import the repo at vercel.com/new
```

Then set the environment variables, for **Production** (repeat for Preview if
you want preview deployments to work at all — they will refuse to start
otherwise, which is the dev-auth guard doing its job):

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `postgresql://orbit_app.YOUR-REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres` | **Port 6543**, the transaction pooler. Note the role is `orbit_app.YOUR-REF` — the pooler wants the tenant-qualified name. |
| `DATABASE_PREPARE` | `false` | The transaction pooler hands a different backend to every statement, so a prepared statement is never there when it is used again. Without this, every query fails with *prepared statement does not exist*. |
| `DATABASE_POOL_MAX` | `1` | One process per concurrent request, each with its own pool. Leave it at 10 and a quiet app exhausts the database during its first busy minute. |
| `AUTH_PROVIDER` | `supabase` | Without it the build refuses to serve, because `dev` is the default and the default is impersonation. |
| `SUPABASE_URL` | `https://YOUR-REF.supabase.co` | |
| `SUPABASE_ANON_KEY` | `eyJ…` | Public by design; RLS is what protects the data. |
| `APP_URL` | `https://your-app.vercel.app` | Must match Supabase's Site URL and be in its Redirect URLs. |

```sh
npx vercel --prod
```

**Do not set `ORBIT_ALLOW_DEV_AUTH`.** It is the switch that lets the
impersonation provider run on a production build.

`next.config.ts` drops `output: 'standalone'` when `VERCEL` is set — that
directory is for the Docker image and Vercel builds its own.

**What you get, and what you give up:**

- **It sleeps, and that is the point.** You pay per request, there is no idle
  bill, and the first load after a quiet spell waits for a cold start. For an
  app you open a few times a day and refresh by hand, that is the right trade.
- **A polling tab would defeat it.** Anything that refreshes on an interval
  keeps invoking the function, so you would pay for the traffic and gain
  nothing. Manual refresh — the browser's own reload — already returns current
  data, because every page is `force-dynamic` and sends `no-store`.
- **`/health` still answers** but nothing uses it: there is no machine to take
  out of rotation. It is still the quickest way to test `DATABASE_URL`.
- **Vercel Cron could eventually run `schedule` rules** (edge 16), which on a
  container needs a separate worker. Not built, but the door is open.

### Fly.io — if you would rather have the config in the repo

`fly.toml` is committed with `internal_port`, a `/health` check and
`auto_stop_machines` already set, and comments saying why each one matters.

```sh
# --copy-config keeps the committed file. Without it, `fly launch` writes its
# own defaults: auto_stop_machines = true and internal_port = 8080, both wrong
# here and both failing quietly.
fly launch --no-deploy --copy-config --name orbit-yourname

fly secrets set \
  DATABASE_URL='postgresql://orbit_app:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres' \
  AUTH_PROVIDER=supabase \
  SUPABASE_URL='https://YOUR-REF.supabase.co' \
  SUPABASE_ANON_KEY='eyJ…' \
  APP_URL='https://orbit-yourname.fly.dev'

fly deploy
```

Session mode (5432) here, so no `DATABASE_PREPARE` and no `DATABASE_POOL_MAX` —
one long-lived process is what the default pool of 10 is for.

**`auto_stop_machines` is a cost decision, not a correctness one.** Nothing in
Orbit breaks when the machine stops: there are no background jobs and no
scheduler. Sleeping costs a second or two on the first request after idle and
saves the idle hours. `fly.toml` currently keeps the machine running; flip
`auto_stop_machines = true` and `min_machines_running = 0` if you would rather
pay less and wait a moment.

### Railway — if you want the shortest path

```sh
railway init
railway up
railway variables set \
  AUTH_PROVIDER=supabase \
  SUPABASE_URL='https://YOUR-REF.supabase.co' \
  SUPABASE_ANON_KEY='eyJ…' \
  DATABASE_URL='postgresql://orbit_app:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres' \
  APP_URL='https://YOUR-APP.up.railway.app'
railway domain
```

Health check path `/health`. Railway sets `PORT`; the Dockerfile reads it.

### Checking the image locally, on any of them

Optional, and worth five minutes for Fly or Railway because it catches the two
most common mistakes on your own machine rather than in a deploy log. Skip it
for Vercel, which does not use the Dockerfile.

```sh
docker build -t orbit .

# Deliberately WITHOUT AUTH_PROVIDER, to watch the guard work.
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://orbit_app:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres' \
  orbit
```

Expect **"Orbit will not start like this"** on every page. That is correct:
`dev` is the default provider, it is impersonation by design, and the app
refuses to serve it on a production build. Add the real variables and it
starts.

```sh
curl -s localhost:3000/health    # expect {"status":"ok"}
```

`{"status":"unavailable"}` and a 503 means the container cannot reach the
database. Fix it here; it will not fix itself in a datacentre.

> `permission denied … docker.sock` means your user is not in the `docker`
> group: `sudo usermod -aG docker $USER && newgrp docker`. On Docker Desktop for
> Windows it is Settings → Resources → WSL Integration instead.

---

## 5. The first run, in this order

The order matters: each check makes the next one meaningful.

**1. `/health` before anything else.**

```sh
curl -s https://orbit-yourname.fly.dev/health
# expect {"status":"ok"}
```

Cheapest question, most expensive wrong answer. A 503 means `DATABASE_URL` is
wrong and nothing below will work.

**2. Confirm the deployed build is not the dev build.**

Open the app. If you see *"Orbit will not start like this"*, `AUTH_PROVIDER` did
not reach the container — check `fly secrets list`. If you see a sidebar with a
**"Viewing as"** switcher listing several people, **stop and take it down**:
that is the dev provider on a public URL and anybody can become anybody. It
should not be possible to get here, but look.

**3. Sign up once, at `/auth/signup`.**

**4. Then the check that matters more than any other:**

```sh
psql "$ADMIN_URL" -c "\
  select u.id = p.id as ids_match, u.email, p.display_name \
  from auth.users u join public.profiles p on p.id = u.id"
```

> **If this returns no rows**, the trigger did not fire — there is an
> `auth.users` row and no `profiles` row. Back to step 2.
>
> **If `ids_match` is not `t`, stop.** Every policy will return zero rows and
> tell you nothing. The app will look like an empty account rather than a broken
> one, and you will debug the wrong layer for hours. Fix the trigger, delete the
> account, sign up again.

**5. Sign out, sign in, and use a magic link.** The magic-link path is where a
mis-set *Redirect URL* shows up, and Orbit's callback screen prints the sentence
Supabase refused with rather than a code.

**6. Let a session expire so the refresh path runs.** This is the specific line
`docs/STATUS.md` has flagged for three sessions as most likely to be wrong. The
provider is a complete implementation of GoTrue's REST API and **not one line of
it has ever executed**. Either wait out the access-token lifetime (Authentication
→ Sessions) or shorten it temporarily. If you do not watch this, you have not
tested authentication — you have tested signing in.

**7. Create a space, invite a second account.** Spaces → People and invites.
Send the link to a different browser, accept it. That is the end-to-end proof: an
account that did not exist joining a space through a policy that could not
otherwise have let it in. Try each role, including `free_busy`, and check that a
`free_busy` member sees **anonymous busy blocks and no titles** on the calendar —
including for repeating events, which is what migration 0013 fixed.

**8. Do not run `pnpm seed` against the real project.** Seeded data is
development data, and the trigger in `0012` will refuse an account whose email
collides with a seeded profile — correct behaviour, unwelcome surprise.

---

## What is still not deployable-and-forget

Honest list, none of it new:

- **There is no scheduler.** A `schedule` rule runs when somebody presses "Run
  now, for real". A container does not change that; a worker would, and that is
  a separate decision.
- **Locked items have no client-side crypto.** They are modelled end to end and
  nothing encrypts anything.
- **Six other providers are still "written, never run"** — Google calendar, ICS
  over HTTP, Nominatim, OpenRouteService, Web Push and Anthropic. Turning one on
  is its own first run, with its own surprises.
- **The service worker registers only on a secure origin.** Over plain HTTP it
  is a silent no-op, which is fine — Orbit behaves as it did before it existed.

---

## After the first real run

`docs/remaining-work.md` §5 is **Brief D**, written for the session that follows
this one. It is the acceptance pass: it turns "written, never run" into either
"works" or a numbered list of what broke, and it is written to be handed to an
agent with the deployed URL filled in.

Its one rule is worth repeating here: *the thing that would make that session a
failure is coming back with "authentication works" without having watched the
refresh path run.*
