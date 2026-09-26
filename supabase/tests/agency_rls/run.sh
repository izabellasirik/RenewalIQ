#!/usr/bin/env bash
# Runs the agency RLS tests (0011_agency_roles.sql) against a throwaway local Postgres database,
# using a minimal stub of Supabase's auth/storage schemas. Needs psql + a superuser connection:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/agency_rls/run.sh
# Fails if any line differs from expected.txt.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MIG="$DIR/../../migrations"
DB="${AGENCY_RLS_TEST_DB:-renewaliq_agency_rls_test}"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" \
  -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$" \
  -f "$DIR/stub_schema.sql" -f "$MIG/0003_broker_workspaces.sql" -f "$MIG/0007_account_workflow.sql" \
  -f "$MIG/0008_account_stage.sql" -f "$MIG/0009_account_follow_ups.sql" -f "$MIG/0010_driver_experience_months.sql" \
  -f "$DIR/seed_legacy.sql" >/dev/null 2>&1
# 0011 twice: it must be re-runnable.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0011_agency_roles.sql" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0011_agency_roles.sql" >/dev/null 2>&1
# Later migrations that touch profiles/agencies — also re-run once each.
for m in 0017_profile_contact_fields; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/$m.sql" >/dev/null 2>&1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/$m.sql" >/dev/null 2>&1
done
ACTUAL="$(psql -q -d "$DB" -f "$DIR/tests.sql" 2>&1 | sed 's/psql:[^ ]* NOTICE:  //' | grep -E '^(L|T|N|X|A|S|F|U|P|I|backfill)[0-9 ]')"
psql -q -d postgres -c "drop database $DB" >/dev/null
if diff <(cat "$DIR/expected.txt") <(echo "$ACTUAL"); then echo "agency RLS: all $(wc -l < "$DIR/expected.txt") checks passed"; else echo "agency RLS: MISMATCH (see diff above)"; exit 1; fi
