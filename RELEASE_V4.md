# Release V4 — test environment, deployment and rollback

Production stays untouched until it is approved. Everything below is either read-only on production
or runs on a separate **test** Supabase project with synthetic data.

## 1. One-time: an isolated test project for Vercel Preview

**Supabase** — create a new project (e.g. `renewaliq-test`, Free plan is fine, same region as
production). From it, note: Project ref, Project URL, `anon` key, `service_role` key, and under
**Connect → Session pooler** the connection string with the database password.

**GitHub** → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `TEST_SUPABASE_PROJECT_REF` | test project ref |
| `TEST_SUPABASE_URL` | test project URL |
| `TEST_SUPABASE_ANON_KEY` | test `anon` key |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | test `service_role` key |
| `TEST_SUPABASE_DB_URL` | test Session pooler connection string |
| `TEST_ANTHROPIC_API_KEY` *(optional)* | a separate Anthropic key with a low spend limit — enables the AI and quota checks (a few cents per run) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` *(only if Preview deployments are protected)* | Vercel → Settings → Deployment Protection → Protection Bypass for Automation |

The existing `SUPABASE_PROJECT_REF` (production) is only compared against, so the checks can refuse
to run if anything points at production; `SUPABASE_ACCESS_TOKEN` deploys the AI function to the
**test** project only.

**Vercel** → Settings → Environment Variables. **Do not change any Production value.** For each of
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` (if present) and
`SUPABASE_SERVICE_ROLE_KEY`:
1. If it applies to Preview today, edit it and **untick Preview only** (Production keeps its value).
2. Add it again for **Preview only**, with the test project's value.

Also untick Preview on the email settings (`RESEND_API_KEY`, `NOTIFY_WEBHOOK_SECRET`) so previews
never send email. Values are built into the app, so then redeploy the Preview (Deployments → latest
Preview → ⋯ → Redeploy) — the release check refuses a Preview still built against production.

Then: Actions → **Release check** → Run workflow → branch `claude/dreamy-pasteur-j9a9d9`, step `all`.

### What the release check does (`.github/workflows/release-check.yml`)

1. `guard.sh` — stops unless every setting is the test project (never the production ref).
2. `setup` — empty test project → migrations 0001–0046 (production's schema today) → synthetic
   agency, users, accounts, documents (incl. an older `.tif` and `.msg`), checklist items,
   follow-ups, client requests and a client upload.
3. `deploy-function` — the AI function with the held quota change, to the **test** project only.
4. `migrate` — `preflight.sql`, then `0047_verified.sql` and `0048_verified.sql`, then the file survey.
5. `e2e` — on the real Preview: checks the Preview is built against the test project (stops
   otherwise), `/api/verify-upload` runs on Vercel, existing data shows unchanged, upload + AI,
   Missing Documents → prepared → sent, client upload checked on the server with enforcement on,
   untyped `.HEIC`, direct-API bypass refused, broker verification, cross-agency probes, Market
   Finder, Founder Analytics access, AI quota (with an Anthropic key).
6. `rollback-drill` — rollback scripts, data unchanged, then forward again.

## 2. Production release (after approval)

| Step | Do | Check | If it goes wrong |
|---|---|---|---|
| 0 | **Backup.** Supabase → Database → Backups: note the latest backup time (Pro plan). On the Free plan take one yourself: `npx supabase@2 db dump --db-url "<production Session pooler URL>" -f renewaliq-prod-$(date +%F).sql` and again with `--data-only -f renewaliq-prod-data-$(date +%F).sql`. Keep the files private (never in the repo). Run `supabase/release/preflight.sql` and `file_types_in_use.sql` in the SQL editor; save both results. | Backup time / files exist; preflight saved | — |
| 1 | Promote the release commit to Production in Vercel | Sign in, open an account, upload a file, Market Finder. `curl -X POST https://<production>/api/verify-upload -H 'content-type: application/json' -d '{}'` → `400 {"error":"Unknown upload."}` | Promote `5830075` again (instant) |
| 2 | Right after: SQL editor → paste `supabase/release/0047_verified.sql` → Run | Last result: **0047 applied and verified**, counts equal to the preflight. A `STOPPED …` error means nothing was applied | `rollback_0047.sql` (only needed if the previous app is promoted again) |
| 3 | Next day (brokers' tabs refreshed), after reviewing `file_types_in_use.sql`: `0048_verified.sql` | **0048 applied and verified**; one client and one broker upload work | `rollback_0048.sql` |
| 4 | Approve → the AI quota change is pushed (deploys the function) | Upload a photo; `select count(*) from ai_usage_events where organization_id is null and occurred_at > now() - interval '1 hour'` → 0 | Revert the commit (redeploys the previous function), or raise `AI_DAILY_LIMIT_PER_USER` / `_PER_AGENCY` in function secrets |
| 5 | After a clean day: `update public.app_settings set value = 'true' where key = 'require_upload_verification';` | `upload_verifications` has today's client uploads | Set it back to `'false'` (instant) |

**Rolling the app back after step 2/3:** promote `5830075`, then run `rollback_0047.sql` (new requests
start as "Sent (unconfirmed)", as the previous app expects) and, if 0048 is in, `rollback_0048.sql`
(the previous app sends the browser's file type, which 0048 can refuse). When the new app is live
again: `rollforward_0047.sql` and `0048_verified.sql`. Tested: previous app on the migrated database,
rollback, roll forward — no account, document or file lost.

**Last resort:** restore the step-0 backup (Supabase → Backups → Restore, or `psql` the dump into a
new project). Stored files are not in database backups, but this release never changes or deletes a
stored file.

## 3. Files

| File | |
|---|---|
| `supabase/release/0047_verified.sql`, `0048_verified.sql` | the migrations, unchanged, inside a transaction that fingerprints all existing data before and after and cancels itself on any change (built by `scripts/release/build-verified.mjs`; a unit test keeps them in step with the migrations) |
| `supabase/release/preflight.sql`, `file_types_in_use.sql` | read-only |
| `supabase/release/rollback_0047.sql`, `rollforward_0047.sql`, `rollback_0048.sql` | tested rollback / roll-forward |
| `scripts/release/*` | the release check (test project only) |
| `scripts/release/ai-quota.patch` | the held AI-quota change, applied on the runner for the **test** deploy only (it lives outside `supabase/functions`, so it never triggers the production function deploy) |
