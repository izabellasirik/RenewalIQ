import type { CriterionSource } from './appetite';

/**
 * The market-identity taxonomy the updated workbook needs, which the old `marketType: 'direct' |
 * 'mga'` binary can't express: a risk-bearing carrier is not the same object as the MGA/wholesaler
 * or program administrator that distributes on its behalf, and one carrier can sit behind several
 * of the latter. This is additive — `AppetiteRecord.marketType`/`availableThrough` are unchanged
 * and continue to work; `distributionPartnerId` + `CarrierMarketRelationship` are how new/updated
 * records represent the fuller picture without duplicating carrier records per MGA relationship.
 */
export type OrganizationKind = 'risk_bearing_carrier' | 'mga_wholesaler' | 'program_administrator';

export interface DistributionPartner {
  id: string;
  name: string;
  kind: Extract<OrganizationKind, 'mga_wholesaler' | 'program_administrator'>;
  officialSources?: CriterionSource[];
  sourceNotes?: string;
}

/**
 * How a distribution partner relates to a carrier: direct appointment/access is the retail broker's
 * own relationship with the carrier; MGA binding authority and wholesale access describe two
 * distinct ways an MGA/wholesaler distributes it; program describes a program administrator's
 * delegated authority. Two markets available "through the same MGA" share one DistributionPartner
 * row and get two CarrierMarketRelationship rows — never two duplicated carrier records.
 */
export type RelationshipType = 'direct_appointment' | 'mga_binding_authority' | 'wholesale_access' | 'program';

export interface CarrierMarketRelationship {
  id: string;
  /** Free-form carrier identity for a relationship not yet tied to a specific AppetiteRecord. */
  carrierId?: string;
  /** The specific AppetiteRecord (program/coverage) this relationship applies to, when known. */
  appetiteRecordId?: string;
  distributionPartnerId?: string;
  relationshipType: RelationshipType;
  coveragesOffered?: string[];
  states?: string[];
  notes?: string;
}
