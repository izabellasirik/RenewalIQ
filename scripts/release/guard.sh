#!/usr/bin/env bash
# Refuses to go on unless every setting points at the isolated TEST Supabase project — never at
# production. Sourced by test-env.sh and run first in .github/workflows/release-check.yml.
#
# Needs: TEST_REF, PROD_REF, TEST_URL, TEST_DB_URL (see RELEASE_V4.md for where each comes from).
set -euo pipefail

stop() { echo "::error::$1 Nothing was done."; exit 1; }

[ -n "${TEST_REF:-}" ] || stop "TEST_SUPABASE_PROJECT_REF is not set."
[ -n "${PROD_REF:-}" ] || stop "SUPABASE_PROJECT_REF (production) is not set, so the test project can't be told apart from it."
[ "$TEST_REF" != "$PROD_REF" ] || stop "The test project ref is the production project ref."
[ -n "${TEST_URL:-}" ] && [ -n "${TEST_DB_URL:-}" ] || stop "TEST_SUPABASE_URL / TEST_SUPABASE_DB_URL are not set."
case "$TEST_URL" in *"$TEST_REF"*) ;; *) stop "TEST_SUPABASE_URL is not the test project's URL." ;; esac
case "$TEST_DB_URL" in *"$TEST_REF"*) ;; *) stop "TEST_SUPABASE_DB_URL is not the test project's database (use its Session pooler string)." ;; esac
case "$TEST_URL $TEST_DB_URL" in *"$PROD_REF"*) stop "A test setting contains the production project ref." ;; esac
echo "guard: test project ${TEST_REF:0:4}… is not production — OK"
