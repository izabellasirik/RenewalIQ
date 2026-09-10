import type { CoverageType, DriverEntry, FieldValue, LossEntry, RiskProfile, UploadedDocument, VehicleEntry } from '../types';

/**
 * Whether a field this document extracted is still reflected in the current Risk Profile, computed
 * live against the CURRENT profile rather than frozen at upload time — a later document or a
 * broker's own edit can change a field's disposition after the fact, and "applied" should always
 * mean "still true right now," not "was true when this document was processed."
 */
export type FieldDisposition = 'applied' | 'needs_review' | 'conflict' | 'superseded' | 'not_applied';

export interface DocumentFieldSummary {
  fieldPath: string;
  value: unknown;
  confidence: string;
  extractionMethod?: string;
  disposition: FieldDisposition;
  /** Populated only for 'superseded' — what the Risk Profile currently shows instead. */
  currentValue?: unknown;
}

function isEqualLoose(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => isEqualLoose(v, b[i]));
  return a === b;
}

function dispositionForFieldValue<T>(current: FieldValue<T> | undefined, extractedValue: unknown): { disposition: FieldDisposition; currentValue?: unknown } {
  if (!current || current.isMissing) return { disposition: 'not_applied' };
  if (isEqualLoose(current.value, extractedValue)) {
    if (current.isConflicting) return { disposition: 'conflict', currentValue: current.value };
    if (current.confidence === 'low') return { disposition: 'needs_review' };
    return { disposition: 'applied' };
  }
  const inAlternates = (current.alternateValues ?? []).some((alt) => isEqualLoose(alt.value, extractedValue));
  if (inAlternates) return { disposition: current.isConflicting ? 'conflict' : 'superseded', currentValue: current.value };
  return { disposition: 'not_applied', currentValue: current.value };
}

function scalarFieldValue(profile: RiskProfile, fieldPath: string): FieldValue<unknown> | undefined {
  if (fieldPath === 'coverageLine') return undefined; // membership-only field, no FieldValue to compare
  if (fieldPath.startsWith('coverage.')) {
    const [, coverageType, sub] = fieldPath.split('.') as [string, CoverageType, 'requestedLimit' | 'currentLimit'];
    const line = profile.coverage.find((c) => c.type === coverageType);
    return line?.[sub];
  }
  const [section, key] = fieldPath.split('.') as ['business' | 'transportation', string];
  const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>> | undefined;
  return bucket?.[key];
}

function rowDisposition(rows: { source?: { documentId: string } }[], documentId: string, matchesValue: (row: unknown) => boolean): FieldDisposition {
  if (rows.some((r) => r.source?.documentId === documentId)) return 'applied';
  // Exact-duplicate dedup (isDuplicateRow in extractionService.ts) can merge this document's row
  // into an already-existing identical row attributed to a different document — the data is still
  // represented, just not attributed here, so check by value before calling it fully gone.
  if (rows.some(matchesValue)) return 'applied';
  return 'not_applied';
}

/** Builds the broker-facing summary for one document's extraction result, cross-referenced against the CURRENT Risk Profile. */
export function summarizeDocumentExtraction(doc: UploadedDocument, profile: RiskProfile): DocumentFieldSummary[] {
  const fields = doc.extractedFields ?? [];
  const summaries: DocumentFieldSummary[] = [];

  for (const field of fields) {
    if (field.fieldPath === 'drivers') {
      const entry = field.value as DriverEntry;
      const disposition = rowDisposition(profile.drivers, doc.id, (r) => isEqualLoose((r as DriverEntry).name, entry.name) && isEqualLoose((r as DriverEntry).dob, entry.dob));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition });
      continue;
    }
    if (field.fieldPath === 'vehicles') {
      const entry = field.value as VehicleEntry;
      const disposition = rowDisposition(profile.vehicles, doc.id, (r) => !!entry.vin && isEqualLoose((r as VehicleEntry).vin, entry.vin));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition });
      continue;
    }
    if (field.fieldPath === 'lossHistory') {
      const entry = field.value as LossEntry;
      const disposition = rowDisposition(profile.lossHistory, doc.id, (r) => isEqualLoose((r as LossEntry).lossDate, entry.lossDate) && isEqualLoose((r as LossEntry).claimType, entry.claimType));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition });
      continue;
    }
    if (field.fieldPath === 'coverageLine') {
      const exists = profile.coverage.some((c) => c.type === field.value);
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition: exists ? 'applied' : 'not_applied' });
      continue;
    }
    const current = scalarFieldValue(profile, field.fieldPath);
    const { disposition, currentValue } = dispositionForFieldValue(current, field.value);
    summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition, currentValue });
  }

  return summaries;
}

export const FIELD_DISPOSITION_LABELS: Record<FieldDisposition, string> = {
  applied: 'Applied to Risk Profile',
  needs_review: 'Applied — Needs Review',
  conflict: 'Conflict with another source',
  superseded: 'Superseded by another value',
  not_applied: 'Not currently applied',
};
