import type { AppetiteCriterion, CriterionSource, RuleType, SourceType } from '../types';

/** Shared constructors for AppetiteCriterion so every dataset (real or fixture) builds the same shape. */
export function source(sourceType: SourceType, sourceName?: string, opts?: Partial<Pick<CriterionSource, 'sourceUrl' | 'verifiedAt' | 'sourcePublishedAt'>>): CriterionSource {
  return { sourceType, sourceName, ...opts };
}

/** A fully verified fact against an authoritative source. ruleType decides whether violating it can ever decline the account. */
export function verifiedCriterion<T>(value: T, ruleType: RuleType, criterionSource: CriterionSource, notes?: string): AppetiteCriterion<T> {
  return { value, verificationStatus: 'VERIFIED', ruleType, source: criterionSource, notes };
}

/** Part of the fact is confirmed (e.g. an admitted-states list with no stated exclusions) but it may not be the complete picture. */
export function partiallyVerifiedCriterion<T>(value: T, ruleType: RuleType, criterionSource: CriterionSource, notes?: string): AppetiteCriterion<T> {
  return { value, verificationStatus: 'PARTIALLY_VERIFIED', ruleType, source: criterionSource, notes };
}

/** We have a lead (a broker mention, an unconfirmed secondary source) but haven't verified it yet — distinct from pure UNKNOWN, which means no info at all. */
export function needsConfirmationCriterion<T>(value: T | null, criterionSource: CriterionSource, notes?: string): AppetiteCriterion<T> {
  return { value, verificationStatus: 'NEEDS_CONFIRMATION', ruleType: 'UNKNOWN', source: criterionSource, notes };
}

/** A missing rule, represented explicitly — never eligible, ineligible, or failed, just not verified. */
export function unknownCriterion<T>(notes?: string): AppetiteCriterion<T> {
  return { value: null, verificationStatus: 'UNKNOWN', ruleType: 'UNKNOWN', source: { sourceType: 'UNKNOWN' }, notes };
}
