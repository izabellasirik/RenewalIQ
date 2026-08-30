import type { AppetiteRecord, CriterionSource } from '../types';
import { source, needsConfirmationCriterion as nc, partiallyVerifiedCriterion as pv, unknownCriterion as u } from './appetiteCriteriaHelpers';

/**
 * Phase 3 of the workbook reconciliation (see PRODUCT_ROADMAP.md) — a first, deliberately small
 * batch of new market candidates from an internal market-intelligence list, added only where the
 * workbook's stated role was clear enough to safely import. Everything here is either
 * NEEDS_CONFIRMATION or PARTIALLY_VERIFIED — nothing is VERIFIED, since none of it has been
 * checked against each carrier's own published guidelines. Unstated criteria are left UNKNOWN
 * rather than guessed. `ruleType` is deliberately never 'HARD_RULE' on a workbook-sourced
 * criterion here, so nothing from an unverified internal list can ever produce a hard decline —
 * see rules.ts (`isUsable`/HARD_RULE gating) and PARTIALLY_VERIFIED's role in it.
 *
 * Explicitly NOT included in this batch (held at the time this file was written — see
 * ./newMarketCandidatesPhase2.ts and PRODUCT_ROADMAP.md for how most of these were later resolved
 * or, for the ones still unsafe to import, why they remain held): Lloyds, Evolum, RPS Fleet
 * Trucking, the ambiguous "Paramount" MGA/carrier entry, "IAT / Occidental / Harco" as a merged
 * identity (IAT itself IS included below, without that merge), "Star RRG"/"Starr RRG" as a merged
 * identity, "XL Catlin"/"XL Group" as a merged identity, "Berkshire Hateway"/BHHC assumptions, and
 * the "Navigator – Hartford Admitted" entity.
 */

function workbookSource(): CriterionSource {
  return source('INTERNAL_MARKET_LIST', 'Internal Market Intelligence List');
}

export const newMarketAppetiteRecords: AppetiteRecord[] = [
  // ---------------------------------------------------------------------------------------
  // Berkley Prime / Berkley Small — kept as separate programs, appetite not combined between
  // them, sharing only the "Berkley" parent label since that's how the source names both.
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_berkley_prime',
    marketName: 'Berkley Prime',
    parentCompany: 'Berkley',
    programName: 'Prime',
    marketType: 'mga',
    states: u(),
    fleetSize: u('An internal note ties a 15–74 unit band (may consider 75+) specifically to the Blue Ridge Specialty distribution path — not applied here as a carrier-wide range; see underwritingNotes.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: pv(['Dry Van', 'Reefer', 'Intermodal', 'Flatbed'], 'TARGET', workbookSource(), 'Described in the source as "really clean accounts" — a target profile, not an exhaustive or hard-eligibility list.'),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: nc(['Coal'], workbookSource(), 'Coal exclusion noted specifically on the RPS distribution path.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: pv(['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'], 'PREFERENCE', workbookSource()),
    underwritingNotes:
      'Internal market list describes Berkley Prime as a clean-accounts program (Dry Van, Reefer, Intermodal, Flatbed) distributed through Maximum, USR, Blue Ridge Specialty, CRC and RPS. The Blue Ridge Specialty path cites a 15–74 unit band (may consider 75+ pending capacity) and excludes coal; the RPS path requires submission 15–90 days ahead of the effective date. None of this is independently verified against Berkley Prime\'s own published guidelines.',
  },
  {
    id: 'appetite_berkley_small',
    marketName: 'Berkley Small',
    parentCompany: 'Berkley',
    programName: 'Small',
    marketType: 'mga',
    states: u(),
    fleetSize: pv({ min: 1, max: 14 }, 'TARGET', workbookSource(), 'Internal note states a 1–14 unit band; not confirmed against Berkley Small\'s own published materials.'),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: pv(['Flatbed', 'Dry Van', 'Reefer', 'Hopper Bottom', 'Livestock Haulers'], 'TARGET', workbookSource()),
    minDriverAge: pv(23, 'TARGET', workbookSource(), 'RPS-path note.'),
    minDriverExperienceYears: pv(2, 'TARGET', workbookSource(), 'RPS-path note.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: nc(['Last-mile/residential exposure', 'Sprinter/Econoline vans'], workbookSource(), 'RPS-path note: also excludes HOS or unsafe cab alerts.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: pv(['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'], 'PREFERENCE', workbookSource()),
    underwritingNotes:
      'Distributed through USR, Blue Ridge Specialty, CRC, RPS and AMWINS per internal market list. RPS-path notes: direct bill offered; will write box/straight trucks intrastate-only (excluding FL/LA); no last-mile/residential exposure or Sprinter/Econoline vans; no CDL is acceptable in some cases. Kept as a separate program from Berkley Prime — different unit-count appetite and MGA mix.',
  },

  // ---------------------------------------------------------------------------------------
  // IAT — the compound "IAT / Occidental / Harco" workbook entry is deliberately not merged in.
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_iat',
    marketName: 'IAT',
    parentCompany: 'IAT',
    marketType: 'mga',
    states: u(),
    fleetSize: u(),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u('Source describes appetite as similar to Northland\'s commodity profile without itemizing specifics for IAT itself.'),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: pv(['Auto haulers above a $250,000 limit'], 'TARGET', workbookSource(), 'Will write auto haulers but caps the limit; wants clear/clean accounts.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: nc(['Auto Liability'], workbookSource(), 'Source lists coverage as "AL + Package" without itemizing the additional bundled lines.'),
    underwritingNotes:
      'Distributed via CRC and RPS per internal market list. The same list separately shows a compound "IAT / Occidental / Harco" entry (via RPS/AMWINS, minimum 3 full years in business, up to $2M Auto Liability) that may represent the same carrier group under related legal names — intentionally held back from this record rather than merged in, pending confirmation.',
  },

  // ---------------------------------------------------------------------------------------
  // Nirvana
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_nirvana',
    marketName: 'Nirvana',
    parentCompany: 'Nirvana',
    marketType: 'mga',
    states: u(),
    fleetSize: u(),
    yearsInBusinessMin: nc(2, workbookSource(), 'RPS-path note.'),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: pv(['Flatbed', 'Dry Van', 'Reefer'], 'TARGET', workbookSource(), 'Also writes non-hazmat tanker (straight, not schedule) via the USR path.'),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: pv(true, 'PREFERENCE', workbookSource(), 'Requires a specific telematics brand accepted by Nirvana.'),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: pv(['Dump', 'Waste/Hazmat', 'Driveaway', 'Heavy Haul', 'Logging', 'Auto Haulers'], 'TARGET', workbookSource(), 'RPS-path exclusion list.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: nc(['Auto Liability'], workbookSource(), 'Source lists coverage as "AL + Package" without itemizing the additional bundled lines.'),
    underwritingNotes:
      'Distributed through Maximum, USR, RPS, AMWINS and Blue Ridge Specialty per internal market list. Underwritten on SiriusPoint America paper (A+ rated) per the source; Texas is written non-admitted. Mileage reporting with an end-of-year audit; agency billed.',
  },

  // ---------------------------------------------------------------------------------------
  // Crum & Forster — consolidates the workbook's "Crum and Foster" (Maximum/USR/CRC/RPS) and
  // "Crum & Forster" (AMWINS) rows into one entity per the approved import scope.
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_crum_forster',
    marketName: 'Crum & Forster',
    parentCompany: 'Crum & Forster',
    marketType: 'mga',
    states: u(),
    fleetSize: nc({ min: 1 }, workbookSource(), 'AMWINS-path note: 1+ units. Other paths describe "clean accounts...1 to no limit" without a firm ceiling.'),
    yearsInBusinessMin: pv(3, 'TARGET', workbookSource(), 'Stated on both the CRC path and the AMWINS path.'),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: pv(['Dry Freight', 'Intermodal', 'Flatbed', 'Reefer', 'Dumps'], 'TARGET', workbookSource(), 'USR-path list; RPS path separately prefers dry freight/reefer, all radius, and calls out preferred dump accounts.'),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: nc(['Oilfield', 'Couriers', 'Towing', 'Hotshot/pickup hauling', 'Garbage/refuse', 'Driveaway', 'Household goods movers'], workbookSource(), 'AMWINS-path exclusion list.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource(), 'Coverage column reads "Package" (Maximum/USR/CRC/RPS path) or "AL + Package" (AMWINS path) — specific package lines are not itemized.'),
    underwritingNotes:
      'Internal market list refers to this carrier as both "Crum and Foster" (via Maximum, USR, CRC, RPS) and "Crum & Forster" (via AMWINS) — treated as one entity here per the approved import scope, not auto-merged without review. Appetite is described as comparable to Berkley Prime and AIG (clean accounts), 1–50 units on the RPS path.',
  },

  // ---------------------------------------------------------------------------------------
  // NICO Fleet / NICO Schedule — separate programs under a shared NICO parent, not merged
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_nico_fleet',
    marketName: 'NICO Fleet',
    parentCompany: 'NICO',
    programName: 'Fleet',
    marketType: 'mga',
    states: u(),
    fleetSize: pv({ min: 11 }, 'TARGET', workbookSource()),
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
    linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()),
    underwritingNotes: 'Distributed via Maximum, CRC and RPS per internal market list. Kept as a separate program from NICO Schedule — different MGA mix and appetite profile; appetite is not combined between them.',
  },
  {
    id: 'appetite_nico_schedule',
    marketName: 'NICO Schedule',
    parentCompany: 'NICO',
    programName: 'Schedule',
    marketType: 'mga',
    states: u(),
    fleetSize: u(),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: nc(['Tow Truck', 'Dumps'], workbookSource()),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: nc(['Auto Liability'], workbookSource(), 'Source lists coverage as "AL + Package" without itemizing the additional bundled lines.'),
    underwritingNotes:
      'Distributed via CRC, NEEE, RPS and AMWINS per internal market list. Described as writing difficult accounts and new ventures, with direct bill available; excess must be written by NICO; drivers must be in-state. Kept as a separate program from NICO Fleet — different MGA mix and appetite profile; appetite is not combined between them.',
  },

  // ---------------------------------------------------------------------------------------
  // RLI
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_rli',
    marketName: 'RLI',
    parentCompany: 'RLI',
    marketType: 'mga',
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
    linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()),
    underwritingNotes: 'Distributed via Maximum per internal market list. Described as similar to Prime Insurance\'s appetite, expected to require cleaner accounts than Prime typically writes.',
  },

  // ---------------------------------------------------------------------------------------
  // Carolina Casualty
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_carolina_casualty',
    marketName: 'Carolina Casualty',
    parentCompany: 'Carolina Casualty',
    marketType: 'mga',
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
    linesOffered: pv(['Auto Liability', 'Auto Physical Damage', 'General Liability'], 'PREFERENCE', workbookSource()),
    underwritingNotes: 'Distributed via Maximum, USR and RPS per internal market list.',
  },

  // ---------------------------------------------------------------------------------------
  // Third Coast
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_third_coast',
    marketName: 'Third Coast',
    parentCompany: 'Third Coast',
    marketType: 'mga',
    states: u(),
    fleetSize: pv({ min: 25 }, 'TARGET', workbookSource()),
    yearsInBusinessMin: u(),
    yearsInBusinessMax: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: nc(true, workbookSource(), 'Described as "require cameras softly" — a soft preference, not confirmed as a hard requirement.'),
    dotNumberRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: pv(['Auto Liability'], 'PREFERENCE', workbookSource()),
    underwritingNotes:
      'Also referenced in the internal list as "Third Coast (Fundamental Underwriters)." Distributed via Maximum. Comfortable with NJ and PA for 25+ unit accounts.',
  },
];
