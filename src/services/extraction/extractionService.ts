import type {
  RiskProfile,
  ExtractedFieldResult,
  FieldValue,
  Confidence,
  CoverageType,
  LossEntry,
  VehicleEntry,
  DriverEntry,
} from '../../types';
import { CONFIDENCE_ORDER } from '../../utils/confidence';
import { generateId } from '../../utils/id';

function isEqualScalar(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/** Two documents disagreeing only in case/whitespace ("General Freight" vs "general freight") corroborate each other, not conflict. */
function isEqualValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isEqualScalar(v, b[i]));
  }
  return isEqualScalar(a, b);
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

/** Loose equality for itemized-row scalar fields — ignores case/whitespace, same spirit as isEqualValue. */
function isEqualField(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * True if `entry` is an exact re-statement of a row already in `existing` — same natural key
 * (the field(s) that identify "the same real-world thing") and every other field equal too. This
 * is what makes re-uploading the same schedule a no-op instead of silently doubling every derived
 * total (fleet size, total insured value, claim counts, ...). Rows that share a key but disagree
 * on other fields are NOT deduped — both are kept, same "don't silently pick one" principle the
 * scalar-field merge already follows, just without a conflict badge since itemized rows don't have one yet.
 */
function isDuplicateRow<T extends Record<string, unknown>>(existing: T[], entry: T, keyFields: (keyof T)[]): boolean {
  const hasKey = keyFields.some((k) => entry[k] !== undefined && entry[k] !== '');
  if (!hasKey) return false;
  return existing.some((row) => {
    const sameKey = keyFields.every((k) => (entry[k] === undefined ? row[k] === undefined : isEqualField(row[k], entry[k])));
    if (!sameKey) return false;
    const allFields = Object.keys(entry) as (keyof T)[];
    return allFields.every((k) => isEqualField(row[k], entry[k]));
  });
}

function setByPath(profile: RiskProfile, fieldPath: string, result: ExtractedFieldResult): void {
  if (fieldPath === 'lossHistory') {
    const entry = result.value as Omit<LossEntry, 'id' | 'source'>;
    if (isDuplicateRow(profile.lossHistory, entry, ['lossDate', 'claimType', 'incurred'])) return;
    profile.lossHistory.push({ ...entry, id: generateId('loss'), source: result.source });
    return;
  }

  if (fieldPath === 'vehicles') {
    const entry = result.value as Omit<VehicleEntry, 'id' | 'source'>;
    if (isDuplicateRow(profile.vehicles, entry, ['vin'])) return;
    profile.vehicles.push({ ...entry, id: generateId('veh'), source: result.source });
    return;
  }

  if (fieldPath === 'drivers') {
    const entry = result.value as Omit<DriverEntry, 'id' | 'source'>;
    if (isDuplicateRow(profile.drivers, entry, ['name', 'dob'])) return;
    profile.drivers.push({ ...entry, id: generateId('drv'), source: result.source });
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

/** Merges a batch of extracted field results (from one document) into a risk profile draft, in place. */
export function mergeIntoRiskProfile(profile: RiskProfile, results: ExtractedFieldResult[]): RiskProfile {
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
