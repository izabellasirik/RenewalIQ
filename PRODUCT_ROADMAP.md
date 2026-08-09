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

## NEXT
Submission Assistant:
Risk Profile → target application field mapping → completed application export

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

## AFTER THAT
Carrier Appetite:
- Admin/version-history UI for appetite criteria (schema already supports history; no UI yet)
- Broker-submitted appetite updates
- Real carrier/MGA appetite APIs or PDF ingestion in place of manual verification

## LATER
- Real carrier/MGA APIs
- Browser automation where APIs do not exist
- Authentication
- Production database
- Multi-user agency workflows
- Audit logs
