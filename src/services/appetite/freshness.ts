import { daysSince, formatDate } from '../../utils/dates';
import type { AppetiteCriterion, AppetiteRecord, CriterionSource, FreshnessState } from '../../types';

/** Verified data at or under this age reads as current; beyond it, aging; well beyond, stale. */
const AGING_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_DAYS = 270;

/**
 * Freshness for a single criterion's source. UNKNOWN status (no verifiedAt) is not "stale" —
 * staleness only applies to something we once verified and that verification is now aging.
 */
export function computeCriterionFreshness(source: CriterionSource): FreshnessState {
  if (!source.verifiedAt) return 'UNKNOWN';
  const days = daysSince(source.verifiedAt);
  if (days <= AGING_THRESHOLD_DAYS) return 'CURRENT';
  if (days <= STALE_THRESHOLD_DAYS) return 'AGING';
  return 'STALE';
}

export function buildCriterionFreshnessMessage(source: CriterionSource): string | undefined {
  const state = computeCriterionFreshness(source);
  if (state === 'CURRENT' || state === 'UNKNOWN' || !source.verifiedAt) return undefined;
  const days = daysSince(source.verifiedAt);
  const word = state === 'STALE' ? 'Stale' : 'Aging';
  return `${word} — last verified ${formatDate(source.verifiedAt)} (${days} days ago). Confirm with the market before quoting.`;
}

const FRESHNESS_RANK: Record<FreshnessState, number> = { STALE: 0, AGING: 1, UNKNOWN: 2, CURRENT: 3 };

function allCriteria(record: AppetiteRecord): AppetiteCriterion<unknown>[] {
  return [
    record.states,
    record.fleetSize,
    record.yearsInBusinessMin,
    record.operationTypes,
    record.maxRadius,
    record.commodities,
    record.minDriverAge,
    record.minDriverExperienceYears,
    record.telematicsRequired,
    record.dashcamRequired,
    record.majorExclusions,
    record.maxClaimsPast3Years,
    record.maxIncurredPerUnit,
    record.linesOffered,
  ];
}

/**
 * Aggregate freshness across every VERIFIED criterion on a record — the least-fresh verified
 * fact drives the message, since that's the one most likely to have changed since we checked.
 * A record with no verified criteria at all has nothing to be stale about, so it reads UNKNOWN.
 */
export function computeRecordFreshness(record: AppetiteRecord): { state: FreshnessState; message?: string } {
  const verified = allCriteria(record).filter((c) => c.status === 'VERIFIED' && c.source.verifiedAt);
  if (verified.length === 0) return { state: 'UNKNOWN' };

  const leastFresh = verified.reduce((worst, c) => {
    const state = computeCriterionFreshness(c.source);
    return FRESHNESS_RANK[state] < FRESHNESS_RANK[computeCriterionFreshness(worst.source)] ? c : worst;
  });

  return { state: computeCriterionFreshness(leastFresh.source), message: buildCriterionFreshnessMessage(leastFresh.source) };
}
