import type { AppetiteRecord, MatchReason, MatchResult, RiskProfile, Verdict } from '../../types';
import { ALL_RULES } from './rules';
import { computeRecordFreshness, computeRulesMarketFreshness } from './freshness';
import { bestCoverageVerdict, evaluateRulesByCoverage, rulesFitScore } from './carrierRules';

/** Below this many verified (not data-gap) pass criteria, there isn't enough real signal to make a useful call either way. */
const MIN_VERIFIED_FOR_A_VERDICT = 2;

/** At most this fraction of criteria may remain unresolved (data gaps) for a market to read as a confident "Likely Match" rather than "Possible Match". */
const LIKELY_MATCH_MAX_GAP_RATIO = 0.2;

/**
 * Internal fit signal (0-100) among verified criteria only — used purely to order results within
 * the same verdict tier. Per product requirement, never rendered as a percentage/number in the UI.
 */
export function computeMatchScore(reasons: MatchReason[]): number {
  const total = reasons.length;
  const pass = reasons.filter((r) => r.status === 'pass').length;
  const warn = reasons.filter((r) => r.status === 'warning').length;
  return Math.round((pass * 100 + warn * 55) / total);
}

/**
 * Four-tier verdict:
 * NOT_ELIGIBLE       — at least one verified HARD_RULE fails.
 * NEEDS_MORE_INFORMATION — too few verified-pass criteria (either the account or the market's
 *                      published appetite) to make a useful recommendation.
 * LIKELY_MATCH        — no hard-rule failures, and most relevant criteria are actually verified.
 * POSSIBLE_MATCH       — no hard-rule failures, but a meaningful share of criteria remain unknown.
 */
function deriveVerdict(reasons: MatchReason[]): Verdict {
  const hasHardFail = reasons.some((r) => r.status === 'fail');
  if (hasHardFail) return 'not_eligible';

  const total = reasons.length;
  const verifiedPass = reasons.filter((r) => r.status === 'pass').length;
  if (verifiedPass < MIN_VERIFIED_FOR_A_VERDICT) return 'needs_more_information';

  const dataGaps = reasons.filter((r) => r.status === 'warning' && r.isDataGap).length;
  const gapRatio = dataGaps / total;
  return gapRatio <= LIKELY_MATCH_MAX_GAP_RATIO ? 'likely_match' : 'possible_match';
}

/** Carrier 101/102 markets (the agency's access details and/or underwriting rules) are matched on their rules. */
export function isRulesMarket(record: AppetiteRecord): boolean {
  return !!record.access || (record.rules?.length ?? 0) > 0;
}

/**
 * A Carrier 102 market: its rules, coverage by coverage, plus whatever built-in criteria ARE
 * verified for it (never overwritten — an unknown built-in criterion is simply left out, the
 * rules speak for it). The market's verdict is its best coverage; each coverage is kept.
 */
function evaluateRulesMarket(record: AppetiteRecord, profile: RiskProfile): MatchResult {
  const builtIn = ALL_RULES.map((rule) => rule(record, profile)).filter((r) => !r.marketUnknown);
  const coverageResults = evaluateRulesByCoverage(record.rules ?? [], profile, builtIn);
  const verdict = bestCoverageVerdict(coverageResults);
  const seen = new Set<string>();
  const reasons = coverageResults.flatMap((c) => c.reasons).filter((r) => {
    const key = `${r.ruleId ?? r.criterion}|${r.explanation}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const freshness = computeRulesMarketFreshness(record);
  return {
    appetiteRecordId: record.id,
    marketName: record.marketName,
    parentCompany: record.parentCompany,
    programName: record.programName,
    marketType: record.marketType,
    availableThrough: record.availableThrough,
    verdict,
    reasons,
    matchScore: verdict === 'not_eligible' || reasons.length === 0 ? 0 : rulesFitScore(reasons),
    verifiedMatchCount: reasons.filter((r) => r.status === 'pass' && r.ruleVerified !== false).length,
    needsVerificationCount: reasons.filter((r) => r.status === 'warning' && r.isDataGap).length,
    freshness: freshness.state,
    freshnessMessage: freshness.message,
    underwritingNotes: record.underwritingNotes,
    access: record.access,
    rulesMode: true,
    coverageResults,
  };
}

export function evaluateMarket(record: AppetiteRecord, profile: RiskProfile): MatchResult {
  if (isRulesMarket(record)) return evaluateRulesMarket(record, profile);
  const reasons = ALL_RULES.map((rule) => rule(record, profile));
  const hasFail = reasons.some((r) => r.status === 'fail');
  const score = computeMatchScore(reasons);
  const verdict = deriveVerdict(reasons);
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
  likely_match: 0,
  possible_match: 1,
  needs_more_information: 2,
  not_eligible: 3,
};

export function matchAllMarkets(records: AppetiteRecord[], profile: RiskProfile): MatchResult[] {
  return records
    // An inactive market (Carrier 101) is not suggested at all.
    .filter((record) => record.access?.status !== 'inactive')
    .map((record) => evaluateMarket(record, profile))
    .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.verifiedMatchCount - a.verifiedMatchCount || b.matchScore - a.matchScore);
}
