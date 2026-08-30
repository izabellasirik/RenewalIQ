import type { CarrierMarketRelationship, RelationshipType } from '../types';

/**
 * Carrier↔MGA distribution paths from the internal market-intelligence list (see
 * PRODUCT_ROADMAP.md — "Phase 1: Distribution Model"). Each row links one carrier (either a
 * specific `appetiteRecordId`, when unambiguous, or a free-form `carrierId` when the source
 * doesn't say which specific program it applies to — see the Canal rows below) to one
 * DistributionPartner, optionally with the coverage lines the source states for that path.
 *
 * "+ Package" appears throughout the source workbook without itemizing which additional lines are
 * bundled in — rather than guess, those rows keep `coveragesOffered` to what's unambiguous (Auto
 * Liability) and flag the rest in `notes`. APD/MTC/GL/NTL/TI are expanded to their standard
 * insurance meanings since those abbreviations are unambiguous industry shorthand.
 */
const PACKAGE_NOTE = 'Source lists this coverage as "+ Package" without itemizing the additional bundled lines — not expanded here to avoid asserting unstated coverages.';

function rel(
  id: string,
  target: { appetiteRecordId: string } | { carrierId: string },
  distributionPartnerId: string,
  opts: { relationshipType?: RelationshipType; coveragesOffered?: string[]; notes?: string } = {}
): CarrierMarketRelationship {
  return {
    id,
    ...target,
    distributionPartnerId,
    relationshipType: opts.relationshipType ?? 'mga_binding_authority',
    coveragesOffered: opts.coveragesOffered,
    notes: opts.notes,
  };
}

export const carrierMarketRelationships: CarrierMarketRelationship[] = [
  // ---------------------------------------------------------------------------------------
  // Canal — workbook lists "Canal" as available via these MGAs for Auto Liability, but does not
  // say which specific program (Express/Fleet/DRIVEN/TestDrive) that access path applies to.
  // Linked at the carrier level (carrierId), never to a specific program record, per the explicit
  // instruction not to apply a generic workbook criterion to every Canal program.
  // ---------------------------------------------------------------------------------------
  rel('rel_canal_maximum', { carrierId: 'canal_insurance_company' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'], notes: 'Program-level applicability not specified in the source.' }),
  rel('rel_canal_rocklake', { carrierId: 'canal_insurance_company' }, 'dist_rocklake', { coveragesOffered: ['Auto Liability'], notes: 'Program-level applicability not specified in the source.' }),
  rel('rel_canal_rps', { carrierId: 'canal_insurance_company' }, 'dist_rps', { coveragesOffered: ['Auto Liability'], notes: 'Program-level applicability not specified in the source.' }),
  rel('rel_canal_primeagency', { carrierId: 'canal_insurance_company' }, 'dist_prime_agency', { coveragesOffered: ['Auto Liability'], notes: 'Program-level applicability not specified in the source.' }),
  rel('rel_canal_amwins', { carrierId: 'canal_insurance_company' }, 'dist_amwins', { coveragesOffered: ['Auto Liability'], notes: 'Program-level applicability not specified in the source.' }),

  // ---------------------------------------------------------------------------------------
  // Northland Insurance — existing direct record, additional MGA distribution paths observed
  // ---------------------------------------------------------------------------------------
  rel('rel_northland_usr', { appetiteRecordId: 'appetite_northland' }, 'dist_usr', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_northland_crc', { appetiteRecordId: 'appetite_northland' }, 'dist_crc', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_northland_rps', { appetiteRecordId: 'appetite_northland' }, 'dist_rps', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_northland_amwins', { appetiteRecordId: 'appetite_northland' }, 'dist_amwins', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),

  // ---------------------------------------------------------------------------------------
  // Prime Insurance — existing direct record, additional MGA distribution paths observed
  // ---------------------------------------------------------------------------------------
  rel('rel_prime_maximum', { appetiteRecordId: 'appetite_prime' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'] }),
  rel('rel_prime_primeagency', { appetiteRecordId: 'appetite_prime' }, 'dist_prime_agency', { coveragesOffered: ['Auto Liability'] }),

  // ---------------------------------------------------------------------------------------
  // Berkley Prime (new)
  // ---------------------------------------------------------------------------------------
  rel('rel_berkleyprime_maximum', { appetiteRecordId: 'appetite_berkley_prime' }, 'dist_maximum', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'] }),
  rel('rel_berkleyprime_usr', { appetiteRecordId: 'appetite_berkley_prime' }, 'dist_usr', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'] }),
  rel('rel_berkleyprime_brs', { appetiteRecordId: 'appetite_berkley_prime' }, 'dist_brs', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'], notes: 'BRS-path note: 15–74 units (may consider 75+ pending capacity); no coal.' }),
  rel('rel_berkleyprime_crc', { appetiteRecordId: 'appetite_berkley_prime' }, 'dist_crc', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'] }),
  rel('rel_berkleyprime_rps', { appetiteRecordId: 'appetite_berkley_prime' }, 'dist_rps', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'General Liability', 'Auto Physical Damage'] }),

  // ---------------------------------------------------------------------------------------
  // Berkley Small (new) — kept as a separate program from Berkley Prime, not combined appetite
  // ---------------------------------------------------------------------------------------
  rel('rel_berkleysmall_usr', { appetiteRecordId: 'appetite_berkley_small' }, 'dist_usr', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_berkleysmall_brs', { appetiteRecordId: 'appetite_berkley_small' }, 'dist_brs', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_berkleysmall_crc', { appetiteRecordId: 'appetite_berkley_small' }, 'dist_crc', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_berkleysmall_rps', { appetiteRecordId: 'appetite_berkley_small' }, 'dist_rps', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'], notes: 'RPS-path note: no HOS/unsafe cab alerts; direct bill offered; will do box/straight trucks intrastate-only (excluding FL/LA); no last-mile/residential; no Sprinter/Econoline vans.' }),
  rel('rel_berkleysmall_amwins', { appetiteRecordId: 'appetite_berkley_small' }, 'dist_amwins', { coveragesOffered: ['Auto Liability', 'Motor Truck Cargo', 'Auto Physical Damage', 'General Liability'] }),

  // ---------------------------------------------------------------------------------------
  // IAT (new) — the "IAT / Occidental / Harco" grouping is deliberately NOT merged into this
  // record; see appetite_iat.underwritingNotes.
  // ---------------------------------------------------------------------------------------
  rel('rel_iat_crc', { appetiteRecordId: 'appetite_iat' }, 'dist_crc', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_iat_rps', { appetiteRecordId: 'appetite_iat' }, 'dist_rps', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),

  // ---------------------------------------------------------------------------------------
  // Nirvana (new)
  // ---------------------------------------------------------------------------------------
  rel('rel_nirvana_maximum', { appetiteRecordId: 'appetite_nirvana' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nirvana_usr', { appetiteRecordId: 'appetite_nirvana' }, 'dist_usr', { coveragesOffered: ['Auto Liability'], notes: `${PACKAGE_NOTE} USR-path note: 2 years in business, non-hazmat tanker written straight.` }),
  rel('rel_nirvana_rps', { appetiteRecordId: 'appetite_nirvana' }, 'dist_rps', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nirvana_amwins', { appetiteRecordId: 'appetite_nirvana' }, 'dist_amwins', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nirvana_brs', { appetiteRecordId: 'appetite_nirvana' }, 'dist_brs', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),

  // ---------------------------------------------------------------------------------------
  // Crum & Forster (new) — workbook spells this "Crum and Foster" (Maximum/USR/CRC/RPS path) and
  // "Crum & Forster" (AMWINS path); treated as one entity per the approved import scope.
  // ---------------------------------------------------------------------------------------
  rel('rel_crumforster_maximum', { appetiteRecordId: 'appetite_crum_forster' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_crumforster_usr', { appetiteRecordId: 'appetite_crum_forster' }, 'dist_usr', { coveragesOffered: ['Auto Liability'], notes: `${PACKAGE_NOTE} USR-path note: Dry Freight, Intermodal, Flat Bed, Reefer, Dumps.` }),
  rel('rel_crumforster_crc', { appetiteRecordId: 'appetite_crum_forster' }, 'dist_crc', { coveragesOffered: ['Auto Liability'], notes: `${PACKAGE_NOTE} CRC-path note: requires 3 years in business.` }),
  rel('rel_crumforster_rps', { appetiteRecordId: 'appetite_crum_forster' }, 'dist_rps', { coveragesOffered: ['Auto Liability'], notes: `${PACKAGE_NOTE} RPS-path note: 1–50 units, prefer dry freight/reefer, all radius; preferred dump accounts.` }),
  rel('rel_crumforster_amwins', { appetiteRecordId: 'appetite_crum_forster' }, 'dist_amwins', { coveragesOffered: ['Auto Liability'], notes: `${PACKAGE_NOTE} AMWINS-path note: 1+ units, 3+ years in business, mostly long haul.` }),

  // ---------------------------------------------------------------------------------------
  // NICO Fleet / NICO Schedule (new) — kept as separate programs under a shared NICO parent,
  // appetite not combined between them
  // ---------------------------------------------------------------------------------------
  rel('rel_nicofleet_maximum', { appetiteRecordId: 'appetite_nico_fleet' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'] }),
  rel('rel_nicofleet_crc', { appetiteRecordId: 'appetite_nico_fleet' }, 'dist_crc', { coveragesOffered: ['Auto Liability'] }),
  rel('rel_nicofleet_rps', { appetiteRecordId: 'appetite_nico_fleet' }, 'dist_rps', { coveragesOffered: ['Auto Liability'] }),

  rel('rel_nicoschedule_crc', { appetiteRecordId: 'appetite_nico_schedule' }, 'dist_crc', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nicoschedule_neee', { appetiteRecordId: 'appetite_nico_schedule' }, 'dist_neee', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nicoschedule_rps', { appetiteRecordId: 'appetite_nico_schedule' }, 'dist_rps', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),
  rel('rel_nicoschedule_amwins', { appetiteRecordId: 'appetite_nico_schedule' }, 'dist_amwins', { coveragesOffered: ['Auto Liability'], notes: PACKAGE_NOTE }),

  // ---------------------------------------------------------------------------------------
  // RLI (new)
  // ---------------------------------------------------------------------------------------
  rel('rel_rli_maximum', { appetiteRecordId: 'appetite_rli' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'] }),

  // ---------------------------------------------------------------------------------------
  // Carolina Casualty (new)
  // ---------------------------------------------------------------------------------------
  rel('rel_carolinacasualty_maximum', { appetiteRecordId: 'appetite_carolina_casualty' }, 'dist_maximum', { coveragesOffered: ['Auto Liability', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_carolinacasualty_usr', { appetiteRecordId: 'appetite_carolina_casualty' }, 'dist_usr', { coveragesOffered: ['Auto Liability', 'Auto Physical Damage', 'General Liability'] }),
  rel('rel_carolinacasualty_rps', { appetiteRecordId: 'appetite_carolina_casualty' }, 'dist_rps', { coveragesOffered: ['Auto Liability', 'Auto Physical Damage', 'General Liability'] }),

  // ---------------------------------------------------------------------------------------
  // Third Coast (new)
  // ---------------------------------------------------------------------------------------
  rel('rel_thirdcoast_maximum', { appetiteRecordId: 'appetite_third_coast' }, 'dist_maximum', { coveragesOffered: ['Auto Liability'], notes: 'Also referenced in the source as "Third Coast (Fundamental Underwriters)."' }),
];

/** All relationships for a given AppetiteRecord id. */
export function relationshipsForRecord(appetiteRecordId: string): CarrierMarketRelationship[] {
  return carrierMarketRelationships.filter((r) => r.appetiteRecordId === appetiteRecordId);
}

/** All relationships for a free-form carrier identity not tied to one specific program record (e.g. Canal). */
export function relationshipsForCarrier(carrierId: string): CarrierMarketRelationship[] {
  return carrierMarketRelationships.filter((r) => r.carrierId === carrierId);
}
