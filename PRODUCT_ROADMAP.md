# Renewal IQ Product Roadmap

## DONE
- Document upload
- PDF/DOCX/XLSX/CSV/TXT ingestion
- Normalized Risk Profile
- Vehicle schedule parsing
- Driver schedule parsing
- Conflict detection
- Missing field detection
- Submission Assistant prototype
- Carrier Appetite prototype

## CURRENT
Make document → Risk Profile extraction reliable enough for design partner testing.

Success criteria:
- questionnaire fields extract correctly
- driver names/experience extract correctly
- loss runs populate
- coverage requests populate
- conflicts are resolvable
- missing fields are actionable

## DONE (Carrier Appetite Intelligence — source-aware dataset)
- Replaced the fictional 16-market demo dataset with 8 real, named carriers/MGAs (Cover Whale,
  Canal Insurance Company, National Interstate, Progressive Commercial, Northland Insurance,
  Sentry, Prime Insurance, Great West Casualty), expanded into 16 program-level records where a
  company's programs have genuinely different eligibility (Canal Express/Fleet/DRIVEN/TestDrive;
  National Interstate General/Convoy/Group Captive/Venture/Voyager/National Accounts).
- Every appetite criterion is now individually VERIFIED (with sourceType/sourceName/sourceUrl/
  verifiedAt) or explicitly UNKNOWN — never invented. Fictional records moved to a clearly labeled,
  unimported test fixture (`data/__fixtures__/fictionalAppetiteRecords.ts`).
- Matching engine only fails a market on a verified hard-stop; unknown criteria reduce certainty
  (surfaced as "needs verification"), never count as a failure. New verdict tiers: Strong/Good/
  Possible Match, Needs More Information (too little verified data either side), Not Eligible
  (numeric score hidden, per product requirement).
- UI: market cards and the detail drawer show a verified-vs-needs-verification breakdown, a
  "Why this match?" checklist (✓ verified / ? not verified), per-criterion source viewer, and a
  standing disclaimer that appetite should be confirmed with the market before binding.

## DONE (Verified Batch 1 + Market Finder)
- Appetite criteria now carry a `ruleType` (HARD_RULE / TARGET / PREFERENCE / TYPICAL_RANGE /
  UNKNOWN) alongside a 4-state `verificationStatus` (VERIFIED / PARTIALLY_VERIFIED /
  NEEDS_CONFIRMATION / UNKNOWN). Only a VERIFIED HARD_RULE can produce NOT ELIGIBLE — a
  TARGET/PREFERENCE mismatch is a soft "Preference" signal, a TYPICAL_RANGE value (e.g. National
  Interstate's published average fleet sizes) is purely informational and never a floor/ceiling.
- Corrected the verified-batch-1 markets: Cover Whale modeled per-coverage (Auto Liability) rather
  than one universal appetite; Canal Express/Fleet/DRIVEN/TestDrive carry their real hard rules
  (fleet bands, CDL/OTR experience, DOT-number requirement, TestDrive's new-venture fleet ramp and
  years-in-business ceiling); Progressive's published operations list is a TARGET, not a hard
  exclusion list, so it no longer produces false declines.
- Numeric match-score percentages removed from the UI entirely — replaced by four statuses
  (Likely Match / Possible Match / Needs More Information / Not Eligible). Market cards show a
  compact Verified / Needs Verification checklist instead; the detail drawer groups every
  criterion into Matched / Failed / Needs Verification / Preferences with a per-criterion "View
  Source" (source name, type, rule type, last verified — no raw URLs by default).
- New global **Market Finder** page (`/market-finder`, sidebar between Dashboard and Analytics):
  brokers manually enter risk characteristics (state, fleet size, years in business, operation
  type, cargo, driver experience, telematics/dashcams, coverage needed) without creating a
  submission. Reuses the exact same `matchAllMarkets` engine and `MarketCard`/`MarketDetailDrawer`
  components as the account-specific Carrier Appetite page — no second matching engine, no
  duplicate schema. Not Eligible results are hidden by default with a toggle to reveal them.

## DONE (Submission Assistant — mapping, itemized tables, export)
- One comprehensive, realistic template — "Renewal IQ Transportation Application - Demo" —
  covering Business Information, Operations, Coverage Requested, and repeating Drivers/Vehicles/
  Loss History tables. Fields with no Risk Profile equivalent yet (DBA, City, ZIP, FEIN) are
  reported as missing/"enter manually" rather than guessed; replaces the two thin prototype
  templates from the earlier Submission Assistant prototype.
- `MappedFieldStatus` expanded from a 2-state mapped/needs_review split into five explicit states
  (AUTO_FILLED / MISSING / CONFLICT / MANUALLY_ENTERED / NEEDS_REVIEW), each rendered distinctly —
  no blanket "High Confidence" badges. Drivers/Vehicles/Loss History are real repeating-row tables
  (a generic `mapTableSection`, not three one-offs, and not flattened into text), with a derived
  "Unit Number" column proving deterministic transforms work for structural (not just factual)
  fields.
- Missing fields get an inline "Enter manually" + optional "Also save to Risk Profile" (persists
  through the existing `updateField`/`updateCoverage` store actions, preserving manual-entry
  provenance). Conflicting fields block silently auto-filling and link to a "Resolve in Risk
  Profile" deep link that reuses the existing FieldRow conflict resolver (now auto-expanding to
  the exact field) instead of duplicating it — resolving there updates the application
  automatically since it's derived from the same Risk Profile.
- Completion header (X% Complete, auto-filled/missing/conflict/needs-review counts, itemized rows
  mapped) via a new `computeApplicationStats` helper.
- Export: a real one-click "Download PDF" via `pdf-lib` (previously installed, unused) producing a
  paginated, professional-looking document — not just the browser print dialog (kept as a
  secondary "Print" action) — plus JSON and CSV export for debugging/testing.
- Tested against Blue Ridge (full auto-fill incl. vehicles/drivers/losses/coverage), MetroHaul
  (fleet-size and revenue conflicts correctly block only the affected fields and clear after
  resolving), and Sunrise (missing MC Number → manual entry → save-back; an unsupported coverage
  type present in the source doc, "Warehouse Legal Liability", is correctly never invented since
  the Risk Profile's CoverageType enum doesn't model it).

## DONE (Market Finder — live filtering)
- Removed the "Find Markets" button/staged-filter step — every filter change re-runs the same
  `matchAllMarkets` engine (via `buildProfileFromFilters`) immediately, with no second search
  implementation and no debounce needed given the small, fully client-side dataset.
- Before any filter is set, shows "Start by selecting any risk characteristic" plus a neutral,
  unscored "All Markets" directory (no verdict language) rather than a blank page or a misleading
  match against an empty risk profile.
- Active filters render as removable chips (state, fleet size, years in business/new venture,
  operation types, cargo terms, driver experience/age, telematics/dashcams, coverage) above the
  results; removing a chip re-filters immediately. A result-count line breaks down non-zero verdict
  groups (e.g. "6 Possible Match · 3 Needs More Information · 4 Not Eligible").
- `Not Eligible` results are shown directly (no hide-by-default toggle this round) so a filter
  change that flips a market to Not Eligible is immediately visible, per the product's live-search
  goal. Sort tiebreak switched from the internal match score to `verifiedMatchCount` (a plain
  count, never a percentage) — "more verified criteria" wins ties, literally.
- Filters live in page state (not staged), so opening/closing the market detail drawer already
  preserves them — no URL/routing work needed.

## DONE (Sunrise Freight regression — extraction/reconciliation reliability)
- Root-caused and fixed a real spreadsheet-parsing bug, not a fabrication bug: `Vehicle_Schedule.xlsx`
  used a single namespace prefix on every OOXML element (`<x:workbook>`, `<x:sheetData>`, …) instead
  of the unprefixed convention every major writer uses; exceljs's SAX matcher only recognizes
  unprefixed tag names, so the file silently parsed to zero sheets and `parseSpreadsheet` reported
  "no data." `parseSpreadsheet.ts` now repairs a failed load by stripping element-name namespace
  prefixes (via `jszip`, now a direct dependency) and retrying — attributes like `r:id` are untouched,
  and a normally-formed file never touches this path, so no other fixture's parsing changed.
- Fleet size vs. vehicle-schedule-count reconciliation was mostly already correct architecture (the
  vehicle-table extractor already derives `fleetSize` from the itemized row count, and the existing
  merge/conflict system already flags two disagreeing sources rather than silently picking one) — the
  reported "79" value did not reproduce against the real source files. Added a small
  `services/extraction/reconciliation.ts` (`buildFieldReconciliation`, `buildSubmissionWarnings`) that
  projects that same already-tracked provenance into the broker-facing warnings the product spec
  asked for, rather than a second tracking system.
- MC/DOT number coerce functions now run through an explicit `isValidIdentifier` format guard
  (digits-only, plausible length) as defense-in-depth on top of the regex that already required it;
  vehicle VIN cells are validated against the standard 17-character VIN format before acceptance.
  The reported "7t8g" MC-number fabrication did not reproduce against the real source files either —
  most likely an internal object id (`generateId()` produces exactly this shape) that leaked into an
  unrelated display in an earlier ad hoc test, not a document-extraction defect.
- Address parsing: a `Street, City, ST ZIP`-shaped `business.address` now also derives
  `business.city`/`business.zip` as their own tracked fields (new `addressPatterns.ts`), while the
  full raw address string is preserved unchanged. Verified on both Sunrise and the existing ABC
  Transportation fixture (bonus: ABC's address now populates City/ZIP too, previously always missing).
- Coverage: added `warehouse_legal_liability` as a real `CoverageType` (previously unmodeled by
  design); a current-policy coverage table rendered as one line per row in PDF text (no real table
  markup in a PDF) is now parsed into `coverage.<type>.currentLimit` via
  `extractCurrentPolicyCoverageLines`. The Submission Assistant template and PDF export now show
  **Current Policy Coverage** and **Requested Renewal Coverage** as two explicit sections instead of
  one conflated "Coverage Requested" list, so a current limit is never presented as the requested one.
  A coverage type the client explicitly requested but gave no dollar limit for now reads as
  "Requested — limit not specified" (with a distinct "new coverage, not on the current policy" reason
  when applicable) instead of an indistinguishable "Missing."
- New `RiskProfile`-level `warnings` surfaced on `MappedApplication` and rendered as a "Missing /
  Needs Review" section at the end of the generated PDF, deduplicated against per-field review
  reasons already shown earlier in the same document.
- Fixed an unrelated formatting bug surfaced by vehicles finally populating: the generic table-cell
  formatter was applying thousands-separator commas to the Vehicles table's Year column ("2,024").
- Regression-tested against the real 7-file Sunrise Freight & Warehousing LLC package end-to-end
  (upload → Risk Profile → Submission Assistant → PDF) and confirmed against every value in
  `EXPECTED_RESULTS.txt`; re-verified the ABC Transportation fixture end-to-end for no regression.
  `tsc -b`, `oxlint`, and `vite build` all clean; no console/runtime errors in either walkthrough.

## DONE (Appetite Update Request workflow — Supabase-backed, market-identity foundation)
- First real backend in this codebase: Supabase (public anon key only, browser-side; see
  `SUPABASE_SETUP.md`). Tables in `supabase/migrations/0001_appetite_update_workflow.sql`, RLS
  enabled — a broker can submit from their own device and have it land in a shared queue, closing
  the localStorage limitation the prior design had. **Correction (see the follow-up security-hardening
  entry below):** the RLS this table originally shipped with was too permissive (anon could read
  every submission and, in principle, write a live override directly) — the migration has since been
  rewritten with the tightened model described there, since it had never been applied to a live
  project.
- Kept the existing criterion-level architecture unchanged — `AppetiteCriterion<T>`,
  `CriterionSource`, `VerificationStatus`, `RuleType`, `CriterionHistoryEntry` are exactly as before.
- New market-identity foundation (`types/organization.ts`): `OrganizationKind`,
  `DistributionPartner`, `CarrierMarketRelationship` — additive only, no existing record migrated.
  `AppetiteRecord.availableThrough` is now explicitly `@deprecated` in favor of an optional
  `distributionPartnerId`, kept for backward compatibility.
- "Request Appetite Update" on every market's detail drawer (`RequestAppetiteUpdateForm.tsx`) —
  market/current-value auto-populate, 14 broker-facing field categories, required
  field/value/name/email, strongly-encouraged-not-required source URL. Never modifies live appetite;
  inserts a `pending` row and reports success only after Supabase confirms, or a clear "not
  submitted" message (never a false positive) on any failure including Supabase being unconfigured.
- `/admin/appetite-updates` (unlinked from nav, and — see below — actually access-controlled, not
  just hidden) reviews the open queue with Approve / Reject / Needs More Information. Every decision
  writes a durable `appetite_update_history` row, including rejections (never deleted). Approval
  additionally writes one `appetite_overrides` row — the admin explicitly confirms/edits the value
  to store and picks a verification status (never auto-VERIFIED; defaults to NEEDS_CONFIRMATION).
- Runtime effective appetite = base `carriers.ts` record + approved overrides, merged in
  `services/appetite/appetiteFieldKeys.ts` (`applyOverrides`) and loaded via a new
  `effectiveAppetiteRecords` store slice (`loadEffectiveAppetiteRecords`, excluded from localStorage
  persistence). `CarrierAppetitePage`, `MarketFinderPage`, and account-specific matching all read
  from it instead of the static import — base `carriers.ts` is never rewritten from the browser.
  10 of 14 broker-facing categories map to one real `AppetiteRecord` criterion; the 4 that don't yet
  (vehicle/submission requirements, distribution/MGA, other) apply to `underwritingNotes` instead of
  guessing a mismatched field.
- Existing `FeedbackWidget` untouched — still local-only, unrelated to this workflow.
- Verified: `tsc -b` / `oxlint` / `vite build` clean; no console errors; ABC Transportation's
  Carrier Appetite results and Market Finder are unchanged; the new form and admin page render
  correctly at 375px. The true Supabase-connected path (insert → admin read → approve → override
  applied) could not be exercised end-to-end in this environment — no Supabase project/credentials
  exist here, and none were invented; only the "Supabase not configured" degradation path was tested.

## DONE (Appetite Update workflow — RLS security hardening + admin auth)
- The first version of the migration above shipped with permissive interim RLS (anon could read
  every submitted request, and — the most serious gap — could write directly to
  `appetite_overrides`, bypassing admin review entirely). Since it had never been applied to a live
  project, `0001_appetite_update_workflow.sql` was rewritten in place rather than patched with a
  follow-up migration.
- Corrected model: anonymous brokers can INSERT `appetite_update_requests` and SELECT
  `appetite_overrides` — nothing else, on any table. Everything else (reading the request queue,
  reading/writing audit history, writing an override) requires a `user_id` present in a new
  `admin_users` table, checked via a `security definer` `is_admin()` helper used throughout RLS.
  Audit history has no update/delete policy for any role — genuinely append-only.
- Added Supabase Auth for the admin route only — no general broker account system.
  `services/supabase/adminAuth.ts` (sign-in/out, `checkIsAdmin()` via the `is_admin()` RPC) +
  `hooks/useAdminSession.ts` (`loading` / `not_configured` / `signed_out` / `unauthorized` / `admin`).
  `AdminAppetiteUpdatesPage` fetches request data only in the `admin` state — an unauthenticated
  visitor sees a sign-in form, a signed-in non-admin sees an explicit "not an admin" state, and
  neither ever triggers a data fetch. The database (RLS + `is_admin()`), not this client gate, is
  the actual authorization boundary. No sign-up UI exists in the app; admins are bootstrapped
  exclusively via the Supabase dashboard + a one-line SQL insert (`SUPABASE_SETUP.md`).
- Approval is now atomic: `review_appetite_update_request()`, a `security definer` Postgres
  function, re-checks `is_admin()` itself (the real authorization boundary the frontend relies on,
  not just RLS on the base tables) and performs the status update, history insert, and — on
  approval only — the `appetite_overrides` upsert as one transaction; `reviewed_by`/`submitted_by`
  are resolved server-side from `admin_users`/the request row, never trusted from the client, so a
  caller can't spoof who reviewed something. `appetiteUpdateService.reviewAppetiteUpdateRequest`
  now wraps this single RPC call instead of three sequential client-side writes.
- No service-role key anywhere, and none needed — every privileged write goes through RLS +
  `is_admin()` + the `security definer` RPC, never a key with elevated access sent to the browser.
- Verified via migration/policy review against all 24 specified cases (anon: submit-only + can only
  read approved overrides, nothing else; non-admin authenticated: no elevated access from being
  logged in alone; admin: full review flow, atomic writes; public app: overrides stay readable,
  `carriers.ts` untouched) — a real Supabase project to browser-test the full signed-in path against
  still doesn't exist in this environment; only the "not configured" and anonymous-submission paths
  were exercised live. `tsc -b` / `oxlint` / `vite build` clean; no console errors; Market Finder and
  Carrier Appetite unaffected.

## DONE (Admin auth UX: clearer sign-out/account-switching, forgot password)
- `/admin/appetite-updates` already correctly gated fetch on `status === 'admin'` and showed a
  signed-in-admin banner + sign-out button; the real gap was UX clarity and a missing password-reset
  path, not the underlying security model (unchanged).
- Sign-out now shows a transient "You've been signed out. Sign in with the same or a different admin
  account below." notice on the login form, so the sign-out → sign-in-as-someone-else flow (this
  app's entire "switch account" story, per product decision — no fake multi-account switcher) has a
  visible confirmation instead of silently reverting to a blank form.
- Non-admin copy corrected to the exact requested text ("You are signed in, but this account does
  not have admin access.") with the signed-in email shown separately underneath.
- Added "Forgot password?" → `requestPasswordReset()` (always the same generic confirmation,
  regardless of whether the address has an account — avoids turning it into an existence oracle) →
  emailed link returns via a new `password_recovery` session status (from Supabase's
  `PASSWORD_RECOVERY` auth event) → `ResetPasswordForm` calls `updateAdminPassword()`. Neither new
  function needs or uses the service-role key. Completing a reset requires one dashboard step
  (redirect URL allow-listing) — documented in `SUPABASE_SETUP.md` §6 rather than worked around.
- No RLS/migration changes — this pass is UI/client-auth-flow only.
- Verified: `tsc -b` / `oxlint` / `vite build` clean. Browser-tested the signed-out form, the
  forgot-password toggle (open/back), and a rejected sign-in attempt (clear error, form stays
  usable) against the real connected Supabase project. Full sign-in → admin banner → sign-out →
  re-sign-in cycle, and the non-admin/unauthorized state, could not be exercised live — no admin
  password is available in this session, and this sandbox's network policy blocks reaching Supabase
  anyway (same limitation as prior passes). Worth confirming these manually.

## DONE (Workbook reconciliation — Phase 1-3, staged import)

An internal market-intelligence workbook (never committed — see "Security" below) was reconciled
against the existing 16-record verified appetite dataset and imported in three explicitly-scoped
phases, per an approved staged-import plan. Nothing from this workbook was ever treated as
"verified" — every criterion it supplied is `NEEDS_CONFIRMATION` or `PARTIALLY_VERIFIED`, sourced
via a new `SourceType: 'INTERNAL_MARKET_LIST'`, and `ruleType` is never `'HARD_RULE'` on a
workbook-sourced criterion — so nothing from this pass can ever produce a hard decline
(`rules.ts`'s `isUsable`/`HARD_RULE` gating is unchanged and enforces this).

- **Phase 1 — Distribution model**: populated the previously-unused `DistributionPartner` /
  `CarrierMarketRelationship` architecture (`types/organization.ts`, additive from a prior pass)
  with 17 MGAs/wholesalers that had real appetite content behind them (`data/distributionPartners.ts`)
  and ~45 carrier↔MGA relationship rows, coverage-specific where the source was clear
  (`data/carrierMarketRelationships.ts`). Name-only MGA stubs with no coverage/appetite detail were
  skipped. A relationship can link to a specific `AppetiteRecord` (unambiguous) or a free-form
  `carrierId` when the source didn't say which specific program it applied to (Canal — see below).
  New `services/appetite/distribution.ts` looks these up for the UI; no carrier was duplicated
  because multiple MGAs distribute it.
- **Phase 2 — Existing markets reconciled**: Cover Whale, Northland, and Prime Insurance got
  additive-only updates (new distribution relationships, previously-`UNKNOWN` criteria filled in
  at `NEEDS_CONFIRMATION`, an appended unverified-notes line) — every existing `VERIFIED` criterion
  on all three is untouched.
- **Phase 3 — First new-market batch**: 10 new candidate records added
  (`data/newMarketCandidates.ts`, merged into `sampleAppetiteRecords` alongside the untouched
  verified batch, now in `data/carriers.ts`'s `verifiedAppetiteRecords`): Berkley Prime, Berkley
  Small (separate programs, not combined appetite, sharing only a "Berkley" parent label), IAT
  (explicitly *not* merged with the workbook's separate "IAT / Occidental / Harco" grouping — held
  back, noted instead), Nirvana, Crum & Forster (workbook's two spellings/sheets consolidated into
  one entity per the approved scope), NICO Fleet, NICO Schedule (separate programs under a shared
  NICO parent, appetite not combined), RLI, Carolina Casualty, and Third Coast.
- **Canal**: no new/duplicate carrier record. Workbook-observed MGA access (Maximum, Rocklake, RPS,
  Prime Agency, AMWINS) is linked at the carrier level via a free-form `carrierId`, not to any
  specific Express/Fleet/DRIVEN/TestDrive program, since the source didn't say which program each
  MGA path applies to.
- **Explicitly held back** (ambiguous — flagged for a later reconciliation pass rather than
  imported): Lloyds, Evolum, RPS Fleet Trucking, an ambiguous "Paramount" MGA/carrier entry,
  "IAT / Occidental / Harco" as a merged identity, "Star RRG"/"Starr RRG" as a merged identity,
  "XL Catlin"/"XL Group" as a merged identity, "Berkshire Hateway"/BHHC assumptions, and the
  "Navigator – Hartford Admitted" entity. The Licensed States sheet was excluded entirely — it read
  as an unfilled agency-licensing checklist, not per-carrier state data, and licensing ≠ appetite.
- **UI**: `MarketDetailDrawer` gained an "Available Through" section listing every distribution
  partner for a record (with coverage, when known) — explicitly labeled as unverified/internal and
  as distribution paths, never implying an MGA is the risk-bearing carrier. `MarketCard` shows a
  compact one-line summary tag only (e.g. "Available through Maximum +4 more") to avoid overcrowding
  the card grid; full detail lives in the drawer. `CriterionCard`/`SourcePanel` now render a third
  "Needs Confirmation" tier (amber, distinct from both the green verified state and the empty
  unknown state) so workbook-sourced values are visible with their (unverified) provenance instead
  of collapsing into "no source at all," which is now reserved for genuinely `UNKNOWN` criteria.
  Added `SOURCE_TYPE_LABELS` so no raw enum value (e.g. `INTERNAL_MARKET_LIST`) ever prints verbatim.
- **Request Appetite Update UX fix**: label changed to "What information needs updating?"; the
  "Other" category no longer shows a Current Value (previously silently fell back to
  `underwritingNotes`, which the form never should have surfaced as if it were the current value of
  a specific field) — it now shows a free-form "Tell us what needs updating" prompt with helper
  text, and always stores `currentValue: null`. Every other structured field with no data now
  reads "Not currently documented" instead of the internal `formatCriterion` sentinel or an
  underwriting-notes fallback.
- **Security**: the source workbook was never committed, copied into the repo, or referenced by
  filename in any public-facing string (internal code comments/`sourceName` values are generic,
  e.g. "Internal Market Intelligence List"). No passwords, portal credentials, producer/access
  codes, personal names, phone numbers, or contact emails from the source were imported anywhere —
  verified by a full-repo grep for the specific credential/domain/contact strings before commit.
- Verified: `tsc -b` / `oxlint` / `vite build` clean. Browser-tested Market Finder (26 records:
  16 verified + 10 new, all render, distribution/needs-confirmation UI correct), an existing
  reconciled record (Prime Insurance — Available Through, Major Exclusions, no VERIFIED criteria
  altered), and the Request Appetite Update form's new label + Other-field behavior.

## NEXT
- Admin/version-history UI for appetite criteria (schema already supports history; no UI yet)
- A later reconciliation pass for the ambiguous entities held back above (Lloyds, Evolum, RPS Fleet
  Trucking, Paramount, the IAT/Occidental/Harco merge question, Star RRG/Starr RRG, XL Catlin/XL
  Group, Berkshire Hateway/BHHC)
- A second real carrier/MGA application template, proving the Submission Assistant template
  architecture's reusability the same way the two prior demo templates once did

## LATER
- Real carrier/MGA APIs (appetite + application submission)
- Browser automation where APIs do not exist
- Authentication
- Production database
- Multi-user agency workflows
- Audit logs
