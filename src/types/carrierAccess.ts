import type { CoverageType } from './coverage';

/**
 * Carrier 101 — how the agency reaches a market (agency_carriers access columns, 0049).
 * "Ready" means a submission route exists; whether a given account is eligible is Carrier 102.
 */
export type AccessRoute = 'direct' | 'indirect';
export type AccessStatus = 'ready' | 'partial' | 'not_ready' | 'inactive';

export const ACCESS_ROUTE_LABELS: Record<AccessRoute, string> = { direct: 'Direct', indirect: 'Through an intermediary' };
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = { ready: 'Ready', partial: 'Partial', not_ready: 'Not ready', inactive: 'Inactive' };
export const ACCESS_STATUS_HELP: Record<AccessStatus, string> = {
  ready: 'A submission route exists. Eligibility still depends on the account.',
  partial: 'Some of the route is in place — check the notes before submitting.',
  not_ready: 'No working submission route yet.',
  inactive: 'Not in use — hidden from Market Finder results.',
};

export interface MarketContact {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  coverage?: string;
  notes?: string;
}

export interface MarketAccess {
  route: AccessRoute | null;
  status: AccessStatus | null;
  mga: string | null;
  wholesaler: string | null;
  /** The insurance company whose paper the policy is written on. */
  paper: string | null;
  portalName: string | null;
  portalUrl: string | null;
  submissionEmail: string | null;
  producerCode: string | null;
  appointment: string | null;
  appointmentNotes: string | null;
  contacts: MarketContact[];
  source: string | null;
  sourceDate: string | null;
  verifiedAt: string | null;
  notes: string | null;
  /** The status exactly as the source states it (e.g. "PENDING VERIFICATION / PARTIAL"). A record of the source, not a RenewalIQ verification. */
  documentedStatus?: string | null;
}

/**
 * Carrier 102 — one underwriting rule of one market (agency_carrier_rules, 0049): "for accounts
 * where <category operator value> (and <conditions>), the market's answer is YES / NO / REFERRAL /
 * UNKNOWN", with how strict it is and where it came from.
 */
export type RuleCategory =
  | 'state'
  | 'commodity'
  | 'operation_type'
  | 'radius_miles'
  | 'fleet_size'
  | 'years_in_business'
  | 'driver_age'
  | 'driver_experience'
  | 'vehicle_type'
  | 'operation_class'
  | 'vehicle_age'
  | 'claims_3y'
  | 'telematics'
  | 'dashcam'
  | 'dot_number'
  | 'coverage_offered'
  | 'other';
export type RuleOperator = 'any_of' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'is_true' | 'is_false' | 'missing' | 'offered' | 'text';
export type RuleAnswer = 'yes' | 'no' | 'referral' | 'unknown';
export type RuleStrength = 'hard' | 'soft' | 'info';

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  state: 'States',
  commodity: 'Commodities',
  operation_type: 'Operation type',
  radius_miles: 'Radius',
  fleet_size: 'Fleet size',
  years_in_business: 'Years in business',
  driver_age: 'Driver age',
  driver_experience: 'Driver experience',
  vehicle_type: 'Vehicle types',
  operation_class: 'Operations (cargo or equipment)',
  vehicle_age: 'Vehicle age',
  claims_3y: 'Claims (3 years)',
  telematics: 'Telematics',
  dashcam: 'Dash cameras',
  dot_number: 'DOT number',
  coverage_offered: 'Coverage written',
  other: 'Other requirement',
};
export const RULE_ANSWER_LABELS: Record<RuleAnswer, string> = { yes: 'YES', no: 'NO', referral: 'REFERRAL', unknown: 'UNKNOWN' };
export const RULE_STRENGTH_LABELS: Record<RuleStrength, string> = { hard: 'Hard', soft: 'Soft', info: 'Informational' };

export interface RulePredicate {
  category: RuleCategory;
  operator: RuleOperator;
  value?: unknown;
}

export interface CarrierRule extends RulePredicate {
  id: string;
  ref?: string | null;
  /** null = applies to every coverage. */
  coverage: CoverageType | null;
  answer: RuleAnswer;
  strength: RuleStrength;
  conditions: RulePredicate[];
  conditionsText?: string | null;
  source?: string | null;
  sourceDate?: string | null;
  /** Set = verified on that date. Only a verified hard NO can make a market Not Eligible. */
  lastVerifiedAt?: string | null;
  verifiedBy?: string | null;
  notes?: string | null;
  /** The source's own verification wording ("VERIFIED", "SUPPORTED", "Underwriter-confirmed"). Never makes a rule decline by itself — only lastVerifiedAt does. */
  documentedStatus?: string | null;
  archivedAt?: string | null;
}
