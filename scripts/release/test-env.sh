#!/usr/bin/env bash
# The isolated TEST Supabase project for Vercel Preview — never production (guard.sh checks first).
#
#   scripts/release/test-env.sh setup          empty test project → schema as production has it today
#                                              (0001–0046) + synthetic agency, users, accounts,
#                                              documents, requests and follow-ups ("existing data")
#   scripts/release/test-env.sh migrate        preflight, then 0047 and 0048 through the verified
#                                              wrappers (they stop if existing data would change)
#   scripts/release/test-env.sh rollback-drill rollback scripts, checks, then forward again
#
# Env: TEST_REF, PROD_REF, TEST_URL, TEST_DB_URL, TEST_SERVICE_KEY, TEST_USER_PASSWORD.
# Synthetic data only: example.com users (plus the founder's own address, for Founder Analytics).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/guard.sh"

q() { psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# The test database carries a marker; a database with data but no marker is refused (it could be
# anything — including production behind a wrong connection string).
require_marker() {
  if [ "$(q -c "select to_regclass('release_test.marker') is not null")" != "t" ]; then
    echo "::error::This database has no release_test marker — it was not set up by this script. Nothing was done."; exit 1
  fi
}

setup() {
  if [ "$(q -c "select to_regclass('release_test.marker') is not null")" != "t" ]; then
    if [ "$(q -c "select to_regclass('public.submissions') is not null")" = "t" ]; then
      echo "::error::The database already has RenewalIQ tables but no release_test marker — refusing to touch it."; exit 1
    fi
    q -c "create schema release_test; create table release_test.marker (created_at timestamptz default now(), note text); insert into release_test.marker (note) values ('RenewalIQ isolated test database for Vercel Preview — synthetic data only'); create table release_test.applied (name text primary key, applied_at timestamptz default now());"
  fi
  require_marker
  # The schema exactly as production has it before this release: every migration up to 0046.
  for f in "$ROOT"/supabase/migrations/00*.sql; do
    name="$(basename "$f" .sql)"
    [ "${name:0:4}" \> "0046" ] && continue
    [ "$(q -c "select count(*) from release_test.applied where name = '$name'")" = "1" ] && continue
    echo "applying $name"
    psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
    q -c "insert into release_test.applied (name) values ('$name')"
  done
  node "$HERE/test-env.mjs" users
  if [ "$(q -c "select to_regclass('release_test.seeded') is not null")" != "t" ]; then
    psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$HERE/seed-existing.sql"
    node "$HERE/test-env.mjs" files
    q -c "create table release_test.seeded as select now() as at"
  fi
  echo "setup done"
}

migrate() {
  require_marker
  echo "--- preflight (before)"; psql "$TEST_DB_URL" -X -f "$ROOT/supabase/release/preflight.sql"
  for m in 0047 0048; do
    if [ "$(q -c "select count(*) from release_test.applied where name like '${m}_%'")" = "1" ]; then echo "$m already applied"; continue; fi
    echo "--- $m (verified)"
    psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/supabase/release/${m}_verified.sql"
    q -c "insert into release_test.applied (name) select '${m}_verified'"
  done
  echo "--- preflight (after)"; psql "$TEST_DB_URL" -X -f "$ROOT/supabase/release/preflight.sql"
  echo "--- file types in use"; psql "$TEST_DB_URL" -X -f "$ROOT/supabase/release/file_types_in_use.sql"
}

rollback_drill() {
  require_marker
  local counts="select (select count(*) from public.submissions) || '/' || (select count(*) from public.documents) || '/' || (select count(*) from public.document_requests) || '/' || (select count(*) from storage.objects)"
  local before; before="$(q -c "$counts")"
  psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/release/rollback_0047.sql" -f "$ROOT/supabase/release/rollback_0048.sql" > /dev/null
  [ "$(q -c "select column_default from information_schema.columns where table_schema='public' and table_name='document_requests' and column_name='delivery_status'")" = "'unconfirmed'::text" ] || { echo "::error::rollback_0047 did not take"; exit 1; }
  [ "$(q -c "select count(*) from storage.buckets where id in ('submission-documents','intake-uploads') and file_size_limit is null and allowed_mime_types is null")" = "2" ] || { echo "::error::rollback_0048 did not take"; exit 1; }
  [ "$(q -c "select count(*) from pg_trigger where tgname like '%verified_upload'")" = "0" ] || { echo "::error::rollback_0048 left triggers"; exit 1; }
  [ "$(q -c "$counts")" = "$before" ] || { echo "::error::rollback changed data: $before → $(q -c "$counts")"; exit 1; }
  echo "rolled back; data unchanged ($before accounts/documents/requests/files)"
  psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/release/rollforward_0047.sql" > /dev/null
  psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/supabase/release/0048_verified.sql" | tail -3
  [ "$(q -c "$counts")" = "$before" ] || { echo "::error::roll-forward changed data"; exit 1; }
  echo "rolled forward again; data unchanged"
}

case "${1:-}" in
  setup) setup ;;
  migrate) migrate ;;
  rollback-drill) rollback_drill ;;
  *) echo "usage: $0 setup|migrate|rollback-drill"; exit 2 ;;
esac
