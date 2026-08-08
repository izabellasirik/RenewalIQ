import type { AppetiteCriterion, CriterionSource, SourceType } from '../types';

/** Shared constructors for AppetiteCriterion so every dataset (real or fixture) builds the same shape. */
export function source(sourceType: SourceType, sourceName?: string, opts?: Partial<Pick<CriterionSource, 'sourceUrl' | 'verifiedAt' | 'sourcePublishedAt'>>): CriterionSource {
  return { sourceType, sourceName, ...opts };
}

export function verifiedCriterion<T>(value: T, criterionSource: CriterionSource, notes?: string): AppetiteCriterion<T> {
  return { value, status: 'VERIFIED', source: criterionSource, notes };
}

/** A missing rule, represented explicitly — never eligible, ineligible, or failed, just not verified. */
export function unknownCriterion<T>(notes?: string): AppetiteCriterion<T> {
  return { value: null, status: 'UNKNOWN', source: { sourceType: 'UNKNOWN' }, notes };
}
