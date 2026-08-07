import type {
  RiskProfile,
  ExtractedFieldResult,
  FieldValue,
  Confidence,
  CoverageType,
  LossEntry,
} from '../../types';
import { CONFIDENCE_ORDER } from '../../utils/confidence';
import { generateId } from '../../utils/id';

function isEqualValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Merges a newly-extracted value into an existing FieldValue. When two documents
 * disagree, the higher-confidence value wins as the primary and the loser is kept
 * as an alternate so the broker can see and resolve the conflict — nothing is
 * silently overwritten or silently dropped.
 */
export function mergeFieldValue<T>(
  existing: FieldValue<T> | undefined,
  result: ExtractedFieldResult
): FieldValue<T> {
  const incoming: FieldValue<T> = {
    value: result.value as T,
    confidence: result.confidence,
    source: result.source,
    isMissing: false,
    isConflicting: false,
    extractionMethod: result.extractionMethod ?? 'ai_extraction',
    lastUpdatedAt: new Date().toISOString(),
  };

  if (!existing || existing.isMissing || existing.value === null) {
    return incoming;
  }

  if (isEqualValue(existing.value, incoming.value)) {
    // Same value from a second document — corroborates it. Keep the stronger confidence.
    const stronger = CONFIDENCE_ORDER[incoming.confidence] < CONFIDENCE_ORDER[existing.confidence];
    return stronger ? { ...incoming, isConflicting: existing.isConflicting, alternateValues: existing.alternateValues } : existing;
  }

  // Genuine conflict: two documents disagree. Higher confidence becomes primary.
  const incomingWins = CONFIDENCE_ORDER[incoming.confidence] < CONFIDENCE_ORDER[existing.confidence];
  const primary = incomingWins ? incoming : existing;
  const loser = incomingWins ? existing : incoming;

  return {
    ...primary,
    isConflicting: true,
    alternateValues: [
      ...(existing.alternateValues ?? []),
      ...(loser.value !== null && loser.source ? [{ value: loser.value, source: loser.source }] : []),
    ],
  };
}

function setByPath(profile: RiskProfile, fieldPath: string, result: ExtractedFieldResult): void {
  if (fieldPath === 'lossHistory') {
    const entry = result.value as Omit<LossEntry, 'id' | 'source'>;
    profile.lossHistory.push({ ...entry, id: generateId('loss'), source: result.source });
    return;
  }

  const parts = fieldPath.split('.');

  if (parts[0] === 'coverage') {
    const [, coverageType, sub] = parts as [string, CoverageType, 'currentLimit' | 'requestedLimit'];
    let line = profile.coverage.find((c) => c.type === coverageType);
    if (!line) {
      line = { type: coverageType, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } };
      profile.coverage.push(line);
    }
    line[sub] = mergeFieldValue(line[sub], result);
    return;
  }

  const [section, key] = parts as ['business' | 'transportation', string];
  const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
  bucket[key] = mergeFieldValue(bucket[key], result);
}

/** Applies a batch of extracted field results (from one document) onto a risk profile draft, in place. */
export function applyExtractionResults(profile: RiskProfile, results: ExtractedFieldResult[]): RiskProfile {
  for (const result of results) {
    setByPath(profile, result.fieldPath, result);
  }
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Sets a field value from a manual broker edit — always treated as ground truth. */
export function applyManualEdit<T>(
  profile: RiskProfile,
  section: 'business' | 'transportation',
  key: string,
  value: T
): RiskProfile {
  const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
  bucket[key] = {
    value,
    confidence: 'manual' as Confidence,
    isMissing: value === null || (Array.isArray(value) && value.length === 0),
    isConflicting: false,
    extractionMethod: 'manual_entry',
    lastUpdatedAt: new Date().toISOString(),
  };
  profile.updatedAt = new Date().toISOString();
  return profile;
}
