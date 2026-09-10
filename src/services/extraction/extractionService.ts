import type {
  RiskProfile,
  ExtractedFieldResult,
  FieldValue,
  CoverageType,
  LossEntry,
  VehicleEntry,
  DriverEntry,
} from '../../types';
import { emptyField } from '../../types';
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
    // Same value from a second document — corroborates it. When the second read is specifically a
    // vision-model read agreeing with an on-device-OCR read of the SAME image (or vice versa) —
    // two independent extraction mechanisms, not just two documents — that's stronger evidence
    // than either alone, so the confidence is boosted rather than just keeping the stronger of the
    // two. Any other pairing (e.g. two OCR reads from different documents) keeps today's behavior:
    // the stronger of the two confidences wins, never invented beyond what either read alone earned.
    //
    // confirmedByBroker is carried over from `existing` whenever it was already true — a fresh
    // extraction agreeing with a value the broker already explicitly confirmed doesn't un-confirm
    // it — but it is NEVER set here otherwise; corroboration between two AI sources is still an AI
    // result, never "broker confirmed" on its own.
    const methods = new Set([incoming.extractionMethod, existing.extractionMethod]);
    const isVisionOcrCorroboration = incoming.confidence !== 'low' && existing.confidence !== 'low' && methods.has('vision_extraction') && methods.has('image_ocr');
    if (isVisionOcrCorroboration) {
      return { ...incoming, confidence: 'high', isConflicting: existing.isConflicting, alternateValues: existing.alternateValues, confirmedByBroker: existing.confirmedByBroker };
    }
    const stronger = CONFIDENCE_ORDER[incoming.confidence] < CONFIDENCE_ORDER[existing.confidence];
    return stronger ? { ...incoming, isConflicting: existing.isConflicting, alternateValues: existing.alternateValues, confirmedByBroker: existing.confirmedByBroker } : existing;
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
      ...(loser.value !== null && loser.source ? [{ value: loser.value, source: loser.source, extractionMethod: loser.extractionMethod }] : []),
    ],
  };
}

export type FieldResolution<T> = { type: 'primary' } | { type: 'alternate'; index: number } | { type: 'manual'; value: T };

/**
 * Resolves a conflicting (or any) field per the broker's explicit choice — pick the current
 * primary, pick one of the alternates (swapping it in, preserving its own source/extractionMethod),
 * or type a brand-new value. In every case the field becomes 'manual' confidence and
 * isConflicting clears, but nothing is discarded: whichever options aren't chosen are kept in
 * alternateValues as history, so provenance survives resolution. This is the ONLY place
 * confirmedByBroker is ever set true — every branch here is reached exclusively from an explicit
 * broker action in the conflict-resolver UI (see FieldRow.tsx's ConflictResolver and
 * NewAccountPage.tsx's identity-resolution step), never automatically.
 */
export function resolveFieldConflict<T>(existing: FieldValue<T>, resolution: FieldResolution<T>): FieldValue<T> {
  const now = new Date().toISOString();

  if (resolution.type === 'primary') {
    return { ...existing, confidence: 'manual', isConflicting: false, confirmedByBroker: true, lastUpdatedAt: now };
  }

  if (resolution.type === 'alternate') {
    const alternates = existing.alternateValues ?? [];
    const chosen = alternates[resolution.index];
    if (!chosen) return existing;
    const demotedPrimary = existing.value !== null && existing.source ? [{ value: existing.value, source: existing.source, extractionMethod: existing.extractionMethod }] : [];
    const remaining = [...alternates.slice(0, resolution.index), ...alternates.slice(resolution.index + 1), ...demotedPrimary];
    return {
      value: chosen.value,
      confidence: 'manual',
      isMissing: false,
      isConflicting: false,
      confirmedByBroker: true,
      source: chosen.source,
      extractionMethod: chosen.extractionMethod ?? 'ai_extraction',
      alternateValues: remaining.length > 0 ? remaining : undefined,
      lastUpdatedAt: now,
    };
  }

  // type === 'manual': a genuinely new, typed value — still keeps every prior option as history.
  // extractionMethod: 'manual_entry' already takes display priority as "Broker Edited" over
  // confirmedByBroker's "Broker Confirmed" (see fieldDataStatus) — set here anyway since it's
  // also, genuinely, broker-confirmed content, just additionally edited.
  const priorAlternates = existing.alternateValues ?? [];
  const demotedPrimary = existing.value !== null && existing.source ? [{ value: existing.value, source: existing.source, extractionMethod: existing.extractionMethod }] : [];
  const history = [...priorAlternates, ...demotedPrimary];
  return {
    value: resolution.value,
    confidence: 'manual',
    isMissing: resolution.value === null || (Array.isArray(resolution.value) && resolution.value.length === 0),
    isConflicting: false,
    confirmedByBroker: true,
    extractionMethod: 'manual_entry',
    alternateValues: history.length > 0 ? history : undefined,
    lastUpdatedAt: now,
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

  if (fieldPath === 'coverageLine') {
    const coverageType = result.value as CoverageType;
    if (!profile.coverage.find((c) => c.type === coverageType)) {
      profile.coverage.push({ type: coverageType, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } });
    }
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

/** Sets a field value from a manual broker edit — always treated as ground truth. Preserves whatever was there before (source, extracted alternates) as history rather than discarding it. */
export function applyManualEdit<T>(
  profile: RiskProfile,
  section: 'business' | 'transportation',
  key: string,
  value: T
): RiskProfile {
  const bucket = profile[section] as unknown as Record<string, FieldValue<T>>;
  const existing = bucket[key] ?? emptyField<T>();
  bucket[key] = resolveFieldConflict(existing, { type: 'manual', value });
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Applies a broker's explicit conflict resolution (pick primary / pick an alternate / type manually) to one field. */
export function applyFieldResolution<T>(
  profile: RiskProfile,
  section: 'business' | 'transportation',
  key: string,
  resolution: FieldResolution<T>
): RiskProfile {
  const bucket = profile[section] as unknown as Record<string, FieldValue<T>>;
  const existing = bucket[key] ?? emptyField<T>();
  bucket[key] = resolveFieldConflict(existing, resolution);
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Same as applyFieldResolution, for a coverage line's currentLimit/requestedLimit — the one other place a FieldValue can conflict. */
export function applyCoverageFieldResolution(
  profile: RiskProfile,
  coverageType: CoverageType,
  field: 'currentLimit' | 'requestedLimit',
  resolution: FieldResolution<string>
): RiskProfile {
  const line = profile.coverage.find((c) => c.type === coverageType);
  if (!line) return profile;
  const existing = line[field] ?? emptyField<string>();
  line[field] = resolveFieldConflict(existing, resolution);
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/**
 * Adds/edits/deletes one row of an itemized collection (vehicles/drivers/lossHistory) — the same
 * three operations for all three arrays, since they share the same "row with an id" shape. Broker
 * additions/edits are always marked isManual so a later document deletion (see
 * removeDocumentFromRiskProfile) knows never to touch them — there's no source document to
 * invalidate them.
 */
export function addRecordEntry<T extends { id: string }>(list: T[], entry: Omit<T, 'id'>, idPrefix: string): T[] {
  const now = new Date().toISOString();
  return [...list, { ...entry, id: generateId(idPrefix), isManual: true, lastUpdatedAt: now } as unknown as T];
}

export function updateRecordEntry<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  const now = new Date().toISOString();
  return list.map((item) => (item.id === id ? { ...item, ...patch, isManual: true, lastUpdatedAt: now } : item));
}

export function deleteRecordEntry<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

/**
 * Removes a deleted document's influence from the risk profile, without discarding anything a
 * broker has since confirmed or that another surviving document still supports:
 *  - a broker-confirmed/edited value (confidence 'manual') is never touched — the source document
 *    disappearing doesn't make a human decision wrong.
 *  - a conflicting alternate that came from the deleted document is simply dropped; if that was
 *    the only disagreement, the field stops being a conflict.
 *  - a primary value whose *only* support was the deleted document falls back to the strongest
 *    remaining alternate (if any), demoted to 'medium' confidence since we no longer know its
 *    original confidence — or to fully missing if nothing else ever supported it. Never guesses a
 *    new value.
 *  - itemized rows (vehicles/drivers/losses) that came only from the deleted document are removed
 *    outright, since — unlike scalar fields — a row has exactly one source and no alternates.
 */
export function removeDocumentFromRiskProfile(profile: RiskProfile, documentId: string): RiskProfile {
  function demote<T>(field: FieldValue<T> | undefined): FieldValue<T> | undefined {
    if (!field || field.isMissing || field.confidence === 'manual') return field;
    const survivingAlternates = (field.alternateValues ?? []).filter((a) => a.source.documentId !== documentId);

    if (field.source?.documentId !== documentId) {
      if (survivingAlternates.length === (field.alternateValues ?? []).length) return field;
      return { ...field, alternateValues: survivingAlternates.length > 0 ? survivingAlternates : undefined, isConflicting: survivingAlternates.length > 0 };
    }

    if (survivingAlternates.length === 0) return emptyField<T>();

    const [promoted, ...rest] = survivingAlternates;
    return {
      value: promoted.value,
      confidence: 'medium',
      source: promoted.source,
      extractionMethod: promoted.extractionMethod ?? 'ai_extraction',
      isMissing: false,
      isConflicting: rest.some((alt) => !isEqualValue(alt.value, promoted.value)),
      alternateValues: rest.length > 0 ? rest : undefined,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  for (const section of ['business', 'transportation'] as const) {
    const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
    for (const key of Object.keys(bucket)) {
      const updated = demote(bucket[key]);
      if (updated) bucket[key] = updated;
    }
  }

  profile.coverage = profile.coverage.map((line) => ({
    ...line,
    currentLimit: demote(line.currentLimit),
    requestedLimit: demote(line.requestedLimit) ?? line.requestedLimit,
  }));

  profile.vehicles = profile.vehicles.filter((v) => v.isManual || v.source?.documentId !== documentId);
  profile.drivers = profile.drivers.filter((d) => d.isManual || d.source?.documentId !== documentId);
  profile.lossHistory = profile.lossHistory.filter((l) => l.isManual || l.source?.documentId !== documentId);

  profile.updatedAt = new Date().toISOString();
  return profile;
}

/**
 * Best-effort, read-only summary of what a document's removal would affect — shown in the delete
 * confirmation so the broker knows before confirming, not just after. Mirrors the same rules as
 * removeDocumentFromRiskProfile without mutating anything.
 */
export function previewDocumentRemovalImpact(profile: RiskProfile, documentId: string): { fields: number; vehicles: number; drivers: number; losses: number } {
  let fields = 0;
  const isSolelySourced = (field: FieldValue<unknown> | undefined) =>
    !!field && !field.isMissing && field.confidence !== 'manual' && field.source?.documentId === documentId && !(field.alternateValues ?? []).some((a) => a.source.documentId !== documentId);

  for (const section of ['business', 'transportation'] as const) {
    const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
    for (const key of Object.keys(bucket)) if (isSolelySourced(bucket[key])) fields++;
  }
  for (const line of profile.coverage) {
    if (isSolelySourced(line.currentLimit)) fields++;
    if (isSolelySourced(line.requestedLimit)) fields++;
  }

  return {
    fields,
    vehicles: profile.vehicles.filter((v) => !v.isManual && v.source?.documentId === documentId).length,
    drivers: profile.drivers.filter((d) => !d.isManual && d.source?.documentId === documentId).length,
    losses: profile.lossHistory.filter((l) => !l.isManual && l.source?.documentId === documentId).length,
  };
}
