# Deploying Orbit

Written session 9. **Nothing in this file has been run.** There is no Supabase
project, no hosting account and no credential in this repository, and none was
created — this is a set of commands somebody can follow, not a report of a
deployment. Where a step cannot be verified from here, it says so.

Orbit needs two things: a Postgres database with its migrations applied, and a
long-lived Node process. This describes Supabase for the first and Fly.io or
Railway for the second, because those are what §3 of
`docs/deployment-and-android.md` picked and why.

---

## 0. What you are signing up for

- **A container, not a serverless function.** Every page is `force-dynamic` and
  `src/lib/db/index.ts` holds a connection pool. Vercel's serverless runtime
  would create and discard a pool per invocation.
- **`AUTH_PROVIDER=supabase` is written, never run.** It is a real
  implementation of the GoTrue REST API and no line of it has ever sent a
  request. The first sign-in on a real project is the first time any of it
  executes, and it is where surprises will be.
- **Seeded data is development data.** A real deployment starts empty: sign up,
  create a space, invite somebody. Do not run `pnpm seed` against a real
  project — the trigger in migration 0012 will refuse an account whose email
  collides with a seeded profile, which is the correct behaviour and an
  unwelcome surprise.

---

## 1. The database

Create a project at supabase.com, then, from a clone of this repository:

```sh
# The connection string from Settings → Database → Connection string → URI.
# Session mode, port 5432, as the `postgres` user: migrations create roles and
# a trigger on auth.users, which the pooled app role cannot do.
export ADMIN_URL='postgresql://postgres:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres'

# Extensions. pgcrypto, postgis and vector are what 0000 expects; pgtap only if
# you want to run ./scripts/db-test.sh against the real project too.
psql "$ADMIN_URL" -c 'create extension if not exists pgcrypto'
psql "$ADMIN_URL" -c 'create extension if not exists postgis'
psql "$ADMIN_URL" -c 'create extension if not exists vector'
psql "$ADMIN_URL" -c 'create extension if not exists pgtap'   # optional

# The migrations, in order. Filename order is the order — they are numbered.
for f in supabase/migrations/*.sql; do
  echo "▸ $f"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

**Migration order, and what each one is for:**

| | |
|---|---|
| `0000_bootstrap.sql` | extensions, the `auth` shim, roles, and the two schemas Orbit owns — **`orbit` for every table** and `app` for the policy helpers. Mostly a no-op on Supabase — see gotcha 2. |
| `0001_identity.sql` | profiles, spaces, `space_members`, `space_invites`, categories, devices |
| `0002` – `0007` | tasks and notes, people, calendar, places and travel, automation, platform tables |
| `0008_identity_lookup.sql` | the two narrow identity functions the dev provider uses |
| `0009_entity_space.sql` | `app.entity_space()`, SECURITY INVOKER on purpose |
| `0010_recurrence_exdates.sql` | `recurrence_rules.exdates` |
| `0011_travel_leg_identity.sql` | the partial unique index on a derived journey |
| `0012_auth_user_profiles.sql` | **the one this all turns on**: the `auth.users` → `orbit.profiles` trigger, and `app.space_invite()` |

### The three gotchas

These are from §2 of `docs/deployment-and-android.md`. All three are things to
check rather than assume, and the first is the one that fails silently.

**1. `profiles.id` must equal `auth.uid()`.** `orbit.profiles.id` defaults to
`gen_random_uuid()` and has no foreign key to `auth.users`. Every policy in the
database keys off `auth.uid()`, which is the JWT's `sub` — that is,
`auth.users.id`. If they ever differ, **every policy returns zero rows and says
nothing about why**: the app looks empty rather than broken. Migration 0012's
trigger is what makes them equal. Verify it before you sign up:

```sh
psql "$ADMIN_URL" -c "\
  select tgname from pg_trigger \
  where tgrelid = 'auth.users'::regclass and not tgisinternal"
# expect: on_auth_user_created
```

Then sign up once and check the pair:

```sh
psql "$ADMIN_URL" -c "\
  select u.id = p.id as ids_match, u.email, p.display_name \
  from auth.users u join orbit.profiles p on p.id = u.id"
```

If `ids_match` is not `t` for your account, stop: nothing else will work, and
it will not tell you.

**2. `0000_bootstrap.sql` does `create or replace function auth.uid()`,
unguarded.** On Supabase that function belongs to `supabase_auth_admin` and the
replace will probably fail on permissions. **That is fine and the fix is to skip
it, not to force it** — the shim reads exactly the same GUCs as Supabase's own
`auth.uid()`, so Supabase's version is already correct. If 0000 stops there:

```sh
# Apply everything else, then come back to the rest of 0000 by hand if needed.
# Nothing after this line in 0000 depends on replacing auth.uid().
psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -f supabase/migrations/0000_bootstrap.sql
```

Read the errors rather than suppressing them: `create schema if not exists auth`,
`create role`, and `create extension` are all expected to be no-ops there. Only
the `auth.uid()`/`auth.role()` replacements may legitimately fail.

**3. `orbit_app` must exist, be able to log in, own nothing, and hold no
BYPASSRLS.** The whole security model is that the application connects as a role
the policies apply to in full — `./scripts/db-test.sh` asserts exactly that
locally, and it is worthless if the deployed role is different.

```sh
psql "$ADMIN_URL" <<'SQL'
create role orbit_app login password 'PUT A REAL PASSWORD HERE' noinherit;
grant connect on database postgres to orbit_app;
grant usage on schema orbit, app, auth to orbit_app;
grant authenticated, anon to orbit_app;

-- The identity seam: two narrow functions, no table grants at all.
grant execute on function app.identity_profile(uuid) to orbit_app;
grant execute on function app.identity_profiles() to orbit_app;
SQL
```

Then confirm what it is *not*:

```sh
psql "$ADMIN_URL" -c "\
  select rolname, rolbypassrls, rolsuper from pg_roles where rolname = 'orbit_app'"
# expect: orbit_app | f | f

psql "$ADMIN_URL" -c "\
  select count(*) from pg_tables where schemaname = 'orbit' and tableowner = 'orbit_app'"
# expect: 0
```

If `orbit_app` owns a table, RLS does not apply to it for that table and the
premise of every assertion in `supabase/tests/` is gone.

### A fourth gotcha, and it is ours: PostgREST only exposes `public`

The three above come from §2 of `docs/deployment-and-android.md`. This one is a
consequence of Orbit's tables living in the **`orbit`** schema rather than
`public`, and it does not affect the web app at all — that connects with
`postgres.js` as `orbit_app` and names `orbit.tasks` in the SQL, so it neither
knows nor cares what PostgREST is configured with.

It affects **anything talking to the Supabase REST API**, which is the whole of
the Android client in Brief B.

- **Supabase dashboard → Settings → API → Exposed schemas**: add `orbit`. The
  default is `public, graphql_public`, and a table PostgREST cannot see returns
  `PGRST106` — *the schema must be added to 'db-schemas'* — rather than an empty
  list, so at least it fails loudly.
- Every client then has to ask for it: `supabase.schema('orbit').from('tasks')`
  in supabase-js, or the equivalent `Postgrest.from(schema = "orbit")` in
  supabase-kt. Setting it once at client construction is better than per call.
- **`auth` is untouched by this.** GoTrue is its own API on its own path, so
  sign-in, sign-up and the magic link work with `orbit` exposed or not.

RLS is what protects those tables either way — exposing a schema does not grant
anything, it only tells PostgREST the schema exists.

### The pooler note

Supabase gives you two ports:

- **5432, session mode** — a real connection. Prepared statements work. This is
  the simplest correct choice, and it is what `DATABASE_URL` should be unless
  you have a reason.
- **6543, transaction mode** — a pooled connection where every statement may
  land on a different backend, so a prepared statement is never there when it is
  used again and `asUser()` fails with *prepared statement does not exist*.

If you must use 6543, set **`DATABASE_PREPARE=false`**, which turns
`prepare: false` on in `src/lib/db/index.ts`. It is an environment variable
rather than a code edit because "remember to change this line before deploying"
is an instruction somebody eventually does not follow.

### Optionally, run the pgTAP suite against the real project

```sh
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
```

It runs in a transaction and rolls back, so it leaves nothing behind. Three of
its 106 assertions are about the local `auth.users` shim and the trigger; those
are the ones worth watching on a real project, because they are the ones this
container could only test against a shim.

---

## 2. Supabase Auth settings

All of this is console work. **None of it can be done or verified from a
session** — it is why there are no OAuth providers in the sign-in page.

1. **Authentication → Providers → Email**: on. Decide whether *Confirm email* is
   on. If it is, sign-up returns no session and the sign-up screen says so; if it
   is not, the account is usable immediately.
2. **Authentication → URL Configuration**: set *Site URL* to your app's public
   origin, and add `https://YOUR-APP/auth/callback` to *Redirect URLs*. A magic
   link with an unlisted redirect target is refused by Supabase, and the callback
   screen will show you the sentence it refused with.
3. **Email templates** (optional): the default *Magic Link* template sends people
   to `…/auth/callback#access_token=…`, which `src/app/auth/CompleteSignIn.tsx`
   reads in the browser because a URL fragment never reaches a server. If you
   would rather it worked with JavaScript disabled, change the template to use
   `{{ .TokenHash }}`:

   ```
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a>
   ```

   Both shapes are handled. Neither has been observed working, because there is
   no project here to observe.
4. **Do not** create a service-role key for this app. There is nowhere to put
   one: `src/lib/db/index.ts` has a single pool as `orbit_app`, and adding a
   privileged client would be a second, unpoliced way into the data.

---

## 3. The server

### Build it

```sh
docker build -t orbit .
docker run --rm -p 3000:3000 --env-file .env.production orbit
```

`.env.production` needs, at a minimum:

```sh
DATABASE_URL=postgres://orbit_app:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres
AUTH_PROVIDER=supabase
SUPABASE_URL=https://YOUR-REF.supabase.co
SUPABASE_ANON_KEY=eyJ…
APP_URL=https://orbit.example.com
NODE_ENV=production
```

`SEED_DATABASE_URL` is deliberately absent: it names a BYPASSRLS role and has no
business in a running deployment.

### Fly.io

```sh
fly launch --no-deploy --name orbit-yourname   # writes fly.toml; keep the Dockerfile
fly secrets set \
  DATABASE_URL='postgres://orbit_app:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres' \
  AUTH_PROVIDER=supabase \
  SUPABASE_URL='https://YOUR-REF.supabase.co' \
  SUPABASE_ANON_KEY='eyJ…' \
  APP_URL='https://orbit-yourname.fly.dev'
fly deploy
```

In `fly.toml`, set `internal_port = 3000` and **`auto_stop_machines = false`**:
a machine that stops between requests is a serverless function wearing a
container's clothes, and it throws the connection pool away every time.

### Railway

```sh
railway init
railway up                  # builds the Dockerfile
railway variables set AUTH_PROVIDER=supabase SUPABASE_URL=… SUPABASE_ANON_KEY=… \
  DATABASE_URL=… APP_URL=…
railway domain              # gives you the URL for APP_URL and the redirect list
```

Railway sets `PORT`; the Dockerfile already reads it.

### After the first deploy

1. Open `/auth/signup` and create an account.
2. Check `ids_match` (gotcha 1 above). This is the one moment worth stopping for.
3. Create a space, then open **Spaces → People and invites** and make an
   invitation. Send yourself the link from a different browser and accept it.
   That is the end-to-end proof: an account that did not exist joining a space
   through a policy that could not otherwise have let it.

---

## 4. What is still not deployable-and-forget

Honest list, none of it new:

- **There is no scheduler.** A `schedule` rule runs when somebody presses "Run
  now, for real". A container does not change that; a worker would, and adding
  one is a separate decision.
- **There is no service worker.** "Work offline" is a switch somebody flicks.
- **`switchUser` still exists** and is still impersonation — it is unreachable
  under `AUTH_PROVIDER=supabase` (the sidebar renders an account panel instead
  and the action refuses), but if you deploy with `AUTH_PROVIDER=dev` you have
  published a build where anybody can become anybody. Do not.
- **The session cookies are `secure` only when `NODE_ENV=production`.** The
  Dockerfile sets it; a hand-rolled deployment that does not is one where the
  access token can travel over plain HTTP.
