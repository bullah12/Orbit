#!/usr/bin/env bash
# Run the pgTAP suite against the Orbit database.
#
#   ./scripts/db-test.sh                 run every test in supabase/tests
#   ./scripts/db-test.sh rls_isolation   run one, by filename stem
#
# Tests run inside a transaction that is rolled back, so they leave the seeded
# database exactly as they found it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${ORBIT_DB_NAME:-orbit}"
FILTER="${1:-}"

say()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

if ! su postgres -c "psql -tAc \"select 1 from pg_available_extensions where name='pgtap'\" -d '$DB_NAME'" \
     2>/dev/null | grep -q 1; then
  fail "pgTAP is not available — run ./scripts/db-reset.sh first"
  exit 1
fi

status=0
shopt -s nullglob
for f in "$ROOT"/supabase/tests/*_test.sql; do
  stem="$(basename "$f" .sql)"
  [[ -n "$FILTER" && "$stem" != *"$FILTER"* ]] && continue

  say "$stem"
  out="$(su postgres -c "psql -X -q --no-align --tuples-only -v ON_ERROR_STOP=1 -d '$DB_NAME' -f '$f'" 2>&1)" \
    || { printf '%s\n' "$out"; fail "$stem errored"; status=1; continue; }

  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -qE '^not ok'; then
    fail "$stem has failing assertions"
    status=1
  fi
  # A wrong plan count is a failure too: it means assertions were added or
  # skipped without anyone noticing. pgTAP reports it as a comment, not as
  # `not ok`, so it has to be caught separately.
  if printf '%s\n' "$out" | grep -q 'Looks like you planned'; then
    fail "$stem has the wrong plan count"
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  printf '\033[1;32m✓\033[0m all pgTAP tests passed\n'
fi
exit $status
