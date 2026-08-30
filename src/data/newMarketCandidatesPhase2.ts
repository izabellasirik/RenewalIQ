import type { AppetiteRecord, CriterionSource, MarketType } from '../types';
import { source, needsConfirmationCriterion as nc, partiallyVerifiedCriterion as pv, unknownCriterion as u } from './appetiteCriteriaHelpers';

/**
 * Phase 2 of the "remaining workbook data" pass (see PRODUCT_ROADMAP.md) — the broad batch that
 * brings the app close to the full operational market list in the internal market-intelligence
 * source, following the same rules as Phase 3's first batch (data/newMarketCandidates.ts):
 * everything here is NEEDS_CONFIRMATION or PARTIALLY_VERIFIED, never VERIFIED; `ruleType` is never
 * 'HARD_RULE' on a workbook-sourced criterion, so nothing here can ever produce a hard decline
 * (see rules.ts `isUsable`/HARD_RULE gating); unstated criteria stay UNKNOWN rather than guessed;
 * qualitative notes ("clean accounts", "subject to UW") stay in underwritingNotes, never promoted
 * to a structured rule.
 *
 * This batch also resolves several entities the prior pass held as ambiguous, using only workbook
 * evidence:
 * - Star RRG / Starr RRG: one entity — the MGA-path row explicitly says "please see Star market
 *   summ[ary]" and the NY exclusion matches the direct-market rows exactly. Modeled as one direct
 *   carrier with additional MGA relationships.
 * - MTM / Motor Transport Mutual / "MTM NON direct": one entity with three access paths (direct,
 *   Maximum, Prime Agency).
 * - Universal Casualty RRG: one entity (direct + Maximum); a separate MGA-LIST-sheet row with the
 *   same name and no markets of its own reads as more appetite commentary about this same carrier,
 *   not a distinct MGA — folded into this record's notes instead of a new DistributionPartner.
 * - "Paramount (DB Insurance in TX only)" + ISC MGA's "DB Insurance, Agriculture" market: read
 *   together as one TX-only program — Paramount is the program name, DB Insurance the underlying
 *   carrier.
 * - Berkshire Hathaway: the workbook's "Berkshire Hateway" row is a clear typo, corrected in
 *   display only — the BHHC mention elsewhere is inside a *different* carrier's notes (Spinnaker
 *   Specialty), not evidence about this row, and is not used to infer anything about it.
 * - Navigator – Hartford Admitted: the workbook treats this as one single-row facility/program —
 *   modeled as one record, not split.
 *
 * Still explicitly NOT resolved/imported (kept exactly as held, or newly re-examined and still
 * held) — see the reconciliation report for the reason on each:
 * - Lloyds: no specific syndicate/facility identifiable, only a generic "Lloyds via Trinity" line.
 * - Evolum: resolved as a direct-market facility below (its own sheet placement, alongside other
 *   clearly-carrier rows, is the evidence) — kept minimal since appetite detail is thin.
 * - RPS Fleet Trucking: modeled as a note on the RPS DistributionPartner record, not a new carrier.
 * - XL Catlin / XL Group: kept as two separate records — the workbook gives them different MGAs and
 *   materially different appetite (a renewal fleet-size band vs. a hazmat minimum), with no explicit
 *   textual link between them, so no shared parent is asserted.
 * - IAT / Occidental / Harco: kept as its own separate record, not merged into the plain "IAT"
 *   record from Phase 3 — the workbook doesn't state a parent/subsidiary relationship, just two
 *   differently-named rows with different MGAs and different appetite detail.
 */

function workbookSource(): CriterionSource {
  return source('INTERNAL_MARKET_LIST', 'Internal Market Intelligence List');
}

type CriteriaFields = Pick<
  AppetiteRecord,
  | 'states'
  | 'fleetSize'
  | 'yearsInBusinessMin'
  | 'yearsInBusinessMax'
  | 'operationTypes'
  | 'maxRadius'
  | 'commodities'
  | 'minDriverAge'
  | 'minDriverExperienceYears'
  | 'telematicsRequired'
  | 'dashcamRequired'
  | 'dotNumberRequired'
  | 'majorExclusions'
  | 'maxClaimsPast3Years'
  | 'maxIncurredPerUnit'
  | 'linesOffered'
>;

function blankCriteria(): CriteriaFields {
  return {
    states: u(),
    fleetSize: u(),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: u(),
  };
}

/** Builds one new-candidate AppetiteRecord: every criterion starts UNKNOWN, only `overrides` are set. */
function record(
  base: { id: string; marketName: string; parentCompany: string; programName?: string; marketType: MarketType },
  overrides: Partial<CriteriaFields>,
  underwritingNotes: string
): AppetiteRecord {
  return { ...base, ...blankCriteria(), ...overrides, underwritingNotes };
}

export const newMarketAppetiteRecordsPhase2: AppetiteRecord[] = [
  // ---------------------------------------------------------------------------------------
  // Direct market sheet
  // ---------------------------------------------------------------------------------------
  record(
    { id: 'appetite_geico', marketName: 'Geico', parentCompany: 'Geico', marketType: 'direct' },
    {},
    'Personal/commercial auto direct portal per internal market list. The source lists "0" for both CDL experience and years-of-operation columns for this row — read as a placeholder/not-applicable rather than an actual zero-year floor, so no driver-experience criterion is set from it.'
  ),
  record(
    { id: 'appetite_star_rrg', marketName: 'Star RRG', parentCompany: 'Star RRG', marketType: 'direct' },
    {
      states: pv(
        { admitted: ['CA', 'GA', 'IL', 'IN', 'MD', 'NJ', 'OH', 'PA', 'TN', 'TX', 'WA'], excluded: ['NY'] },
        'TARGET',
        workbookSource(),
        'Internal note: does not accept NY drivers/owners.'
      ),
      minDriverExperienceYears: pv(1, 'TARGET', workbookSource()),
    },
    'Auto Liability only per internal market list. Also distributed via Maximum and Prime Agency (workbook spells this MGA-path row "Starr RRG" and cross-references "see Star market summ[ary]" — read as the same entity as the direct-market rows, not a separate carrier, given the matching NY exclusion).'
  ),
  record(
    { id: 'appetite_countyhall', marketName: 'Countyhall', parentCompany: 'Countyhall', marketType: 'direct' },
    { linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()) },
    'Auto Liability only per internal market list.'
  ),
  record(
    { id: 'appetite_mtm', marketName: 'MTM (Motor Transport Mutual)', parentCompany: 'Motor Transport Mutual', marketType: 'direct' },
    {
      fleetSize: pv({ min: 1 }, 'TARGET', workbookSource(), 'No stated ceiling.'),
      minDriverExperienceYears: pv(1, 'TARGET', workbookSource(), '1 year CDL, or 3 years non-driving transportation experience for a new-venture owner.'),
      majorExclusions: nc(['Dump Trucks', 'Dirt/Sand/Gravel', 'Household Goods', 'Public Transportation', 'Towing', 'Hazmat'], workbookSource()),
    },
    'Fully earned premium endorsement; no stated growth or mileage/radius restrictions. Has its own dedicated application per the source. Also distributed via Maximum ("MTM (Motor Transport Mutual)" — competitive on new-venture and distressed accounts) and via Prime Agency ("MTM NON direct" — described as an exclusive NY-state program) — treated as one carrier with three access paths, not three separate markets.',
  ),
  record(
    { id: 'appetite_aone', marketName: 'Aone', parentCompany: 'Aone', marketType: 'direct' },
    { linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()) },
    'Auto Liability only per internal market list. Has its own dedicated application per the source.'
  ),
  record(
    { id: 'appetite_tip_national', marketName: 'Tip National', parentCompany: 'Tip National', marketType: 'direct' },
    { minDriverExperienceYears: nc(2, workbookSource()) },
    'ELD required per internal market list.'
  ),
  record(
    { id: 'appetite_evolum', marketName: 'Evolum', parentCompany: 'Evolum', marketType: 'direct' },
    { majorExclusions: nc(['Car Haulers'], workbookSource(), 'Source states car haulers are no longer written.') },
    'Listed in the internal market list\'s direct-market section alongside other named carrier facilities — modeled here as a direct market on that basis. A separate mention elsewhere in the source lists Evolum by name with no markets/coverages of its own, consistent with it being a facility rather than a distributor of other carriers.'
  ),
  record(
    { id: 'appetite_universal_casualty_rrg', marketName: 'Universal Casualty RRG', parentCompany: 'Universal Casualty RRG', marketType: 'direct' },
    { linesOffered: nc(['Auto Liability'], workbookSource()) },
    'Per internal market list: writes UIIA business; described elsewhere in the source as recently writing a number of distressed accounts. Also distributed via Maximum. A separately-labeled "Universal Casualty (Non direct)" entry in the source (rate/UIIA commentary, no markets of its own) reads as more appetite context about this same carrier rather than a distinct MGA, and is folded in here rather than modeled as a new distribution partner.'
  ),
  record(
    { id: 'appetite_corgi_rrg', marketName: 'Corgi RRG', parentCompany: 'Corgi RRG', marketType: 'direct' },
    {},
    'Internal market list notes each account has its own individually negotiated application/terms — no common structured appetite is stated.'
  ),
  record(
    { id: 'appetite_southlake', marketName: 'Southlake', parentCompany: 'Southlake', marketType: 'mga' },
    {
      states: pv(
        { admitted: ['AL', 'AZ', 'CO', 'GA', 'IA', 'ID', 'IN', 'MI', 'MN', 'MO', 'NE', 'NJ', 'OH', 'OK', 'OR', 'PA', 'SD', 'TN', 'TX', 'VA', 'WA', 'WI'] },
        'TARGET',
        workbookSource(),
        'Admitted-state list for Auto Liability monoline specifically, per the Futuristic Underwriters distribution-path notes. A separate, differently-scoped state list applies to Physical Damage/Cargo on the same program — see underwritingNotes; not merged into this field to avoid conflating coverage-specific availability.'
      ),
      fleetSize: pv({ min: 1, max: 10 }, 'TARGET', workbookSource()),
      yearsInBusinessMin: pv(1, 'TARGET', workbookSource(), '1+ year of prior operating history required.'),
      minDriverExperienceYears: pv(2, 'TARGET', workbookSource(), 'Strict for accounts with only 1–2 years of operating history.'),
      telematicsRequired: pv(true, 'PREFERENCE', workbookSource(), 'Described as a 100% telematics-based program, mandatory for all fleet sizes when Auto Liability is requested.'),
      dashcamRequired: pv(true, 'PREFERENCE', workbookSource()),
      commodities: pv(['Dry Van', 'Reefer', 'Intermodal', 'Belly/Side Dumps', 'Sand/Gravel', 'Box Trucks', 'Cargo Vans', 'Hot Shots', 'Auto Haulers'], 'TARGET', workbookSource()),
      linesOffered: pv(['Auto Liability', 'Auto Physical Damage'], 'PREFERENCE', workbookSource(), 'Package policy — all lines written under one policy number per the source.'),
    },
    'Program administered through Futuristic Underwriters. Physical Damage/Cargo is separately stated as available in all states except AK, CA, KY, MA, NY, RI and UT (a different, broader footprint than the Auto Liability list above). Binding note: 1–10 unit accounts require Physical Damage to support Auto Liability (Cargo cannot substitute). Liability limits up to $1M ($1.5M in NJ). BORs not accepted.',
  ),
  record(
    { id: 'appetite_paramount_db', marketName: 'Paramount', parentCompany: 'DB Insurance', programName: 'Paramount', marketType: 'direct' },
    { states: pv({ admitted: ['TX'] }, 'TARGET', workbookSource(), 'Stated as Texas-only in two places in the internal market list (the direct-market entry and the ISC MGA distribution path).') },
    'Internal market list labels this program "Paramount," writing on DB Insurance paper, Texas-only. Also reachable through ISC MGA, whose own market list separately cites "DB Insurance, Agriculture" for the same TX-only Auto Liability footprint.'
  ),

  // ---------------------------------------------------------------------------------------
  // MGA market list AL sheet
  // ---------------------------------------------------------------------------------------
  record(
    { id: 'appetite_spinnaker_specialty', marketName: 'Spinnaker Specialty', parentCompany: 'Spinnaker Specialty', marketType: 'mga' },
    { dashcamRequired: pv(true, 'TARGET', workbookSource(), 'Recent successful placements required dash cams in all units.') },
    'Distributed via Maximum per internal market list. Notes describe recent success competing against Prime, NICO, Progressive and Berkshire Hathaway Homestate Companies (BHHC) — a competitive comparison, not evidence about any of those other carriers\' own records.'
  ),
  record(
    { id: 'appetite_safepoint', marketName: 'Safepoint', parentCompany: 'Safepoint', marketType: 'mga' },
    {
      dashcamRequired: pv(true, 'TARGET', workbookSource()),
      majorExclusions: nc(['Non-domiciled driver accounts'], workbookSource()),
    },
    'Distributed via Maximum per internal market list.'
  ),
  record(
    { id: 'appetite_ace_westchester', marketName: 'ACE / Westchester', parentCompany: 'ACE / Westchester', marketType: 'mga' },
    {},
    'Distributed via Maximum per internal market list. Notes describe roughly 20+ units for non-hazmat and 10+ for hazmat accounts — kept as underwriting guidance rather than a single structured fleet-size floor, since the threshold varies by commodity.'
  ),
  record(
    { id: 'appetite_aig', marketName: 'AIG', parentCompany: 'AIG', marketType: 'mga' },
    { fleetSize: pv({ min: 11 }, 'TARGET', workbookSource(), '"Very clean accounts" per the source — a qualitative note, not a numeric cleanliness rule.') },
    'Distributed via Maximum, CRC and RPS per internal market list.'
  ),
  record(
    { id: 'appetite_gemini_express', marketName: 'Gemini Express', parentCompany: 'Gemini Express', marketType: 'mga' },
    { fleetSize: pv({ min: 10, max: 40 }, 'TARGET', workbookSource(), 'For new business; the source notes this band includes private passenger vehicles owned by the fleet.') },
    'Distributed via Blue Ridge Specialty per internal market list.'
  ),
  record(
    { id: 'appetite_xl_catlin', marketName: 'XL Catlin', parentCompany: 'XL Catlin', marketType: 'mga' },
    { fleetSize: nc({ min: 5, max: 45 }, workbookSource(), 'Stated specifically for renewal customers per the source.') },
    'Distributed via Maximum per internal market list. Kept as a separate record from "XL Group" (below) — different MGA and different stated appetite; the source does not state a parent/program relationship between them.'
  ),
  record(
    { id: 'appetite_xl_group', marketName: 'XL Group', parentCompany: 'XL Group', marketType: 'mga' },
    { fleetSize: pv({ min: 20 }, 'TARGET', workbookSource(), 'Writes hazardous-material risks per the source, with a 20+ unit minimum.') },
    'Distributed via RPS per internal market list. Kept as a separate record from "XL Catlin" (above) — different MGA and different stated appetite; the source does not state a parent/program relationship between them.'
  ),
  record(
    { id: 'appetite_arch', marketName: 'Arch', parentCompany: 'Arch', marketType: 'mga' },
    { yearsInBusinessMin: pv(3, 'TARGET', workbookSource()) },
    'Distributed via Maximum, NEEE, RPS and Prime Agency per internal market list. Notes: no new ventures for accounts with 500+ mile radius (must have 1+ year in business); no new-venture Fuel or Milk Haulers; minimum 10% hazmat mix for consideration; will only write excess over itself.'
  ),
  record(
    { id: 'appetite_aife', marketName: 'AIFE', parentCompany: 'AIFE', marketType: 'mga' },
    { fleetSize: pv({ min: 10 }, 'TARGET', workbookSource()) },
    'Distributed via Maximum per internal market list. Auto Liability must be packaged with Auto Physical Damage — APD is required in order to quote AL. Prefers mileage- or revenue-based monthly reporting policies.'
  ),
  record(
    { id: 'appetite_munich', marketName: 'Munich', parentCompany: 'Munich Re', marketType: 'mga' },
    {
      fleetSize: pv({ min: 40 }, 'TARGET', workbookSource()),
      telematicsRequired: pv(true, 'TARGET', workbookSource(), 'Requires telematics data sharing.'),
      dashcamRequired: pv(true, 'TARGET', workbookSource(), 'Requires both inward- and outward-facing cameras.'),
    },
    'Distributed via Maximum per internal market list.'
  ),
  record(
    { id: 'appetite_liberty_mutual', marketName: 'Liberty Mutual', parentCompany: 'Liberty Mutual', marketType: 'mga' },
    {
      commodities: nc(['Artisan Contractors', 'Landscapers'], workbookSource()),
      states: nc({ excluded: ['NY', 'CA'] }, workbookSource(), '"Wants clean accounts" per the source — a qualitative note, not encoded as a structured criterion.'),
    },
    'Distributed via Maximum per internal market list.'
  ),
  record(
    { id: 'appetite_interline_insurance', marketName: 'Interline Insurance', parentCompany: 'Interline Insurance', marketType: 'mga' },
    { states: pv({ admitted: ['CA', 'OR', 'NV', 'AZ', 'WA'] }, 'TARGET', workbookSource(), 'Account must be based in, and not travel outside, this state list per the source.') },
    'Distributed via Maximum per internal market list. Notes: no CAB alerts allowed.'
  ),
  record(
    { id: 'appetite_suyra_rrg', marketName: 'Suyra RRG', parentCompany: 'Suyra RRG', marketType: 'mga' },
    { commodities: nc(['Limousines', 'Passenger Vans (up to 7 passengers)'], workbookSource()) },
    'Distributed via Maximum per internal market list. Described as a public livery market, newly added per the source.'
  ),
  record(
    { id: 'appetite_national_general_incline', marketName: 'National General / Incline', parentCompany: 'National General / Incline', marketType: 'mga' },
    {},
    'Distributed via Blue Ridge Specialty per internal market list, described only as writing "all size/types of business" — no numeric appetite is stated in the source.'
  ),
  record(
    { id: 'appetite_freberg', marketName: 'Freberg', parentCompany: 'Freberg', marketType: 'mga' },
    { linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()), commodities: nc(['Hazmat'], workbookSource()) },
    'Distributed via CRC and NEEE per internal market list.'
  ),
  record(
    { id: 'appetite_starwind', marketName: 'Starwind', parentCompany: 'Starwind', marketType: 'mga' },
    { linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()) },
    'Distributed via CRC per internal market list, described there as an exclusive market of CRC.'
  ),
  record(
    { id: 'appetite_berkshire_hathaway', marketName: 'Berkshire Hathaway', parentCompany: 'Berkshire Hathaway', marketType: 'mga' },
    { linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()) },
    'Distributed via CRC per internal market list. Source spells this row "Berkshire Hateway" — corrected here as a display typo only; no further appetite detail is stated for this row, and no assumption is made linking it to the separate "BHHC" mention that appears only inside Spinnaker Specialty\'s notes.'
  ),
  record(
    { id: 'appetite_knight_insurance', marketName: 'Knight Insurance', parentCompany: 'Knight Insurance', marketType: 'mga' },
    {
      minDriverAge: pv(23, 'TARGET', workbookSource(), 'Drivers 65+ must provide a DOT medical report per the source.'),
      minDriverExperienceYears: pv(2, 'TARGET', workbookSource()),
      commodities: nc(['Truck Tractors', 'Box Trucks', 'Vans'], workbookSource()),
    },
    'Distributed via CRC and Prime Agency per internal market list. Trucks over 20 years old may be considered with a mechanic\'s statement. New ventures allowed with 2+ years driving experience (5+ years for non-driving management experience). No stated fleet-size or mileage restriction.'
  ),
  record(
    { id: 'appetite_allied_rivington', marketName: 'Allied / Rivington', parentCompany: 'Allied / Rivington', marketType: 'mga' },
    {
      fleetSize: pv({ max: 11 }, 'TARGET', workbookSource()),
      yearsInBusinessMin: pv(3, 'TARGET', workbookSource()),
    },
    'Distributed via RPS per internal market list. Rivington\'s own application is required. Last-mile-delivery risks are written non-admitted; Amazon-related business requires admitted paper.'
  ),
  record(
    { id: 'appetite_amcom', marketName: 'Amcom', parentCompany: 'Amcom', marketType: 'mga' },
    {
      fleetSize: pv({ min: 5, max: 20 }, 'TARGET', workbookSource()),
      maxRadius: nc('300 miles', workbookSource(), 'Stated specifically for Sand and Gravel operations.'),
      majorExclusions: nc(['Passenger', 'Towing', 'Oversize/Overweight', 'Fuel', 'Livestock', 'Hazmat', 'Moving Companies', 'Municipal Vehicles'], workbookSource()),
    },
    'Distributed via RPS per internal market list.'
  ),
  record(
    { id: 'appetite_dual_transportation', marketName: 'Dual Transportation', parentCompany: 'Dual Transportation', marketType: 'mga' },
    {
      minDriverExperienceYears: nc(1, workbookSource(), 'New ventures are described as acceptable at this experience level.'),
      majorExclusions: nc(['Hazmat', 'Towing', 'Garage', 'B1 Drivers', 'Truck Driving Schools', 'Public Auto'], workbookSource()),
      states: pv({ admitted: ['TX', 'CA'] }, 'TARGET', workbookSource(), 'Source notes this footprint is "for now."'),
    },
    'Distributed via RPS and Maximum per internal market list. Considers distressed risks, including new ventures. Writes Tractors, Box Trucks, Sprinter Vans, Intermodal, Moving Companies and Ag Haulers, local/intermediate radius, non-admitted.'
  ),
  record(
    { id: 'appetite_leeo', marketName: 'Leeo', parentCompany: 'Leeo', marketType: 'mga' },
    { commodities: nc(['Light Business Auto/Service', 'Artisan Contractors', 'Last Mile', 'NEMT'], workbookSource()) },
    'Distributed via RPS per internal market list.'
  ),
  record(
    { id: 'appetite_navigator_hartford', marketName: 'Navigator – Hartford Admitted', parentCompany: 'Navigator', programName: 'Hartford Admitted', marketType: 'mga' },
    {
      fleetSize: pv({ min: 10 }, 'TARGET', workbookSource()),
      commodities: nc(['Trucking', 'Contractors', 'Dumps', 'Energy', 'Retail', 'Wholesale', 'Hospitality', 'Waste & Recycle'], workbookSource()),
    },
    'Distributed via USR and RPS per internal market list, on Hartford admitted paper. Also considers distressed trucking and auto accounts. Modeled as one single program per the source, which treats it as one row rather than splitting Navigator and Hartford apart.'
  ),
  record(
    { id: 'appetite_iat_occidental_harco', marketName: 'IAT / Occidental / Harco', parentCompany: 'IAT / Occidental / Harco', marketType: 'mga' },
    { yearsInBusinessMin: pv(3, 'TARGET', workbookSource()) },
    'Distributed via RPS and AMWINS per internal market list, exclusive to RPS Fair Lawn (NJ). Up to $2M Auto Liability available generally, $1.5M in NJ. Kept as its own record, deliberately separate from the plain "IAT" record — the source does not state that IAT is a parent group with Occidental/Harco as subsidiary programs, just two differently-named rows with different MGAs and appetite detail.'
  ),
  record(
    { id: 'appetite_texas_insurance_company', marketName: 'Texas Insurance Company', parentCompany: 'Texas Insurance Company', marketType: 'direct' },
    {
      linesOffered: pv(['Auto Liability', 'Auto Physical Damage', 'Motor Truck Cargo', 'General Liability'], 'PREFERENCE', workbookSource(), 'Auto Liability up to $5M CSL; GL at 1M/2M or 2M/4M.'),
      commodities: nc(['Livery', 'Box Truck'], workbookSource(), 'Per the Cluett distribution path.'),
    },
    'Described as a very broad appetite per internal market list, with broad driver and vehicle acceptability and new ventures allowed. Typical quote turnaround cited as 1-2+ weeks, so submissions should go in ahead of the effective date. Distributed via Prime Agency and via Cluett (the Cluett path separately notes Florida risks should instead go through MTM\'s direct facility — see appetite_mtm).'
  ),

  // ---------------------------------------------------------------------------------------
  // NTL APD MGA sheet
  // ---------------------------------------------------------------------------------------
  record(
    { id: 'appetite_adriatic', marketName: 'Adriatic Ins Co', parentCompany: 'Adriatic Ins Co', marketType: 'direct' },
    {
      states: pv(
        { admitted: ['NJ', 'NY', 'PA', 'TX', 'SC', 'NC', 'OH', 'GA', 'MN', 'IL', 'NE', 'WI'] },
        'TARGET',
        workbookSource(),
        'One trailing fragment in the source state list was garbled/unparseable and is excluded here rather than guessed at.'
      ),
    },
    'Also distributed via JMI, Bass Underwriters and Morstan General Agency per internal market list. Minimum license experience is stated on a value-tiered scale (roughly 6 months for stated values under $80,000, 1 year for $80,000–$99,999, 3 years for $100,000+), with a separate 2-year minimum for any dump/refuse operation regardless of value — kept as underwriting guidance rather than a single structured driver-experience number, since the requirement varies by stated value.'
  ),
  record(
    { id: 'appetite_highlander_specialty', marketName: 'Highlander Specialty', parentCompany: 'Highlander Specialty', marketType: 'mga' },
    {
      linesOffered: pv(['Auto Physical Damage'], 'PREFERENCE', workbookSource(), 'Monoline APD per the source.'),
      minDriverExperienceYears: nc(1, workbookSource()),
    },
    'Distributed via Trinity Underwriters per internal market list.'
  ),
  record(
    { id: 'appetite_fortegra', marketName: 'Fortegra', parentCompany: 'Fortegra', marketType: 'mga' },
    {},
    'Distributed via Trinity Underwriters per internal market list. No coverage or appetite detail beyond the distribution relationship is stated in the source.'
  ),
  record(
    { id: 'appetite_geico_marine', marketName: 'Geico Marine Ins Co', parentCompany: 'Geico Marine Ins Co', marketType: 'direct' },
    {},
    'Internal market list shows this written directly rather than through a third-party MGA. Coverage is listed only as "Package" without itemizing which lines — not expanded here to avoid asserting unstated coverages.'
  ),
  record(
    { id: 'appetite_trisura_specialty', marketName: 'Trisura Specialty', parentCompany: 'Trisura Specialty', marketType: 'mga' },
    { minDriverExperienceYears: pv(2, 'TARGET', workbookSource()) },
    'Distributed via Prime Agency per internal market list. Coverage is listed only as "Package" without itemizing which lines — not expanded here to avoid asserting unstated coverages.'
  ),
  record(
    { id: 'appetite_great_lakes', marketName: 'Great Lakes', parentCompany: 'Great Lakes', marketType: 'mga' },
    {
      linesOffered: pv(['Auto Physical Damage'], 'PREFERENCE', workbookSource(), 'Monoline APD per the source.'),
      minDriverExperienceYears: pv(2, 'TARGET', workbookSource()),
    },
    'Distributed via RPS, Maximum and Trinity Underwriters per internal market list. Source notes a lower rate may be available depending on driver criteria.'
  ),
];
