import type { CoverageType, FieldValue, RiskProfile } from '../types';

/**
 * Resolves a dot-path like "business.namedInsured" or "coverage.auto_liability.requestedLimit"
 * to the FieldValue at that location. Returns null for paths that don't resolve (e.g. a coverage
 * line that hasn't been extracted yet) — callers treat that the same as a missing field.
 */
export function getFieldValueByPath(profile: RiskProfile, path: string): FieldValue<unknown> | null {
  const parts = path.split('.');

  if (parts[0] === 'coverage') {
    const [, coverageType, sub] = parts as [string, CoverageType, 'currentLimit' | 'requestedLimit'];
    const line = profile.coverage.find((c) => c.type === coverageType);
    if (!line) return null;
    return (line[sub] as FieldValue<unknown> | undefined) ?? null;
  }

  if (parts[0] === 'business' || parts[0] === 'transportation') {
    const bucket = profile[parts[0]] as unknown as Record<string, FieldValue<unknown>>;
    return bucket[parts[1]] ?? null;
  }

  return null;
}

/** Where a dot-path's value actually needs to be written back — a scalar business/transportation field, or one side of a coverage line. Shared by every surface that edits a MappedField's riskProfilePath back into the canonical Risk Profile (Submission Assistant, the "What's Missing?" panel), so there's one parser instead of each screen re-deriving it. */
export type RiskProfileSaveTarget =
  | { kind: 'field'; section: 'business' | 'transportation'; key: string }
  | { kind: 'coverage'; coverageType: CoverageType; field: 'currentLimit' | 'requestedLimit' }
  | null;

export function parseRiskProfilePath(path: string): RiskProfileSaveTarget {
  const parts = path.split('.');
  if (parts[0] === 'coverage') {
    return { kind: 'coverage', coverageType: parts[1] as CoverageType, field: (parts[2] as 'currentLimit' | 'requestedLimit') ?? 'requestedLimit' };
  }
  if (parts[0] === 'business' || parts[0] === 'transportation') {
    return { kind: 'field', section: parts[0], key: parts[1] };
  }
  return null;
}
