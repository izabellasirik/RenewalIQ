#!/usr/bin/env bash
# Runs the intake reliability tests (0029) against a throwaway local Postgres database, with the
# same minimal Supabase auth/storage stub as the agency RLS tests. Needs psql + a superuser:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/intake/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MIG="$DIR/../../migrations"
DB="${INTAKE_TEST_DB:-renewaliq_intake_test}"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" \
  -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$" \
  -f "$DIR/../agency_rls/stub_schema.sql" \
  -c "alter table storage.objects add column if not exists metadata jsonb, add column if not exists created_at timestamptz default now(); grant usage on schema public, storage to anon; grant all on storage.objects to anon;" \
  -f "$MIG/0004_intake_submissions.sql" -f "$MIG/0013_intake_link_organization_name.sql" -f "$MIG/0019_intake_documents_insert_fix.sql" \
  -c "grant all on all tables in schema public to anon, authenticated; grant usage, select on all sequences in schema public to anon, authenticated; alter default privileges in schema public grant all on tables to anon, authenticated;" >/dev/null 2>&1
# 0029 twice: it must be re-runnable.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0029_intake_reliability.sql" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0029_intake_reliability.sql" >/dev/null 2>&1
ACTUAL="$(psql -q -At -d "$DB" -f "$DIR/tests.sql" 2>&1 | sed 's/psql:[^ ]* NOTICE:  //' | grep -E '^Q[0-9]')"
[ -n "${KEEP_DB:-}" ] || psql -q -d postgres -c "drop database $DB" >/dev/null
if diff <(cat "$DIR/expected.txt") <(echo "$ACTUAL"); then echo "intake: all $(wc -l < "$DIR/expected.txt") checks passed"; else echo "intake: MISMATCH (see diff above)"; exit 1; fi
