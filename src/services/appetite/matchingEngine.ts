import type { AppetiteRecord, MatchReason, MatchResult, RiskProfile, Verdict } from '../../types';
import { ALL_RULES } from './rules';
import { buildStaleWarning, isStale } from './freshness';

function isDataGapWarning(reason: MatchReason): boolean {
  const t = reason.explanation.toLowerCase();
  return t.includes('unconfirmed') || (t.includes('not') && t.includes('confirm'));
}

function deriveVerdict(reasons: MatchReason[]): Verdict {
  const hasFail = reasons.some((r) => r.status === 'fail');
  if (hasFail) return 'not_eligible';

  const warnings = reasons.filter((r) => r.status === 'warning');
  if (warnings.length === 0) return 'strong_match';

  const hasDataGap = warnings.some(isDataGapWarning);
  return hasDataGap ? 'verify' : 'possible_match';
}

/**
 * Score measures fit strength (0-100), independent of the verdict which measures confidence
 * to proceed — a market can score high but still be "Verify" pending one unconfirmed detail.
 * Any hard fail caps the score low since the account is disqualified regardless of how well
 * everything else lines up.
 */
export function computeMatchScore(reasons: MatchReason[]): number {
  const total = reasons.length;
  const pass = reasons.filter((r) => r.status === 'pass').length;
  const warn = reasons.filter((r) => r.status === 'warning').length;
  const fail = reasons.filter((r) => r.status === 'fail').length;

  if (fail > 0) {
    return Math.round(Math.min(35, (pass * 100) / total));
  }
  return Math.round((pass * 100 + warn * 60) / total);
}

export function evaluateMarket(record: AppetiteRecord, profile: RiskProfile): MatchResult {
  const reasons = ALL_RULES.map((rule) => rule(record, profile));
  const verdict = deriveVerdict(reasons);

  return {
    appetiteRecordId: record.id,
    marketName: record.marketName,
    marketType: record.marketType,
    availableThrough: record.availableThrough,
    verdict,
    reasons,
    matchScore: computeMatchScore(reasons),
    isStale: isStale(record.lastVerifiedDate),
    staleWarning: buildStaleWarning(record.lastVerifiedDate),
    lastVerifiedDate: record.lastVerifiedDate,
    sourceContact: record.sourceContact,
    confidence: record.confidence,
    underwritingNotes: record.underwritingNotes,
  };
}

const VERDICT_RANK: Record<Verdict, number> = {
  strong_match: 0,
  possible_match: 1,
  verify: 2,
  not_eligible: 3,
};

export function matchAllMarkets(records: AppetiteRecord[], profile: RiskProfile): MatchResult[] {
  return records
    .map((record) => evaluateMarket(record, profile))
    .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
}
