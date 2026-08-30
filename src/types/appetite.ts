export type MarketType = 'direct' | 'mga';

export type Verdict = 'likely_match' | 'possible_match' | 'needs_more_information' | 'not_eligible';

export const VERDICT_LABELS: Record<Verdict, string> = {
  likely_match: 'Likely Match',
  possible_match: 'Possible Match',
  needs_more_information: 'Needs More Information',
  not_eligible: 'Not Eligible',
};

/**
 * Where an appetite fact came from, in descending order of authority. OFFICIAL = the market's own
 * published guidelines/site. UNDERWRITER/BROKER = a direct human confirmation. SECONDARY = a
 * third-party summary (trade publication, aggregator) not the market's own words. UNKNOWN = we
 * have no source at all — used together with a verificationStatus of 'UNKNOWN', never on its own.
 */
export type SourceType = 'OFFICIAL' | 'UNDERWRITER' | 'BROKER' | 'SECONDARY' | 'INTERNAL_MARKET_LIST' | 'UNKNOWN';

/** Display labels for SourceType, so raw enum values are never rendered verbatim in the UI. */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  OFFICIAL: 'Official',
  UNDERWRITER: 'Underwriter',
  BROKER: 'Broker',
  SECONDARY: 'Secondary',
  INTERNAL_MARKET_LIST: 'Internal Market List',
  UNKNOWN: 'Unknown',
};

/**
 * How strong the evidence behind a specific criterion is. 'UNKNOWN' is a first-class, deliberate
 * state — it means Renewal IQ has no verified information for this criterion. It does NOT mean
 * the account is eligible, ineligible, or that the criterion failed. 'NEEDS_CONFIRMATION' means
 * we have a lead (e.g. a broker mentioned it) but haven't verified it against an authoritative
 * source yet. 'PARTIALLY_VERIFIED' means part of the fact is confirmed (e.g. an admitted-states
 * list with no stated exclusions) but it may not be the complete picture.
 */
export type VerificationStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_CONFIRMATION' | 'UNKNOWN';

/**
 * What kind of rule a criterion represents — this, not just verification status, decides whether
 * falling outside it can ever produce a decline.
 *
 * HARD_RULE: a verified requirement that creates a decline if the risk does not satisfy it.
 * TARGET: published target appetite. Falling outside it does not necessarily prove ineligibility
 *   unless the source explicitly says it's a hard restriction — surfaces as a soft mismatch, not a fail.
 * PREFERENCE: a market preference where exceptions may exist — same soft treatment as TARGET.
 * TYPICAL_RANGE: published average/typical account characteristics. Never treated as an
 *   eligibility floor or ceiling — informational only, always safe to show, never used to decline.
 * UNKNOWN: no verified rule is currently available for this criterion.
 */
export type RuleType = 'HARD_RULE' | 'TARGET' | 'PREFERENCE' | 'TYPICAL_RANGE' | 'UNKNOWN';

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
 * Profile extraction — nothing is presented as ground truth without a verification status and a
 * source, and ruleType decides whether it can ever be the reason a market is ruled out.
 */
export interface AppetiteCriterion<T> {
  value: T | null;
  verificationStatus: VerificationStatus;
  ruleType: RuleType;
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
  /** Display name for this specific program/coverage, e.g. "Canal Express" or "Cover Whale — Auto Liability". */
  marketName: string;
  /** The underlying company this program belongs to, e.g. "Canal Insurance Company". Same as marketName when a market has no sub-programs. */
  parentCompany: string;
  /** Program/coverage label shown as a tag when a company has multiple programs or coverage-specific appetite, e.g. "Express" or "Auto Liability". Omitted for single-program companies. */
  programName?: string;
  marketType: MarketType;
  /**
   * @deprecated Carrier name this MGA writes on behalf of, as a plain string. Kept for backward
   * compatibility with every existing record — prefer `distributionPartnerId` (a real
   * DistributionPartner, see types/organization.ts) for new/updated records, since a string can't
   * represent one carrier being available through several MGAs without duplicating data.
   */
  availableThrough?: string;
  /** The DistributionPartner (MGA/wholesaler/program administrator) this program is written through, when marketType === 'mga'. Not yet backfilled onto existing records — see PRODUCT_ROADMAP.md. */
  distributionPartnerId?: string;

  states: AppetiteCriterion<StateAvailability>;
  fleetSize: AppetiteCriterion<FleetSizeRange>;
  yearsInBusinessMin: AppetiteCriterion<number>;
  /** New-venture-style ceiling — e.g. "must be under 2 years in business". Distinct from yearsInBusinessMin, which is a floor. */
  yearsInBusinessMax: AppetiteCriterion<number>;
  operationTypes: AppetiteCriterion<string[]>;
  maxRadius: AppetiteCriterion<string>;
  commodities: AppetiteCriterion<string[]>;
  minDriverAge: AppetiteCriterion<number>;
  minDriverExperienceYears: AppetiteCriterion<number>;
  telematicsRequired: AppetiteCriterion<boolean>;
  dashcamRequired: AppetiteCriterion<boolean>;
  /** DOT number required (or in-process) as a condition of the program. */
  dotNumberRequired: AppetiteCriterion<boolean>;
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

/** How a reason should be grouped in the "why this match" view — independent of its pass/fail/warning status. */
export type ReasonGroup = 'matched' | 'failed' | 'needs_verification' | 'preference';

export interface MatchReason {
  criterion: string;
  status: ReasonStatus;
  explanation: string;
  /**
   * True when a 'warning' reflects a verification gap — either the account's own data is
   * missing/unconfirmed, or the market's published appetite for this criterion is UNKNOWN/
   * NEEDS_CONFIRMATION. False/absent means a soft market-fit mismatch where both sides' data is
   * fully known but don't line up exactly (e.g. outside a TARGET/PREFERENCE/TYPICAL_RANGE, never
   * a HARD_RULE). isDataGap drives "Needs More Information"/"not verified" language instead of a
   * false decline.
   */
  isDataGap?: boolean;
  /** The rule type of the criterion this reason evaluated, for grouping/labeling in the UI. */
  ruleType: RuleType;
  group: ReasonGroup;
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
  /**
   * 0-100 internal fit signal used only for sort-ordering within a verdict tier. Per product
   * requirement, never rendered as a percentage/number in the UI — verdict + the verified/needs-
   * verification counts communicate fit instead.
   */
  matchScore: number;
  /** Count of reasons that are a verified pass — the actual evidence behind the recommendation. */
  verifiedMatchCount: number;
  /** Count of reasons that are a data gap (account or market data unknown) — what still needs confirming. */
  needsVerificationCount: number;
  freshness: FreshnessState;
  freshnessMessage?: string;
  underwritingNotes: string;
}
