#!/usr/bin/env bash
# Drop and rebuild the Orbit database from supabase/migrations/, in order.
#
# Idempotent and safe to run repeatedly. Requires PostgreSQL 16 with PostGIS and
# pgTAP; installs them via apt if they are missing (a fresh container will need
# this). pgvector is installed too because 0000_bootstrap.sql creates the
# extension — nothing in the schema uses it (decision 10).
#
#   ./scripts/db-reset.sh            rebuild
#   ./scripts/db-reset.sh --no-seed  rebuild, skip `pnpm seed`

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${ORBIT_DB_NAME:-orbit}"
PGPORT="${PGPORT:-5432}"
RUN_SEED=1
[[ "${1:-}" == "--no-seed" ]] && RUN_SEED=0

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- dependencies ----------------------------------------------------------
missing=()
command -v psql >/dev/null 2>&1 || missing+=(postgresql-16 postgresql-client-16)

if command -v psql >/dev/null 2>&1; then
  for ext in postgis vector pgtap; do
    case "$ext" in
      postgis) pkg=postgresql-16-postgis-3 ;;
      vector)  pkg=postgresql-16-pgvector ;;
      pgtap)   pkg=postgresql-16-pgtap ;;
    esac
    if ! su postgres -c "psql -tAc \"select 1 from pg_available_extensions where name='$ext'\"" \
         2>/dev/null | grep -q 1; then
      missing+=("$pkg")
    fi
  done
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  say "installing: ${missing[*]}"
  if [[ $EUID -ne 0 ]]; then
    die "need root to apt-install: ${missing[*]}"
  fi
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" >/dev/null
fi

# --- server ----------------------------------------------------------------
if ! su postgres -c "pg_isready -q -p $PGPORT" 2>/dev/null; then
  say "starting postgresql"
  service postgresql start >/dev/null 2>&1 || pg_ctlcluster 16 main start
  for _ in $(seq 1 30); do
    su postgres -c "pg_isready -q -p $PGPORT" 2>/dev/null && break
    sleep 1
  done
fi
su postgres -c "pg_isready -q -p $PGPORT" || die "postgres did not come up on port $PGPORT"

# --- app role --------------------------------------------------------------
# One login role. It is deliberately NOT the owner of any table, so RLS applies
# to it in full. See docs/adr/0001-architecture.md §1.
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d postgres" <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'orbit_app') then
    create role orbit_app login password 'orbit_dev_password' noinherit;
  end if;
  -- Seeding only. BYPASSRLS is exactly why this is a separate role from the one
  -- the application uses: the app must never be able to opt out of a policy.
  if not exists (select 1 from pg_roles where rolname = 'orbit_seed') then
    create role orbit_seed login password 'orbit_dev_password' bypassrls;
  end if;
end \$\$;
SQL

# --- rebuild ---------------------------------------------------------------
say "dropping and recreating database '$DB_NAME'"
su postgres -c "psql -q -d postgres -c \"
  select pg_terminate_backend(pid) from pg_stat_activity
  where datname = '$DB_NAME' and pid <> pg_backend_pid()\"" >/dev/null
su postgres -c "dropdb --if-exists '$DB_NAME'"
su postgres -c "createdb '$DB_NAME'"

shopt -s nullglob
for f in "$ROOT"/supabase/migrations/*.sql; do
  say "applying $(basename "$f")"
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -c 'set client_min_messages=warning' -d '$DB_NAME' -f '$f'" \
    >/dev/null || die "migration failed: $(basename "$f")"
done

# orbit_app can authenticate and use the schemas; every table grant was issued
# to `authenticated`, which orbit_app assumes per request via SET ROLE.
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d '$DB_NAME'" <<SQL
grant connect on database "$DB_NAME" to orbit_app;
grant usage on schema orbit, auth to orbit_app;
grant authenticated, anon to orbit_app;

-- Everything Orbit owns is in `orbit`, and nothing it owns is in `public`.
-- Pinning the search_path on the role means a query that forgets its prefix
-- fails here rather than in production, and it matches what src/lib/db/index.ts
-- sets per transaction. `public` and `extensions` follow for PostGIS.
alter role orbit_app  in database "$DB_NAME" set search_path = orbit, public, extensions;
alter role orbit_seed in database "$DB_NAME" set search_path = orbit, public, extensions;

-- The identity-provider seam. See supabase/migrations/0008_identity_lookup.sql:
-- resolving a cookie to a profile happens before there is an auth.uid() to
-- check, so it goes through two narrow SECURITY DEFINER functions rather than a
-- table grant. orbit_app gets NO direct select on any table.
grant execute on function orbit.identity_profile(uuid) to orbit_app;
grant execute on function orbit.identity_profiles() to orbit_app;

grant connect on database "$DB_NAME" to orbit_seed;
grant usage on schema orbit, auth to orbit_seed;
grant all on all tables in schema orbit to orbit_seed;
grant execute on all functions in schema orbit to orbit_seed;
SQL

# Every Orbit table is in the `orbit` schema, so that is what gets counted. The
# check would pass vacuously if the schema name were wrong, so it also asserts
# the count is non-zero below.
#
# spatial_ref_sys is PostGIS's own read-only reference data (EPSG definitions).
# It lands in `public` here rather than `orbit`, but it is still excluded by
# name so the check keeps working if an installation puts it elsewhere.
APP_TABLES="from pg_tables where schemaname='orbit' and tablename <> 'spatial_ref_sys'"
TABLES=$(su postgres -c "psql -tAc \"select count(*) $APP_TABLES\" -d '$DB_NAME'")
NO_RLS=$(su postgres -c "psql -tAc \"select count(*) $APP_TABLES and not rowsecurity\" -d '$DB_NAME'")
say "$TABLES tables in schema orbit, $((TABLES - NO_RLS))/$TABLES with RLS enabled"
[[ "$TABLES" -gt 0 ]] || die "no tables in schema 'orbit' — the migrations built something else"
[[ "$NO_RLS" == "0" ]] || die "$NO_RLS table(s) without RLS — that is a bug, not a warning"

if [[ $RUN_SEED -eq 1 ]]; then
  if command -v pnpm >/dev/null 2>&1 && [[ -f "$ROOT/package.json" ]]; then
    say "seeding"
    (cd "$ROOT" && pnpm --silent seed)
  else
    say "skipping seed (no pnpm or no package.json yet)"
  fi
fi

say "done — DATABASE_URL=postgres://orbit_app:orbit_dev_password@localhost:$PGPORT/$DB_NAME"
