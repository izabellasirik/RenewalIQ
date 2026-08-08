import type { AppetiteRecord } from '../types';
import { source, verifiedCriterion as v, unknownCriterion as u } from './appetiteCriteriaHelpers';

/**
 * Source-aware appetite dataset for real, named trucking markets. Every criterion is either
 * VERIFIED (with a source) or explicitly UNKNOWN — nothing here is an invented rule. Facts came
 * from each market's own published program materials; where a market doesn't publish a specific
 * number (fleet ceiling, driver age, loss tolerance, etc.), the criterion is left UNKNOWN rather
 * than guessed. `verifiedAt` reflects the date this record was checked into Renewal IQ; each
 * market's own "last updated" date (sourcePublishedAt) isn't independently known, so it's left
 * unset rather than assumed to match verifiedAt.
 *
 * Multi-program companies (Canal, National Interstate) are represented as one AppetiteRecord per
 * program rather than one merged record, since their eligibility criteria genuinely differ by
 * program — collapsing them would misrepresent which program an account actually fits.
 */
const VERIFIED_AT = '2026-08-08';

function official(sourceName: string, sourceUrl?: string) {
  return source('OFFICIAL', sourceName, { verifiedAt: VERIFIED_AT, sourceUrl });
}

export const sampleAppetiteRecords: AppetiteRecord[] = [
  // ---------------------------------------------------------------------------------------
  // Cover Whale — commercial auto/trucking MGA
  // ---------------------------------------------------------------------------------------
  {
    id: 'appetite_coverwhale',
    marketName: 'Cover Whale',
    parentCompany: 'Cover Whale',
    marketType: 'mga',
    states: u('Cover Whale publishes admitted/non-admitted availability by state; the specific state list is not yet captured in Renewal IQ.'),
    fleetSize: v({ min: 1, max: 25 }, official('Cover Whale Appetite Guidelines'), 'Auto Liability target range at bind.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: v(2, official('Cover Whale Appetite Guidelines'), 'Minimum 2 years driving experience with a similar vehicle.'),
    telematicsRequired: u(),
    dashcamRequired: v(true, official('Cover Whale Appetite Guidelines'), 'Required for Auto Liability.'),
    majorExclusions: u('Cover Whale publishes excluded trucking classes; the specific list is not yet captured in Renewal IQ.'),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability'], official('Cover Whale Appetite Guidelines'), 'Other lines not confirmed.'),
    underwritingNotes:
      'Tractors/trailers generally must be newer than 20 years under current published guidelines. Direct agency appointment is available.',
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
    fleetSize: v({ min: 1, max: 10 }, official('Canal Insurance Company — Program Materials'), 'Canal Express program band.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'Distributed through select general agents.',
  },
  {
    id: 'appetite_canal_fleet',
    marketName: 'Canal Fleet',
    parentCompany: 'Canal Insurance Company',
    programName: 'Fleet',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ min: 11 }, official('Canal Insurance Company — Program Materials'), 'Canal Fleet program band (11+ trucks, no published ceiling).'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'Distributed through select general agents.',
  },
  {
    id: 'appetite_canal_driven',
    marketName: 'Canal DRIVEN',
    parentCompany: 'Canal Insurance Company',
    programName: 'DRIVEN',
    marketType: 'direct',
    states: u(),
    fleetSize: v({ max: 30 }, official('Canal Insurance Company — Program Materials'), 'DRIVEN program ceiling; units must be model year 2000 or newer.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: v(2, official('Canal Insurance Company — Program Materials'), 'Class A CDL with 2 years OTR experience required.'),
    telematicsRequired: v(true, official('Canal Insurance Company — Program Materials'), 'Eligible telematics device required.'),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'Distributed through select general agents.',
  },
  {
    id: 'appetite_canal_testdrive',
    marketName: 'Canal TestDrive',
    parentCompany: 'Canal Insurance Company',
    programName: 'TestDrive',
    marketType: 'direct',
    states: u(),
    fleetSize: u('TestDrive is Canal\'s dedicated new-venture program; a specific fleet-size band is not published separately from its new-venture criteria.'),
    yearsInBusinessMin: u('TestDrive uses separate new-venture criteria; a specific years-in-business threshold is not published.'),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo'], official('Canal Insurance Company — Program Materials')),
    underwritingNotes: 'New-venture program with its own separate criteria from Express/Fleet/DRIVEN. Distributed through select general agents.',
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
    fleetSize: v({ min: 5 }, official('National Interstate — Program Materials'), 'General trucking program targets well-managed local-to-intermediate for-hire fleets.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
    fleetSize: u('Convoy\'s published average fleet size is 25–75 units — a description of accounts typically written, not a stated eligibility minimum/maximum.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
    fleetSize: v({ min: 20 }, official('National Interstate — Program Materials')),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
    fleetSize: u('Venture\'s published average fleet size is 30–100 units — a description of accounts typically written, not a stated eligibility minimum/maximum.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
    fleetSize: u('Voyager\'s published average fleet size is 100–300 units — a description of accounts typically written, not a stated eligibility minimum/maximum.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
    fleetSize: v({ min: 250 }, official('National Interstate — Program Materials')),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Physical Damage', 'Workers Comp', 'Cargo', 'Excess', 'Trailer Interchange', 'General Liability'],
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
      official('Progressive Commercial — Trucking Coverage Pages'),
      'Commercial truck coverage across all 50 states.'
    ),
    fleetSize: u('Progressive does not publish an exact fleet minimum/maximum.'),
    yearsInBusinessMin: u('Progressive does not publish a years-in-business threshold.'),
    operationTypes: u(),
    maxRadius: u(),
    commodities: v(
      ['General Freight', 'Agriculture', 'Car Hauling', 'Dirt/Sand/Gravel', 'Expeditors', 'Logging/Timber', 'Household Movers', 'Towing', 'Intermodal'],
      official('Progressive Commercial — Trucking Coverage Pages'),
      'Publicly listed operations Progressive supports.'
    ),
    minDriverAge: u('Progressive does not publish an exact driver-age threshold.'),
    minDriverExperienceYears: u('Progressive does not publish an exact driver-experience threshold.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Cargo', 'Physical Damage'], official('Progressive Commercial — Trucking Coverage Pages')),
    underwritingNotes: 'Supports owner-operators, motor carriers and private carriers.',
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
    fleetSize: u('Northland does not publish fleet-size thresholds.'),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(
      ['Auto Liability', 'Truckers General Liability', 'Motor Truck Cargo', 'Physical Damage'],
      official('Northland Insurance — Trucking Program Materials')
    ),
    underwritingNotes:
      'A Travelers company. Dedicated trucking insurer serving owner-operators and fleet businesses through commercial fleet and owner-operator programs. Distributed through transportation agents/general agents.',
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
    operationTypes: u(),
    maxRadius: u(),
    commodities: u(),
    minDriverAge: u('Sentry does not publish a driver-age threshold.'),
    minDriverExperienceYears: u(),
    telematicsRequired: v(false, official('Sentry — Trucking Program Materials'), 'Optional — telematics participation may provide a discount, not a requirement.'),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Motor Truck Cargo', 'General Liability'], official('Sentry — Trucking Program Materials')),
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
      official('Prime Insurance — Commercial Auto Program Materials'),
      'Admitted commercial auto in the listed states; primary Commercial Auto is not offered in NY, HI, CT, DE. Coverage availability varies by state — states in neither list are not confirmed either way.'
    ),
    fleetSize: u(),
    yearsInBusinessMin: u(),
    operationTypes: u(),
    maxRadius: u(),
    commodities: v(
      ['Long Haul', 'Short Haul', 'Fleets', 'Tow Trucks', 'Logging Trucks', 'Car Transporters'],
      official('Prime Insurance — Commercial Auto Program Materials'),
      'Operations Prime states it will consider for difficult/hard-to-place commercial trucking risks.'
    ),
    minDriverAge: u(),
    minDriverExperienceYears: u(),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: u(),
    underwritingNotes:
      'Writes difficult/hard-to-place commercial trucking risks. Prime states it may consider risks with losses, substandard DOT scores and MVR issues — this is a stated willingness to review flexibly, not a guarantee of eligibility.',
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
    operationTypes: u('Detailed radius/operation-type criteria not yet verified.'),
    maxRadius: u('Detailed radius/operation-type criteria not yet verified.'),
    commodities: u('Detailed cargo appetite not yet verified.'),
    minDriverAge: u('Detailed driver criteria not yet verified.'),
    minDriverExperienceYears: u('Detailed driver criteria not yet verified.'),
    telematicsRequired: u(),
    dashcamRequired: u(),
    majorExclusions: u(),
    maxClaimsPast3Years: u(),
    maxIncurredPerUnit: u(),
    linesOffered: v(['Auto Liability', 'Physical Damage', 'Cargo', 'General Liability'], official('Great West Casualty Company — Trucking Program Materials')),
    underwritingNotes: 'Dedicated trucking insurer with trucking-focused risk control and claims expertise. Detailed fleet, state, radius, cargo and driver criteria remain unverified pending direct confirmation.',
  },
];
