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

**Orbit installs into one schema, `orbit`, and can share a project with other
work.** Every table, every enum and every policy helper is in it. Orbit creates
nothing in `public` and nothing named `app`. There is exactly one exception,
and it is unavoidable: migration 0012 puts a trigger on `auth.users`, because
that table belongs to Supabase and the profile row has to be created when an
account is.

That means the project does **not** have to be an empty one. What Orbit needs
from a shared project is the schema name `orbit` being free, and permission to
add a trigger to `auth.users`.

Create or open a project at supabase.com, then, from a clone of this repository:

**If you are on WSL, use the session pooler, not the direct connection.**
`db.<ref>.supabase.co` has an AAAA record and no A record, and WSL2's default
networking has no IPv6 route, so the direct host is simply unreachable —
`Network is unreachable`, which reads like a firewall and is not one. Dashboard
→ **Connect** → *Session pooler* gives you an IPv4 host; the username becomes
`postgres.YOUR-REF`. See `docs/windows.md`.

**`$ADMIN_URL` does not survive a new terminal, and psql does not complain when
it is missing** — an empty connection string falls back to a *local* database.
If psql ever mentions `/var/run/postgresql/.s.PGSQL.5432`, it never reached
Supabase. On a machine with a local Postgres that is worse than an error,
because the migrations would apply somewhere nobody meant them to and report
success. Keep it in a file outside the repository (it holds a password) and
guard anything that writes:

```sh
umask 077 && cat > ~/.orbit-admin.env <<'EOF'
export ADMIN_URL='postgresql://…'
EOF
source ~/.orbit-admin.env
: "${ADMIN_URL:?ADMIN_URL is not set — refusing to touch a local database}"
```

```sh
# The connection string from Settings → Database → Connection string → URI.
# Session mode, port 5432, as the `postgres` user: migrations create roles and
# a trigger on auth.users, which the pooled app role cannot do.
export ADMIN_URL='postgresql://postgres:PASSWORD@db.YOUR-REF.supabase.co:5432/postgres'

# Check the name is free before writing anything. If this returns a row, stop:
# 0000 would add Orbit's 41 tables to a schema somebody else is using.
psql "$ADMIN_URL" -c "select nspname from pg_namespace where nspname = 'orbit'"
# expect: 0 rows

# Extensions. pgcrypto, postgis and vector are what 0000 expects, and it
# installs any that are missing into `extensions` — Supabase's own schema for
# them — so you do not have to do this by hand. On a project that already has
# them, which is most, 0000 leaves them exactly where they are.
psql "$ADMIN_URL" -c 'create extension if not exists pgtap'   # optional, for db-test.sh

# The migrations, in order. Filename order is the order — they are numbered.
for f in supabase/migrations/*.sql; do
  echo "▸ $f"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done

# What landed where. The second number is the one that matters on a shared
# project: Orbit adds nothing to public.
psql "$ADMIN_URL" -c "\
  select schemaname, count(*) from pg_tables \
  where schemaname in ('orbit','public') group by 1"
```

**Migration order, and what each one is for:**

| | |
|---|---|
| `0000_bootstrap.sql` | **the `orbit` schema**, extensions, the `auth` shim, roles, the enums and every policy helper. Mostly a no-op on Supabase — see gotcha 2. |
| `0001_identity.sql` | profiles, spaces, `space_members`, `space_invites`, categories, devices |
| `0002` – `0007` | tasks and notes, people, calendar, places and travel, automation, platform tables |
| `0008_identity_lookup.sql` | the two narrow identity functions the dev provider uses |
| `0009_entity_space.sql` | `orbit.entity_space()`, SECURITY INVOKER on purpose |
| `0010_recurrence_exdates.sql` | `recurrence_rules.exdates` |
| `0011_travel_leg_identity.sql` | the partial unique index on a derived journey |
| `0012_auth_user_profiles.sql` | **the one this all turns on**: the `auth.users` → `orbit.profiles` trigger, and `orbit.space_invite()`. The only migration that writes outside the `orbit` schema |

### The four gotchas

The first three are from §2 of `docs/deployment-and-android.md`; the fourth was
found the first time Orbit was installed into a project that was already in use.
All four are things to check rather than assume, and the first is the one that
fails silently.

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
# expect: on_auth_user_created — among possibly others, see gotcha 4
```

Then sign up once and check the pair:

```sh
psql "$ADMIN_URL" -c "\
  select u.id = p.id as ids_match, u.email, p.display_name \
  from auth.users u join orbit.profiles p on p.id = u.id"
```

If `ids_match` is not `t` for your account, stop: nothing else will work, and
it will not tell you.

**2. The `auth` shim is not yours on Supabase, and 0000 no longer pretends
otherwise.** The `auth` schema and `auth.uid()` belong to
`supabase_auth_admin`, so replacing the function or granting on the schema
raises `permission denied for schema auth` — **even as the `postgres` user**.

This used to abort the migration at line 53 and this document told you to
re-run with `ON_ERROR_STOP=0` and judge for yourself which failures were
expected. That was a bad instruction: a migration you can only apply if you
already know which of its errors to ignore is not a migration. 0000 now guards
each step twice — skipped where the platform already provides it, and caught if
a grant is refused anyway — so **it applies in one pass with `ON_ERROR_STOP=1`
on both Supabase and a bare cluster.**

What you should see on Supabase, and all of it is fine:

```
NOTICE:  extension "pgcrypto" already exists, skipping
NOTICE:  schema "auth" already exists, skipping
NOTICE:  auth.uid() already exists — leaving the platform's own in place
NOTICE:  auth.role() already exists — leaving the platform's own in place
NOTICE:  no privilege to grant on schema auth — the platform owns it, which is expected
```

Orbit never replaces `auth.uid()` where one exists. Supabase's reads exactly
the same GUCs, so overwriting it would be replacing a working platform function
with a copy of itself.

**An error here is now a real error.** If 0000 stops, do not reach for
`ON_ERROR_STOP=0` — read what it says.

**4. A shared project may already have triggers on `auth.users`, and yours is
not the only one.** `auth.users` is the one table Orbit writes outside its own
schema, so it is also the one place another project in the same database can
collide with it. Look before you sign up:

```sh
psql "$ADMIN_URL" -c "select tgname, tgenabled from pg_trigger \
  where tgrelid='auth.users'::regclass and not tgisinternal order by tgname"
```

Anything other than `on_auth_user_created` belongs to something else, and it can
refuse an insert that Orbit expects to succeed. A real example, found on the
first project Orbit was installed into: an `enforce_email_allowlist` trigger
that raises unless the address is on a list. It stops the pgTAP suite at
assertion 84 — and, far more importantly, **it refuses your own sign-up**, with
a failure that reads like Orbit's authentication being broken.

Two consequences:

- **Add your address to whatever that trigger checks before you deploy**, or the
  first sign-up fails and gotcha 1 is untestable.
- **Firing order is alphabetical**, so a trigger named before `on_auth_user_created`
  aborts the insert first and no orphan profile is created. That is the safe
  order and it is luck rather than design. A trigger sorting *after* Orbit's
  would leave a profile row behind for an account that was then rejected.

To run the full pgTAP suite against such a project, three addresses need to be
acceptable to it: `newcomer@example.com`, `quiet.person@example.com` and
`alice@example.com`. The suite rolls back its own inserts; anything you add to
somebody else's allowlist to make it pass is yours to remove afterwards.

**3. `orbit_app` must exist, be able to log in, own nothing, and hold no
BYPASSRLS.** The whole security model is that the application connects as a role
the policies apply to in full — `./scripts/db-test.sh` asserts exactly that
locally, and it is worthless if the deployed role is different.

```sh
psql "$ADMIN_URL" <<'SQL'
create role orbit_app login password 'PUT A REAL PASSWORD HERE' noinherit;
grant connect on database postgres to orbit_app;
grant usage on schema orbit to orbit_app;
grant authenticated, anon to orbit_app;

-- The identity seam: two narrow functions, no table grants at all. Only the
-- dev provider calls these; harmless to grant either way.
grant execute on function orbit.identity_profile(uuid) to orbit_app;
grant execute on function orbit.identity_profiles() to orbit_app;
SQL
```

**Do not grant on schema `auth` here.** It belongs to `supabase_auth_admin` and
the statement fails the same way 0000 used to. It is also unnecessary:
`asUser()` issues `set local role authenticated` before it does anything else,
and on Supabase `authenticated` already holds usage on `auth` and execute on
`auth.uid()`. The pool role reaches nothing under its own name — which is the
point of `noinherit`.

**Through the pooler, `orbit_app`'s username carries the project ref too** —
`orbit_app.YOUR-REF`, exactly as `postgres` became `postgres.YOUR-REF`. A
`DATABASE_URL` with a bare `orbit_app` fails authentication against the pooler
host and the message does not explain why.

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

You do **not** need to set a `search_path` on the role. `asUser()` and
`asAnon()` in `src/lib/db/index.ts` issue `set local search_path = orbit,
public, extensions` inside every transaction, which is the only place it could
be got wrong once and stay wrong. Setting it on the role as well is harmless and
`./scripts/db-reset.sh` does it locally, but it is belt on top of braces.

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

### Run the pgTAP suite against the real project

Not optional in spirit: 106 assertions have only ever run against a local shim
of `auth.uid()`, and this is the first evidence that the security model holds
against the real one. It creates its own fixtures inside the transaction and
rolls back, so it leaves nothing behind and does not touch your data.

**`ON_ERROR_STOP=1` does not judge this suite.** pgTAP reports a failure as a
`not ok` *row*, not as an error, so psql exits 0 on a run where every assertion
failed. You have to read the output — which is why `scripts/db-test.sh` greps
for two things rather than trusting an exit code. Do the same by hand:

```sh
psql "$ADMIN_URL" -c 'create extension if not exists pgtap'

# -P pager=off, or psql pipes it through less and quitting takes the whole
# run off the screen with it.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -P pager=off \
  -f supabase/tests/rls_isolation_test.sql > /tmp/pgtap.log 2>&1
echo "psql exit: $?"

grep -c '^ok' /tmp/pgtap.log                    # expect: 106
grep '^not ok' /tmp/pgtap.log                   # expect: nothing
grep 'Looks like you' /tmp/pgtap.log            # expect: nothing
```

The third grep is not redundant. A wrong plan count means assertions were added
or lost, pgTAP reports it as `Looks like you planned 106 but ran 104`, and that
line is not a `not ok` — a suite that quietly stopped running halfway looks
clean to the second grep alone.

Three of the 106 are about the `auth.users` trigger and the shim. Those are the
ones worth watching here, because they are the ones a local container could only
ever test against a stand-in.

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
