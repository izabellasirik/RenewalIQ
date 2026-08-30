import type { AppetiteRecord, CriterionSource } from '../types';
import { source, verifiedCriterion as v, unknownCriterion as u, needsConfirmationCriterion as nc } from './appetiteCriteriaHelpers';
import { newMarketAppetiteRecords } from './newMarketCandidates';
import { newMarketAppetiteRecordsPhase2 } from './newMarketCandidatesPhase2';

/**
 * Internal-market-list provenance for the Phase 2 additive reconciliation below (Cover Whale,
 * Northland, Prime Insurance). Every criterion built with this source uses `nc()`
 * (NEEDS_CONFIRMATION) rather than `v()` — this workbook was never an officially-verified source,
 * so nothing it supplies is allowed to overwrite or masquerade as a VERIFIED fact. See
 * PRODUCT_ROADMAP.md — "Phase 2: Existing Markets".
 */
function internalList(): CriterionSource {
  return source('INTERNAL_MARKET_LIST', 'Internal Market Intelligence List');
}

/**
 * Source-aware appetite dataset for real, named trucking markets. Every criterion is either
 * VERIFIED (with a source and a ruleType) or explicitly UNKNOWN — nothing here is an invented
 * rule. Facts came from each market's own published program materials; where a market doesn't
 * publish a specific number, the criterion is left UNKNOWN rather than guessed.
 *
 * ruleType matters as much as the value itself:
 * - HARD_RULE: an explicit eligibility requirement — violating it is a verified decline.
 * - TARGET / PREFERENCE: published appetite that isn't stated as an absolute cutoff — a mismatch
 *   is a soft signal to confirm, never a hard decline.
 * - TYPICAL_RANGE: a published average/typical account description (e.g. "average fleet: 25-75
 *   units") — informational only, never used as an eligibility floor/ceiling.
 *
 * `verifiedAt` reflects the date this record was checked into Renewal IQ; each market's own
 * "last updated" date (sourcePublishedAt) isn't independently known, so it's left unset rather
 * than assumed to match verifiedAt.
 *
 * Multi-program/coverage companies (Cover Whale, Canal, National Interstate) are represented as
 * one AppetiteRecord per program or coverage rather than one merged record, since their
 * eligibility criteria genuinely differ — collapsing them would misrepresent which program an
 * account actually fits.
 */
const VERIFIED_AT = '2026-08-09';

function official(sourceName: string, sourceUrl?: string) {
  return source('OFFICIAL', sourceName, { verifiedAt: VERIFIED_AT, sourceUrl });
}

/** The original hand-researched, officially-sourced batch — unchanged in shape/count (16 records). */
const verifiedAppetiteRecords: AppetiteRecord[] = [
  // ---------------------------------------------------------------------------------------
  // Cover Whale — modeled per-coverage rather than one universal appetite. Auto Liability is
  // the only coverage with verified public rules captured so far; APD/Motor Truck Cargo/NTL/GL
  // may carry different fleet-size targets and are intentionally NOT modeled here until verified.
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_coverwhale_al',
    marketName: 'Cover Whale — Auto Liability',
    parentCompany: 'Cover Whale',
    programName: 'Auto Liability',
    marketType: 'mga',
    states: u('Cover Whale publishes admitted/non-admitted availability by state, and it is coverage-specific — the Auto Liability state list is not yet captured in Renewal IQ.'),
    fleetSize: v({ min: 1, max: 25 }, 'TARGET', official('Cover Whale Appetite Guidelines'), 'Published target fleet size at bind, not stated as a hard eligibility cutoff.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: v(2, 'HARD_RULE', official('Cover Whale Appetite Guidelines'), 'Minimum 2 years driving experience with a like vehicle.'),
    telematicsRequired: nc(true, internalList(), 'Internal market list separately notes ELD is required for this coverage — not independently confirmed against Cover Whale\'s own published guidelines, so kept at NEEDS_CONFIRMATION rather than folded into the verified dashcam/ELD-connectivity rule below.'),
    dashcamRequired: v(true, 'HARD_RULE', official('Cover Whale Appetite Guidelines'), 'Dashcam / ELD connectivity required for Auto Liability.'),
    dotNumberRequired: u(),
    majorExclusions: u('Cover Whale publishes excluded trucking classes/operations; the specific list is not yet captured in Renewal IQ.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability'], 'PREFERENCE', official('Cover Whale Appetite Guidelines'), 'APD, Motor Truck Cargo, NTL and GL are separate Cover Whale coverages with their own appetite, not modeled here yet.'),
    underwritingNotes:
      'Vehicle-age restrictions are published (tractors/trailers generally must be newer than roughly 20 years under current guidelines) — treat as informational pending a dedicated vehicle-age field. Direct agency appointment is available. Other Cover Whale coverages (APD, Motor Truck Cargo, NTL, GL) may support different fleet-size targets and are not collapsed into this record.',
  },

  // ---------------------------------------------------------------------------------------
  // Canal Insurance Company — 4 distinct programs, kept as separate records on purpose
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_canal_express',
    marketName: 'Canal Express',
    parentCompany: 'Canal Insurance Company',
    programName: 'Express',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 1, max: 10 }, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'Canal Express program band: 1–10 power units.'),
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
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], 'PREFERENCE', official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'Transportation/trucking program distributed through select general agents.',
  },
  {
    id: 'appetite_canal_fleet',
    marketName: 'Canal Fleet',
    parentCompany: 'Canal Insurance Company',
    programName: 'Fleet',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 11 }, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'Canal Fleet program band: designed for fleets with 11+ power units (no published ceiling).'),
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
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], 'PREFERENCE', official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'Transportation/trucking program distributed through select general agents. State, driver-age and years-in-business criteria are not independently verified — do not assume restrictions beyond the fleet-size floor.',
  },
  {
    id: 'appetite_canal_driven',
    marketName: 'Canal DRIVEN',
    parentCompany: 'Canal Insurance Company',
    programName: 'DRIVEN',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ max: 30 }, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'DRIVEN program ceiling: up to 30 units.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: v(2, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'All drivers must hold a Class A CDL with a minimum 2 years OTR experience.'),
    telematicsRequired: v(true, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'Eligible telematics device required.'),
    dashcamRequired: u(),
    dotNumberRequired: v(true, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'DOT number required or in process.'),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], 'PREFERENCE', official('Canal Insurance Company — Program Materials')),
    underwritingNotes:
      'Units must be model year 2000 or newer — treat as informational pending a dedicated vehicle-age field. Distributed through select general agents. Missing driver CDL/OTR experience data reads as "needs verification," not a decline.',
  },
  {
    id: 'appetite_canal_testdrive',
    marketName: 'Canal TestDrive',
    parentCompany: 'Canal Insurance Company',
    programName: 'TestDrive',
    marketType: 'direct',
    states: u(),
    fleetSize: v(
      { max: 4 },
      'HARD_RULE',
      official('Canal Insurance Company — Program Materials'),
      'New-venture program: starts at up to 2 trucks, can grow to a maximum of 4 units during the first policy year. Modeled here against the first-year ceiling of 4.'
    ),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: v(2, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), "TestDrive is Canal's dedicated new-venture program: operation must be under 2 years in business."),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: v(2, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'Minimum 2 years CDL experience required.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: v(true, 'HARD_RULE', official('Canal Insurance Company — Program Materials'), 'DOT number required.'),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], 'PREFERENCE', official('Canal Insurance Company — Program Materials')),
    underwritingNotes:
      'Truck model year must be 2000 or newer — treat as informational pending a dedicated vehicle-age field. New-venture program with its own separate criteria from Express/Fleet/DRIVEN. Distributed through select general agents.',
  },

  // ---------------------------------------------------------------------------------------
  // National Interstate — 6 distinct programs, kept as separate records on purpose
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_ni_general',
    marketName: 'National Interstate — General Trucking',
    parentCompany: 'National Interstate',
    programName: 'General Trucking',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 5 }, 'HARD_RULE', official('National Interstate — Program Materials'), 'General trucking program targets well-managed local-to-intermediate for-hire fleets of 5+ units.'),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },
  {
    id: 'appetite_ni_convoy',
    marketName: 'National Interstate — Convoy',
    parentCompany: 'National Interstate',
    programName: 'Convoy',
    marketType: 'direct',
    states: u(),
    fleetSize: v(
      { min: 25, max: 75 },
      'TYPICAL_RANGE',
      official('National Interstate — Program Materials'),
      "Convoy's published average fleet size is 25–75 units — a description of accounts typically written, never an eligibility minimum/maximum."
    ),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },
  {
    id: 'appetite_ni_captive',
    marketName: 'National Interstate — Group Captive',
    parentCompany: 'National Interstate',
    programName: 'Group Captive',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 20 }, 'HARD_RULE', official('National Interstate — Program Materials'), 'Group Captive program: 20+ units.'),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },
  {
    id: 'appetite_ni_venture',
    marketName: 'National Interstate — Venture',
    parentCompany: 'National Interstate',
    programName: 'Venture',
    marketType: 'direct',
    states: u(),
    fleetSize: v(
      { min: 30, max: 100 },
      'TYPICAL_RANGE',
      official('National Interstate — Program Materials'),
      "Venture's published average fleet size is 30–100 units — a description of accounts typically written, never an eligibility minimum/maximum."
    ),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },
  {
    id: 'appetite_ni_voyager',
    marketName: 'National Interstate — Voyager',
    parentCompany: 'National Interstate',
    programName: 'Voyager',
    marketType: 'direct',
    states: u(),
    fleetSize: v(
      { min: 100, max: 300 },
      'TYPICAL_RANGE',
      official('National Interstate — Program Materials'),
      "Voyager's published average fleet size is 100–300 units — a description of accounts typically written, never an eligibility minimum/maximum."
    ),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },
  {
    id: 'appetite_ni_nationalaccounts',
    marketName: 'National Interstate — National Accounts',
    parentCompany: 'National Interstate',
    programName: 'National Accounts',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 250 }, 'HARD_RULE', official('National Interstate — Program Materials'), 'National Accounts program: 250+ units.'),
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
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
      'PREFERENCE',
      official('National Interstate — Program Materials')
    ),
    underwritingNotes: 'Some National Interstate programs are distributed through an exclusive producer network.',
  },

  // ---------------------------------------------------------------------------------------
  // Progressive Commercial
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_progressive',
    marketName: 'Progressive Commercial',
    parentCompany: 'Progressive Commercial',
    marketType: 'direct',
    states: v(
      {
        admitted: [
          'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
          'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
          'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
          'VA', 'WA', 'WV', 'WI', 'WY',
        ],
      },
      'HARD_RULE',
      official('Progressive Commercial — Trucking Coverage Pages'),
      'Commercial truck coverage across all 50 states.'
    ),
    fleetSize: u('Progressive does not publish an exact fleet minimum/maximum.'),
    yearsInBusinessMin: u('Progressive does not publish a years-in-business threshold.'),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: v(
      ['General Freight', 'Agriculture', 'Car Hauling', 'Dirt/Sand/Gravel', 'Expeditors', 'Logging/Timber', 'Household Movers', 'Towing', 'Intermodal'],
      'TARGET',
      official('Progressive Commercial — Trucking Coverage Pages'),
      "Publicly listed operations Progressive supports — a published target, not an exhaustive hard-eligibility list. Public appetite does not provide enough detail to treat cargo mismatches as a decline."
    ),
    minDriverAge: u('Progressive does not publish an exact driver-age threshold.'),
    minDriverExperienceYears: u('Progressive does not publish an exact driver-experience threshold.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Cargo', 'Physical Damage'], 'PREFERENCE', official('Progressive Commercial — Trucking Coverage Pages')),
    underwritingNotes:
      'Supports owner-operators, motor carriers and private carriers. Public appetite does not provide enough detailed thresholds for fleet-size, years-in-business, or driver-experience — these read as Needs Verification, not a decline.',
  },

  // ---------------------------------------------------------------------------------------
  // Northland Insurance (a Travelers company)
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_northland',
    marketName: 'Northland Insurance',
    parentCompany: 'Northland Insurance',
    marketType: 'direct',
    states: u(),
    fleetSize: u('Northland does not publish fleet-size thresholds. Internal market list separately cites both a 10+ unit floor (USR/CRC/RPS distribution path) and a 1+ unit floor (AMWINS/RPS path) — kept unset here rather than picking one, since the two paths appear to describe different target segments; see underwritingNotes.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: nc(['Dry Freight', 'Intermodal', 'Flatbed', 'Reefer', 'Dumps'], internalList(), 'USR/CRC/RPS distribution-path note; not independently confirmed against Northland\'s own published guidelines.'),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: nc(['NYC (5 boroughs)'], internalList(), 'USR/CRC/RPS distribution-path note.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Truckers General Liability', 'Motor Truck Cargo', 'Physical Damage'],
      'PREFERENCE',
      official('Northland Insurance — Trucking Program Materials')
    ),
    underwritingNotes:
      'A Travelers company. Dedicated trucking insurer serving owner-operators and fleet businesses through commercial fleet and owner-operator programs. Distributed through transportation agents/general agents.\n[Internal market list — unverified]: also available through USR, CRC, RPS and AMWINS; additional notes describe "really clean accounts," an aversion to high IFTA counts, a requirement that all drivers hold a commercial license, and (on the AMWINS/RPS path) that a strong driver pool matters more than a specific unit count.',
  },

  // ---------------------------------------------------------------------------------------
  // Sentry
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_sentry',
    marketName: 'Sentry',
    parentCompany: 'Sentry',
    marketType: 'direct',
    states: u('Sentry does not publish a state-appetite list.'),
    fleetSize: u('Sentry describes its trucking appetite as owner-operators through large fleets, with no published numeric range.'),
    yearsInBusinessMin: u('Sentry does not publish a years-in-business threshold.'),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u('Sentry does not publish a driver-age threshold.'),
    minDriverExperienceYears: u(),
    telematicsRequired: v(false, 'PREFERENCE', official('Sentry — Trucking Program Materials'), 'Optional — telematics participation may provide a discount, not a requirement.'),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo', 'General Liability'], 'PREFERENCE', official('Sentry — Trucking Program Materials')),
    underwritingNotes: 'Trucking product distributed only through appointed agencies specializing in trucking.',
  },

  // ---------------------------------------------------------------------------------------
  // Prime Property & Casualty / Prime Insurance
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_prime',
    marketName: 'Prime Insurance',
    parentCompany: 'Prime Property & Casualty Insurance Company',
    marketType: 'direct',
    states: v(
      {
        admitted: ['FL', 'IL', 'KS', 'KY', 'MA', 'NC', 'NJ', 'NM', 'NV', 'SC'],
        excluded: ['NY', 'HI', 'CT', 'DE'],
      },
      'HARD_RULE',
      official('Prime Insurance — Commercial Auto Program Materials'),
      'Admitted commercial auto in the listed states; primary Commercial Auto is not offered in NY, HI, CT, DE. Coverage availability varies by state — states in neither list are not confirmed either way.'
    ),
    fleetSize: u(),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: v(
      ['Long Haul', 'Short Haul', 'Fleets', 'Tow Trucks', 'Logging Trucks', 'Car Transporters'],
      'TARGET',
      official('Prime Insurance — Commercial Auto Program Materials'),
      'Operations Prime states it will consider for difficult/hard-to-place commercial trucking risks — a published target, not an exhaustive hard-eligibility list.'
    ),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: nc(['Non-domiciled CDL drivers', 'Temp CDL drivers'], internalList(), 'Internal market list states Prime no longer provides insurance for these driver categories, effective November 2025 per the source — not independently confirmed against Prime\'s own published guidelines.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: u(),
    underwritingNotes:
      'Writes difficult/hard-to-place commercial trucking risks. Prime states it may consider risks with losses, substandard DOT scores and MVR issues — this is a stated willingness to review flexibly, not a guarantee of eligibility.\n[Internal market list — unverified]: also available through Maximum and Prime Agency (a wholesale MGA distinct from this carrier). Notes describe no growth limitation, collateral of $3,000–$5,000 on top of down payment, UIIA eligibility, and that new ventures are allowed.',
  },

  // ---------------------------------------------------------------------------------------
  // Great West Casualty Company
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_greatwest',
    marketName: 'Great West Casualty Company',
    parentCompany: 'Great West Casualty Company',
    marketType: 'direct',
    states: u('Detailed state appetite not yet verified.'),
    fleetSize: u('Detailed fleet-size criteria not yet verified.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u('Detailed radius/operation-type criteria not yet verified.'),
    maxRadius: u('Detailed radius/operation-type criteria not yet verified.'),
    commodities: u('Detailed cargo appetite not yet verified.'),
    minDriverAge: u('Detailed driver criteria not yet verified.'),
    minDriverExperienceYears: u('Detailed driver criteria not yet verified.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Cargo', 'General Liability'], 'PREFERENCE', official('Great West Casualty Company — Trucking Program Materials')),
    underwritingNotes: 'Dedicated trucking insurer with trucking-focused risk control and claims expertise. Detailed fleet, state, radius, cargo and driver criteria remain unverified pending direct confirmation.',
  },
];

/**
 * Full appetite dataset: the verified base batch, plus the first new-market batch
 * (./newMarketCandidates.ts), plus the broader "remaining workbook data" batch
 * (./newMarketCandidatesPhase2.ts) — see PRODUCT_ROADMAP.md. Each workbook-derived batch is kept
 * in its own module rather than interleaved above, so the verified batch's diff stays untouched
 * and every addition is reviewable on its own.
 */
export const sampleAppetiteRecords: AppetiteRecord[] = [...verifiedAppetiteRecords, ...newMarketAppetiteRecords, ...newMarketAppetiteRecordsPhase2];
