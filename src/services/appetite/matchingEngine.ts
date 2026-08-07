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
    isStale: isStale(record.lastVerifiedDate),
    staleWarning: buildStaleWarning(record.lastVerifiedDate),
    lastVerifiedDate: record.lastVerifiedDate,
    sourceContact: record.sourceContact,
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
