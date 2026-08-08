export type MarketType = 'direct' | 'mga';

export type Verdict = 'strong_match' | 'good_match' | 'possible_match' | 'needs_more_information' | 'not_eligible';

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_match: 'Strong Match',
  good_match: 'Good Match',
  possible_match: 'Possible Match',
  needs_more_information: 'Needs More Information',
  not_eligible: 'Not Eligible',
};

/**
 * Where an appetite fact came from, in descending order of authority. OFFICIAL = the market's own
 * published guidelines/site. UNDERWRITER/BROKER = a direct human confirmation. SECONDARY = a
 * third-party summary (trade publication, aggregator) not the market's own words. UNKNOWN = we
 * have no source at all — used together with a criterion status of 'UNKNOWN', never on its own.
 */
export type SourceType = 'OFFICIAL' | 'UNDERWRITER' | 'BROKER' | 'SECONDARY' | 'UNKNOWN';

/**
 * Whether a specific appetite criterion has verified evidence behind it. 'UNKNOWN' is a
 * first-class, deliberate state — it means Renewal IQ has no verified information for this
 * criterion. It does NOT mean the account is eligible, ineligible, or that the criterion failed.
 */
export type CriterionStatus = 'VERIFIED' | 'UNKNOWN';

/** How recently a criterion's source was personally verified. Independent per criterion. */
export type FreshnessState = 'CURRENT' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface CriterionSource {
  sourceType: SourceType;
  sourceName?: string;
  sourceUrl?: string;
  /** ISO date we personally verified this criterion against the source. */
  verifiedAt?: string;
  /** The source's own stated "last updated" date, when the source publishes one. Often unknown even when verifiedAt is known. */
  sourcePublishedAt?: string;
}

export interface CriterionHistoryEntry {
  value: unknown;
  source: CriterionSource;
  /** ISO date this value replaced the previous one. */
  changedAt: string;
  /** Who or what made the update — a person's name, "Renewal IQ import", etc. */
  updatedBy: string;
}

/**
 * A single appetite fact with its provenance. Mirrors the FieldValue<T> pattern used for Risk
 * Profile extraction — nothing is presented as ground truth without a status and a source.
 */
export interface AppetiteCriterion<T> {
  value: T | null;
  status: CriterionStatus;
  source: CriterionSource;
  notes?: string;
  history?: CriterionHistoryEntry[];
}

export interface StateAvailability {
  /** States explicitly confirmed available. Undefined/empty ≠ excluded — it may simply not be covered by the source yet. */
  admitted?: string[];
  /** States the market explicitly does not write in. A state in neither list is unconfirmed, not assumed ineligible. */
  excluded?: string[];
}

export interface FleetSizeRange {
  min?: number;
  max?: number;
}

export interface AppetiteRecord {
  id: string;
  /** Display name for this specific program, e.g. "Canal Express" or "Cover Whale". */
  marketName: string;
  /** The underlying company this program belongs to, e.g. "Canal Insurance Company". Same as marketName when a market has no sub-programs. */
  parentCompany: string;
  /** Program label shown as a tag when a company has multiple programs, e.g. "Express". Omitted for single-program companies. */
  programName?: string;
  marketType: MarketType;
  /** Carrier name this MGA writes on behalf of, when marketType === 'mga' */
  availableThrough?: string;

  states: AppetiteCriterion<StateAvailability>;
  fleetSize: AppetiteCriterion<FleetSizeRange>;
  yearsInBusinessMin: AppetiteCriterion<number>;
  operationTypes: AppetiteCriterion<string[]>;
  maxRadius: AppetiteCriterion<string>;
  commodities: AppetiteCriterion<string[]>;
  minDriverAge: AppetiteCriterion<number>;
  minDriverExperienceYears: AppetiteCriterion<number>;
  telematicsRequired: AppetiteCriterion<boolean>;
  dashcamRequired: AppetiteCriterion<boolean>;
  majorExclusions: AppetiteCriterion<string[]>;
  /** Loss-history thresholds. UNKNOWN status = market has published no stated constraint on this criterion. */
  maxClaimsPast3Years: AppetiteCriterion<number>;
  maxIncurredPerUnit: AppetiteCriterion<number>;
  /** Coverage lines this market offers — informational, not part of matching. */
  linesOffered: AppetiteCriterion<string[]>;
  /** Free-text underwriting/distribution commentary. Not a scored fact, so it stays plain text rather than a sourced criterion. */
  underwritingNotes: string;
}

export type ReasonStatus = 'pass' | 'fail' | 'warning';

export interface MatchReason {
  criterion: string;
  status: ReasonStatus;
  explanation: string;
  /**
   * True when a 'warning' reflects a verification gap — either the account's own data is
   * missing/unconfirmed, or the market's published appetite for this criterion is UNKNOWN.
   * False/absent means a soft market-fit mismatch where both sides' data is fully known but
   * don't line up exactly. isDataGap drives "Needs More Information"/"not verified" language
   * instead of a false decline.
   */
  isDataGap?: boolean;
}

export interface MatchResult {
  appetiteRecordId: string;
  marketName: string;
  parentCompany: string;
  programName?: string;
  marketType: MarketType;
  availableThrough?: string;
  verdict: Verdict;
  reasons: MatchReason[];
  /** 0-100. Measures overall fit strength among verified criteria. Not meaningful (and not shown) for not_eligible or needs_more_information verdicts. */
  matchScore: number;
  /** Count of reasons that are a verified pass — the actual evidence behind the recommendation. */
  verifiedMatchCount: number;
  /** Count of reasons that are a data gap (account or market data unknown) — what still needs confirming. */
  needsVerificationCount: number;
  freshness: FreshnessState;
  freshnessMessage?: string;
  underwritingNotes: string;
}
