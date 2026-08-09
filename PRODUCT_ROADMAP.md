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

## NEXT
- Admin/version-history UI for appetite criteria (schema already supports history; no UI yet)
- Broker-submitted appetite updates
- A second real carrier/MGA application template, proving the Submission Assistant template
  architecture's reusability the same way the two prior demo templates once did

## LATER
- Real carrier/MGA APIs (appetite + application submission)
- Browser automation where APIs do not exist
- Authentication
- Production database
- Multi-user agency workflows
- Audit logs
