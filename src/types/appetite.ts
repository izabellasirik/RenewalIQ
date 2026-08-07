import type { Confidence } from './common';

export type MarketType = 'direct' | 'mga';

export type Verdict = 'strong_match' | 'possible_match' | 'verify' | 'not_eligible';

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_match: 'Strong Match',
  possible_match: 'Possible Match',
  verify: 'Verify',
  not_eligible: 'Not Eligible',
};

export interface AppetiteRecord {
  id: string;
  marketName: string;
  marketType: MarketType;
  /** Carrier name this MGA writes on behalf of, when marketType === 'mga' */
  availableThrough?: string;
  eligibleStates: string[];
  fleetSizeMin?: number;
  fleetSizeMax?: number;
  yearsInBusinessMin?: number;
  operationTypes: string[];
  maxRadius?: string;
  commodities: string[];
  driverRequirements: string;
  telematicsRequired: boolean;
  dashcamRequired: boolean;
  majorExclusions: string[];
  lastVerifiedDate: string;
  sourceContact: string;
  /** Reliability/freshness confidence of this appetite record itself, independent of extraction confidence. */
  confidence: Confidence;
  /** Free-text underwriting guidance shown on the recommendation card and detail view. */
  underwritingNotes: string;
}

export type ReasonStatus = 'pass' | 'fail' | 'warning';

export interface MatchReason {
  criterion: string;
  status: ReasonStatus;
  explanation: string;
}

export interface MatchResult {
  appetiteRecordId: string;
  marketName: string;
  marketType: MarketType;
  availableThrough?: string;
  verdict: Verdict;
  reasons: MatchReason[];
  /** 0-100. Measures overall fit strength; the verdict measures confidence to proceed — a high score can still carry a "Verify" verdict. */
  matchScore: number;
  isStale: boolean;
  staleWarning?: string;
  lastVerifiedDate: string;
  sourceContact: string;
  confidence: Confidence;
  underwritingNotes: string;
}
