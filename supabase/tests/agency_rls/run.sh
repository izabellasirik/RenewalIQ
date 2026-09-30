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
  -f "$DIR/stub_schema.sql" -f "$MIG/0003_broker_workspaces.sql" -f "$MIG/0005_submission_contact_fields.sql" -f "$MIG/0007_account_workflow.sql" \
  -f "$MIG/0008_account_stage.sql" -f "$MIG/0009_account_follow_ups.sql" -f "$MIG/0010_driver_experience_months.sql" \
  -f "$DIR/seed_legacy.sql" >/dev/null 2>&1
# 0011 twice: it must be re-runnable.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0011_agency_roles.sql" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/0011_agency_roles.sql" >/dev/null 2>&1
# Intake links (0033's client page shows the name the broker gives clients there) — once each.
for m in 0004_intake_submissions 0013_intake_link_organization_name 0019_intake_documents_insert_fix 0029_intake_reliability; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/$m.sql" >/dev/null
done
# Later migrations that touch profiles/agencies — also re-run once each.
for m in 0014_activity_actor_name 0017_profile_contact_fields 0018_agency_invitations 0021_account_archive_permissions 0022_assign_own_personal_accounts 0023_agency_carriers 0026_collaborators_notifications 0027_team_management 0024_record_details 0028_atomic_account_save 0030_document_requests 0031_upload_review_and_provenance 0032_share_personal_accounts 0033_request_multi_upload 0035_request_client_submit 0036_agency_intake_links 0037_intake_link_privacy 0038_agency_intake_submission_visibility 0039_intake_duplicate_accounts 0040_submission_email_notifications 0041_submission_email_queue 0042_client_submission_activity; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/$m.sql" >/dev/null 2>&1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG/$m.sql" >/dev/null 2>&1
done
ACTUAL="$(psql -q -d "$DB" -f "$DIR/tests.sql" 2>&1 | sed 's/psql:[^ ]* NOTICE:  //' | grep -E '^(L|T|N|X|A|S|F|U|P|I|G|C|K|M|R|D|E|H|J|Q|W|V|O|Y|Z|B|backfill)[0-9 ]')"
[ -n "${KEEP_DB:-}" ] || psql -q -d postgres -c "drop database $DB" >/dev/null
if diff <(cat "$DIR/expected.txt") <(echo "$ACTUAL"); then echo "agency RLS: all $(wc -l < "$DIR/expected.txt") checks passed"; else echo "agency RLS: MISMATCH (see diff above)"; exit 1; fi
