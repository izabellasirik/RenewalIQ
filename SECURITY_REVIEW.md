# RenewalIQ — Security Review

**Date:** 2026-10-08 · **Scope:** this repository (React/Vite SPA, Supabase migrations 0001–0046, the
`extract-document-vision` Edge Function, the three Vercel API routes in `api/`) · **Reviewer:** Claude
Code, at the founder's request, before onboarding more agencies.

This is an engineering review of the code and database definitions. It is **not** a penetration
test, an audit of the live Supabase/Vercel/GitHub configuration, or a compliance certification
(SOC 2, ISO 27001, etc. — none is claimed). Items that can only be confirmed in a dashboard are
listed under **Manual verification required**.

## How it was reviewed

- Every migration was applied, in order, to an empty Postgres database (with the same stubbed
  `auth` / `storage` schemas the RLS test suite uses), then queried for: tables without row-level
  security, policies that allow `true`, `SECURITY DEFINER` functions without a fixed `search_path`,
  functions and tables reachable by the `anon` role, and storage policies.
- The three Vercel API routes, the Edge Function, the storage paths, the client request / intake
  link flows, account deletion, logging, secrets handling and `npm audit` were read or run.
- Existing automated checks: `supabase/tests/agency_rls` (370 checks, incl. cross-agency read/write
  attempts on accounts, documents, requests, intake links, carriers, analytics and AI usage),
  `supabase/tests/intake` (41 checks), 338 unit tests.

## Verified safeguards

| Area | What was verified |
|---|---|
| Row-level security | **Every** table in `public` has RLS enabled. Tables with no policies (`product_events`, `account_analytics_flags`, `time_saved_responses`, `ai_usage_events`, `ai_read_cache`, `submission_email_notifications`, `notification_dispatch_settings`) are deny-all for app users and reached only through checked functions or the service role. |
| Tenant isolation | Account rows and their child tables go through `can_access_submission()` (owner, assigned broker, collaborator, or same-agency admin). Agencies, profiles, invitations, intake links and agency carriers are scoped to `current_agency_id()`. The RLS suite includes explicit other-agency attempts for each. |
| Definer functions | All `SECURITY DEFINER` functions pin `search_path`. Founder-only functions (`founder_analytics_snapshot`, `founder_ai_usage`, `set_account_analytics_mode`) check `is_founder()` in the database (confirmed email `anism.academy@gmail.com`); look-alike or unconfirmed emails are refused (tested). |
| Anonymous access | `anon` has **no** direct table privileges in `public`. Anonymous clients reach only token-gated functions (`get_document_request`, `attach_document_request_file`, `submit_document_request`, intake functions, `get_agency_invitation`) — tokens are random UUIDv4 (122 bits). The only `true` read policy is `appetite_overrides` (the public carrier appetite data, intended). |
| Private storage | Both buckets (`submission-documents`, `intake-uploads`) are private. Documents are opened through 5-minute signed URLs (`getSignedDocumentUrl`). Anonymous uploads are accepted only into the folder of an open, unexpired request or a live intake submission. |
| Client links | Document-request links expire (60 days; a follow-up extends by 30) and stop accepting files once complete/cancelled. The client page shows only the insured's name, the requested item labels and the client's own uploads — no other accounts, agency data or broker notes. Invitations expire after 14 days. |
| Server routes | `api/notify-submission` requires a shared secret (constant-time compare), claims each event atomically and sends once (idempotency key). `api/send-invitation` reads the invitation with the caller's own session, so RLS limits it to that agency's admins and the only recipient is the invited address. `api/fetch-document` requires a signed-in user, https only, blocks private/link-local addresses (rechecked on each redirect), caps size and time. |
| AI extraction | The Edge Function keeps JWT verification on (the deploy workflow refuses `--no-verify-jwt`), holds the Anthropic key server-side, validates image type/size, never returns provider error bodies to the browser, and validates every AI value client-side before use. Cached AI reads are scoped per brokerage and readable only by the function (service role). |
| Secrets | No keys in the repository. `.env*` is git-ignored; the browser only gets `VITE_SUPABASE_URL` and the anon key. The service-role key, Resend key, Anthropic key and webhook secret live in Vercel / Supabase function secrets / GitHub secrets. |
| Logging | No document text or extracted values are logged. The app's only console logging of document processing is development-only and counts-only. The Edge Function logs provider status codes, not content. |
| Audit trail (accounts) | `activity_events` is append-only for app users (insert + select policies only; inserts must carry the caller's own `user_id`). |
| XSS in emails | Both email routes HTML-escape every interpolated value. |

## Findings

Severity: **Critical** (cross-tenant data access or account takeover) · **High** · **Medium** · **Low**.
**No Critical finding was identified.**

| # | Severity | Finding | Recommended fix |
|---|---|---|---|
| H-1 | High | **AI extraction is open to any signed-up user, without a quota.** Sign-up is open in the app; any confirmed account (no agency needed) can call `extract-document-vision` repeatedly. The read cache stops repeats of the *same* page, but distinct images are billed. Financial exposure, not data exposure. | Per-user and per-agency daily caps in the function (count today's `ai_usage_events`), and/or require agency membership. Decide whether public sign-up should stay on (Supabase Auth setting). |
| M-1 | Medium | **No server-side file size or type limits on uploads.** Neither bucket sets `file_size_limit` / `allowed_mime_types` in code, and the anonymous client-request/intake upload paths only check the folder. A link holder could upload very large or arbitrary files (private, but stored and billed). | Set bucket limits (e.g. 25 MB; PDF, images, Office, CSV, text) via a migration or the dashboard, and check size/type in the upload UIs. Needs a decision on the allowed list before applying in production. |
| M-2 | Medium | **Deleting an account leaves files behind.** Cleanup removes only files under the *deleting* user's folder: documents uploaded by other brokers on the same account, client-request/intake uploads in `intake-uploads`, and cached AI reads remain. The original uploader can still read their own orphaned files (storage policy clause for not-yet-saved accounts). Not visible to other tenants, but a retention problem for driver's licenses / MVRs. | A server-side cleanup on account deletion (definer function or route with the service role) that removes every object for the account in both buckets, plus a periodic orphan sweep. Define a retention policy. |
| M-3 | Medium | **No security headers.** `vercel.json` sets no `X-Frame-Options`/`frame-ancestors` (clickjacking), `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. Client request links carry their token in the URL path, so a permissive referrer policy can leak it to third parties the page loads from. | Add headers in `vercel.json`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` on `/r/*`), `Permissions-Policy` with camera/mic/geo off. A full CSP after testing (Supabase, jsDelivr, Google Fonts if used). |
| M-4 | Medium | **No audit log for sensitive administrative actions.** Role changes, member removal, invitation create/revoke, account deletion (which cascades away the account's own activity log) and founder Real/Test changes leave no durable record. | An append-only `security_audit_log` (who, what, target, when; no PII payloads) written by the existing definer functions; founder-readable only. |
| M-5 | Medium | **Dependency advisories:** `@xmldom/xmldom` (high; reached by `.docx` parsing of client-supplied files in the broker's browser), `brace-expansion` (high; build tooling), `mammoth → argparse → sprintf-js` (moderate). Exposure is limited (browser-side parsing, build time), but untrusted client files do reach the parser. | `npm audit fix` (non-breaking) for xmldom and brace-expansion, then re-test Word parsing. Track mammoth; its "fix" is a downgrade, not applied. |
| L-1 | Low | `api/fetch-document` checks the host's addresses, then fetches again (DNS-rebinding window); IPv6 checks don't cover every mapped/NAT64 form; the upstream `content-type` is passed through. Requires a signed-in user and runs on Vercel's network. | Connect to the resolved address (pin), broaden IPv6 checks, add `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`. |
| L-2 | Low | Agency intake links never expire (revocable by the broker; by design). | Optional expiry date per link; show "last used". |
| L-3 | Low | `get_public_intake_link` returns the broker's internal user id to anonymous visitors. | Return only what the form needs. |
| L-4 | Low | Anonymous inserts into `product_feedback` and `appetite_update_requests` have no rate limit (spam). | Rate-limit or require sign-in. |
| L-5 | Low | AI usage rows take account/document ids from the browser (sanitised format, not ownership-checked) — usage attribution could be mislabelled by a malicious user. Analytics only; no data access. | Verify the account is accessible to the caller before recording, if attribution matters for billing. |
| L-6 | Low | Founder identity is a hard-coded confirmed email. Whoever controls that mailbox controls Founder Analytics. | Turn on MFA for the founder and agency admin accounts. |

## Remaining risks (accepted for now, documented)

- Photos and scanned pages are sent to Anthropic for AI reading (a sub-processor). Agencies should
  be told this in the terms/privacy notice; confirm Anthropic's commercial data-use terms for the
  account in use.
- Account data is also held in each broker's browser storage (offline-first design). A shared or
  compromised computer exposes what that broker could already see; signing out clears the session,
  not necessarily cached account data.
- Clients receive links by email/text; anyone holding a link can upload to that request until it
  expires or is completed. Links grant no read access to account data beyond the item labels.

## Manual verification required (dashboards — not visible from the code)

1. **Supabase Auth:** whether public sign-up should stay enabled; email confirmation required; minimum password length; MFA availability; session lifetime.
2. **Supabase Storage:** bucket size/MIME limits (M-1); both buckets private.
3. **Backups / restore:** the Supabase plan's backup schedule and whether point-in-time recovery is on; **test a restore** into a scratch project once. Storage objects are not covered by database backups — decide how documents are backed up.
4. **Vercel:** environment variables scoped correctly (service-role key and Resend key only on server functions, not exposed as `VITE_`); who has project access; preview deployments protected if they point at production data.
5. **GitHub:** who can push to the deploy branch (it deploys the Edge Function); `SUPABASE_ACCESS_TOKEN` scope and rotation.
6. **Key rotation plan** for the Anthropic key, Resend key, service-role key and `NOTIFY_WEBHOOK_SECRET`.
7. **pg_cron / pg_net** jobs present only as defined in 0041.

## Fix plan

No Critical issues → nothing was changed in production code as part of this review. Proposed order
(each with tests, each needing approval where it touches production configuration or the
auto-deployed Edge Function):

1. H-1 AI quota (Edge Function — deploys on push, so held for approval).
2. M-3 security headers, M-5 dependency updates (low risk, app-only).
3. M-2 account-deletion cleanup + M-4 audit log (one migration, RLS-tested).
4. M-1 bucket limits (needs the allowed file-type list agreed first; production config).
5. Low items as convenient.

## Remediation status (2026-10-09)

| # | Status |
|---|---|
| H-1 | **Built, tested, held for approval.** Per-broker (200) and per-agency (1,000) daily limits on paid AI reads, enforced atomically in the database (`ai_quota_take`, 0047; a 20-connection race test allows exactly the limit). Cached re-reads are free and never blocked; if the quota can't be checked the read goes through, so existing work isn't interrupted. Brokers over the limit get a clear message and the upload still completes via on-device reading, held for review. The Edge Function change is **not committed** — pushing it deploys to production. |
| M-1 | **Built (0048, not yet applied).** 25 MB and an allow-list on both buckets; contents checked by real file signature in the browser and again on the server (`api/verify-upload`), mismatches deleted; a database switch then refuses any unchecked client upload. Release check (2026-10-10): the route refuses other users' and other agencies' folders, forged sessions and `.`/`..` path segments, returns only the file kind, and deletes only a file stored in the last 15 minutes (an older file is refused but never removed); executables are never accepted as text; files are stored with the type their extension implies even when the browser gives none. |
| M-2, M-3, M-4, M-5, L-1…L-6 | Open — next phases. |
| Self-service agencies | `create_my_agency` (0047): confirmed email, not already in an agency, one per owner; brokers join only by invitation. Covered by SQL tests including another agency's data staying invisible. |
