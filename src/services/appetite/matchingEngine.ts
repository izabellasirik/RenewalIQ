import type { AppetiteRecord, MatchReason, MatchResult, RiskProfile, Verdict } from '../../types';
import { ALL_RULES } from './rules';
import { computeRecordFreshness } from './freshness';

/** Below this many verified (not data-gap) pass criteria, there isn't enough real signal to make a call either way. */
const MIN_VERIFIED_FOR_A_VERDICT = 2;

/**
 * Score measures fit strength (0-100) among verified criteria only — it does not penalize
 * unknown market data the way it penalizes an actual soft mismatch. Only meaningful for markets
 * that aren't a hard fail; not_eligible/needs_more_information verdicts hide it in the UI.
 */
export function computeMatchScore(reasons: MatchReason[]): number {
  const total = reasons.length;
  const pass = reasons.filter((r) => r.status === 'pass').length;
  const warn = reasons.filter((r) => r.status === 'warning').length;
  return Math.round((pass * 100 + warn * 55) / total);
}

function deriveVerdict(reasons: MatchReason[], score: number): Verdict {
  const hasFail = reasons.some((r) => r.status === 'fail');
  if (hasFail) return 'not_eligible';

  const verifiedPassCount = reasons.filter((r) => r.status === 'pass').length;
  if (verifiedPassCount < MIN_VERIFIED_FOR_A_VERDICT) return 'needs_more_information';

  if (score >= 90) return 'strong_match';
  if (score >= 75) return 'good_match';
  if (score >= 60) return 'possible_match';
  return 'needs_more_information';
}

export function evaluateMarket(record: AppetiteRecord, profile: RiskProfile): MatchResult {
  const reasons = ALL_RULES.map((rule) => rule(record, profile));
  const hasFail = reasons.some((r) => r.status === 'fail');
  const score = computeMatchScore(reasons);
  const verdict = deriveVerdict(reasons, score);
  const freshness = computeRecordFreshness(record);

  return {
    appetiteRecordId: record.id,
    marketName: record.marketName,
    parentCompany: record.parentCompany,
    programName: record.programName,
    marketType: record.marketType,
    availableThrough: record.availableThrough,
    verdict,
    reasons,
    matchScore: hasFail ? 0 : score,
    verifiedMatchCount: reasons.filter((r) => r.status === 'pass').length,
    needsVerificationCount: reasons.filter((r) => r.status === 'warning' && r.isDataGap).length,
    freshness: freshness.state,
    freshnessMessage: freshness.message,
    underwritingNotes: record.underwritingNotes,
  };
}

export const VERDICT_RANK: Record<Verdict, number> = {
  strong_match: 0,
  good_match: 1,
  possible_match: 2,
  needs_more_information: 3,
  not_eligible: 4,
};

export function matchAllMarkets(records: AppetiteRecord[], profile: RiskProfile): MatchResult[] {
  return records
    .map((record) => evaluateMarket(record, profile))
    .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
}
