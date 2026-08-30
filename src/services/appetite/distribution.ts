import type { AppetiteRecord, CarrierMarketRelationship, DistributionPartner } from '../../types';
import { distributionPartners } from '../../data/distributionPartners';
import { carrierMarketRelationships } from '../../data/carrierMarketRelationships';

/**
 * Maps a marketName to the free-form `carrierId` used by relationships that aren't tied to one
 * specific program record (see carrierMarketRelationships.ts — the Canal rows). Deliberately a
 * short, explicit lookup rather than a naming convention, since guessing an id from a display
 * string is exactly the kind of silent inference this architecture exists to avoid.
 */
const PARENT_COMPANY_TO_CARRIER_ID: Record<string, string> = {
  'Canal Insurance Company': 'canal_insurance_company',
};

export interface DistributionSummaryEntry {
  partnerId: string;
  name: string;
  coveragesOffered?: string[];
  notes?: string;
}

/**
 * Every distribution partner a given AppetiteRecord is reachable through, per the internal
 * market-intelligence list — looked up first by `appetiteRecordId` (unambiguous, program-specific
 * relationships) and, when none exist, by the record's `parentCompany` mapped to a free-form
 * carrierId (relationships observed at the carrier level, not tied to a specific program — e.g.
 * Canal). Never both at once, so a record's entries aren't double-counted.
 */
export function getDistributionSummary(record: AppetiteRecord): DistributionSummaryEntry[] {
  let relationships: CarrierMarketRelationship[] = carrierMarketRelationships.filter((r) => r.appetiteRecordId === record.id);

  if (relationships.length === 0) {
    const carrierId = PARENT_COMPANY_TO_CARRIER_ID[record.parentCompany];
    if (carrierId) relationships = carrierMarketRelationships.filter((r) => r.carrierId === carrierId);
  }

  return relationships
    .filter((r) => r.distributionPartnerId)
    .map((r) => {
      const partner = distributionPartners.find((p) => p.id === r.distributionPartnerId);
      return { partnerId: r.distributionPartnerId!, name: partner?.name ?? 'Unknown distribution partner', coveragesOffered: r.coveragesOffered, notes: r.notes };
    });
}

export function getDistributionPartnerById(id: string): DistributionPartner | undefined {
  return distributionPartners.find((p) => p.id === id);
}

/**
 * Distribution partner names for a record by id alone (no parentCompany-based carrier-level
 * fallback — that requires the full AppetiteRecord, see getDistributionSummary). Used where only
 * an id is in scope, e.g. MarketCard's compact summary tag.
 */
export function getDistributionPartnerNamesByRecordId(appetiteRecordId: string): string[] {
  return carrierMarketRelationships
    .filter((r) => r.appetiteRecordId === appetiteRecordId && r.distributionPartnerId)
    .map((r) => distributionPartners.find((p) => p.id === r.distributionPartnerId)?.name ?? 'Unknown distribution partner');
}
