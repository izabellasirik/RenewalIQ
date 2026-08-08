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
