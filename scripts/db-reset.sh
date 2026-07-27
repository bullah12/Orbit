#!/usr/bin/env bash
# Rebuild the local database from scratch: bootstrap shim, migrations, grants.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${ORBIT_DB_NAME:-orbit}"
PSQL="psql -v ON_ERROR_STOP=1 -q"

sudo_pg() { su postgres -c "$1"; }

sudo_pg "psql -v ON_ERROR_STOP=1 -q -c \"drop database if exists $DB\"" >/dev/null
sudo_pg "psql -v ON_ERROR_STOP=1 -q -c \"create database $DB\"" >/dev/null

sudo_pg "$PSQL -d $DB -f $ROOT/supabase/local/00_bootstrap.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  apply $(basename "$f")"
  sudo_pg "$PSQL -d $DB -f $f" >/dev/null
done
sudo_pg "$PSQL -d $DB -f $ROOT/supabase/local/99_grants.sql" >/dev/null
echo "database '$DB' rebuilt"
