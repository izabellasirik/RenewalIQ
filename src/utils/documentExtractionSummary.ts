import type { CoverageType, DocumentExtractedField, DriverEntry, FieldValue, LossEntry, RiskProfile, UploadedDocument, VehicleEntry } from '../types';

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
  /** For an itemized row (drivers/vehicles/lossHistory) only: the canonical profile row's real id, populated only when one could actually be matched (see rowDisposition) — this is what an Edit action needs to call updateDriver/updateVehicle/updateLoss against. Undefined for scalar fields and for a row this document contributed that no longer matches anything in the live profile (nothing safe to edit). */
  rowId?: string;
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

/** The current canonical FieldValue a scalar fieldPath (business.___, transportation.___, or coverage.___) resolves to in the live profile — exported so the "Extracted Data" panel can both edit it and check whether it's since become broker-edited/confirmed (see fieldDataStatus). */
export function scalarFieldValue(profile: RiskProfile, fieldPath: string): FieldValue<unknown> | undefined {
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

function rowDisposition(
  rows: { id: string; source?: { documentId: string } }[],
  documentId: string,
  matchesValue: (row: unknown) => boolean
): { disposition: FieldDisposition; rowId?: string } {
  const bySource = rows.find((r) => r.source?.documentId === documentId);
  if (bySource) return { disposition: 'applied', rowId: bySource.id };
  // Exact-duplicate dedup (isDuplicateRow in extractionService.ts) can merge this document's row
  // into an already-existing identical row attributed to a different document — the data is still
  // represented, just not attributed here, so check by value before calling it fully gone. rowId is
  // still populated in this case: it's a real, currently-live row, just not one this document itself
  // is the recorded source of — still safe (and useful) to edit from here.
  const byValue = rows.find(matchesValue);
  if (byValue) return { disposition: 'applied', rowId: byValue.id };
  return { disposition: 'not_applied' };
}

function stripRowMeta(row: object): Record<string, unknown> {
  const { id: _id, source: _source, isManual: _isManual, lastUpdatedAt: _lastUpdatedAt, ...rest } = row as Record<string, unknown>;
  return rest;
}

/**
 * Rebuilds a document's contribution from the CURRENT profile alone, for a document processed
 * before `extractedFields` existed on UploadedDocument (added when "View extracted data" shipped) —
 * those records persisted `fieldsExtracted` (a count) but have no `extractedFields` array to show,
 * which is the actual root cause of a document badge reading "N fields extracted" while the detail
 * panel said "No fields were extracted": two independently-persisted values that went out of sync
 * the moment the array was introduced with no migration for data written by earlier code. Rather
 * than just explaining the gap, this recovers what's still knowable: every scalar field (primary or
 * demoted to an alternate) and every driver/vehicle/loss row still attributed to this document's id
 * anywhere in the live profile. A field this document contributed that was later fully overwritten
 * with no trace (see reconcileImageExtraction.ts's notes on itemized-row merging) can't be recovered
 * this way — that data genuinely isn't retained anywhere — but everything still attributable is.
 */
function reconstructFieldsFromProfile(doc: UploadedDocument, profile: RiskProfile): DocumentExtractedField[] {
  const reconstructed: DocumentExtractedField[] = [];

  function considerFieldValue(fieldPath: string, field: FieldValue<unknown> | undefined) {
    if (!field) return;
    if (!field.isMissing && field.source?.documentId === doc.id) {
      reconstructed.push({ fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod });
    }
    for (const alt of field.alternateValues ?? []) {
      if (alt.source.documentId === doc.id) {
        reconstructed.push({ fieldPath, value: alt.value, confidence: 'medium', extractionMethod: alt.extractionMethod });
      }
    }
  }

  for (const [key, field] of Object.entries(profile.business)) considerFieldValue(`business.${key}`, field as FieldValue<unknown>);
  for (const [key, field] of Object.entries(profile.transportation)) considerFieldValue(`transportation.${key}`, field as FieldValue<unknown>);
  for (const line of profile.coverage) {
    considerFieldValue(`coverage.${line.type}.requestedLimit`, line.requestedLimit);
    considerFieldValue(`coverage.${line.type}.currentLimit`, line.currentLimit);
  }

  for (const driver of profile.drivers) {
    if (driver.source?.documentId === doc.id) {
      reconstructed.push({ fieldPath: 'drivers', value: stripRowMeta(driver), confidence: 'medium' });
    }
  }
  for (const vehicle of profile.vehicles) {
    if (vehicle.source?.documentId === doc.id) {
      reconstructed.push({ fieldPath: 'vehicles', value: stripRowMeta(vehicle), confidence: 'medium' });
    }
  }
  for (const loss of profile.lossHistory) {
    if (loss.source?.documentId === doc.id) {
      reconstructed.push({ fieldPath: 'lossHistory', value: stripRowMeta(loss), confidence: 'medium' });
    }
  }

  return reconstructed;
}

/** Builds the broker-facing summary for one document's extraction result, cross-referenced against the CURRENT Risk Profile. */
export function summarizeDocumentExtraction(doc: UploadedDocument, profile: RiskProfile): DocumentFieldSummary[] {
  const fields = doc.extractedFields ?? reconstructFieldsFromProfile(doc, profile);
  const summaries: DocumentFieldSummary[] = [];

  for (const field of fields) {
    if (field.fieldPath === 'drivers') {
      const entry = field.value as DriverEntry;
      const { disposition, rowId } = rowDisposition(profile.drivers, doc.id, (r) => isEqualLoose((r as DriverEntry).name, entry.name) && isEqualLoose((r as DriverEntry).dob, entry.dob));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition, rowId });
      continue;
    }
    if (field.fieldPath === 'vehicles') {
      const entry = field.value as VehicleEntry;
      const { disposition, rowId } = rowDisposition(profile.vehicles, doc.id, (r) => !!entry.vin && isEqualLoose((r as VehicleEntry).vin, entry.vin));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition, rowId });
      continue;
    }
    if (field.fieldPath === 'lossHistory') {
      const entry = field.value as LossEntry;
      const { disposition, rowId } = rowDisposition(profile.lossHistory, doc.id, (r) => isEqualLoose((r as LossEntry).lossDate, entry.lossDate) && isEqualLoose((r as LossEntry).claimType, entry.claimType));
      summaries.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, extractionMethod: field.extractionMethod, disposition, rowId });
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
