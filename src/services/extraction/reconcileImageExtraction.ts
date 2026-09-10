import type { Confidence, DocumentCategory, ExtractedFieldResult, FieldConflict } from '../../types';
import type { VisionExtractionResult } from '../ingestion/visionExtraction';

/**
 * Combines a vision-model read and an on-device-OCR read of the SAME image into one final set of
 * ExtractedFieldResults. Scalar fields (business.*, transportation.*, coverage.*) need no special
 * merge code here — both sources' results are simply pushed into the same array, and the existing
 * mergeFieldValue()/setByPath() pipeline (extractionService.ts) already corroborates matching
 * values and files a real conflict (alternateValues) when they disagree, exactly per the "if vision
 * and OCR disagree, do not silently pick one" requirement.
 *
 * Itemized rows (drivers/vehicles) are different: they aren't wrapped in FieldValue<T>, so two
 * independent 'drivers' pushes for the same document would either silently dedupe (if identical) or
 * — worse — read as two DIFFERENT real drivers (if they disagree on even one field, since the
 * existing isDuplicateRow key is name+dob). mergeEntryFields below reconciles them into ONE row
 * before either source's driver/vehicle ever reaches setByPath, field by field: agreement between
 * two independent sources boosts confidence, disagreement keeps vision's value (the more
 * layout-aware read) as primary but records what OCR read instead in `conflicts`, and a field only
 * one source produced is kept as that source read it. Nothing from either source is ever silently
 * discarded.
 */

interface EntryWithMeta {
  fieldConfidence?: Partial<Record<string, Confidence>>;
  [key: string]: unknown;
}

function isEqualLoose(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * Field-by-field reconciliation of one itemized row (a driver or a vehicle) read by two independent
 * passes over the same image. `fieldNames` is the row's real data fields, excluding id/source/
 * isManual/lastUpdatedAt/fieldConfidence/conflicts bookkeeping.
 */
export function mergeEntryFields<T extends EntryWithMeta>(visionEntry: T | undefined, ocrEntry: T | undefined, fieldNames: string[]): (Record<string, unknown> & { fieldConfidence: Partial<Record<string, Confidence>>; conflicts?: Partial<Record<string, FieldConflict[]>> }) | null {
  if (!visionEntry && !ocrEntry) return null;

  const merged: Record<string, unknown> = {};
  const fieldConfidence: Partial<Record<string, Confidence>> = {};
  const conflicts: Partial<Record<string, FieldConflict[]>> = {};

  for (const field of fieldNames) {
    const v = visionEntry?.[field];
    const o = ocrEntry?.[field];
    const vSet = v !== undefined && v !== null && v !== '';
    const oSet = o !== undefined && o !== null && o !== '';

    if (vSet && oSet) {
      if (isEqualLoose(v, o)) {
        merged[field] = v;
        const vConf = visionEntry?.fieldConfidence?.[field] ?? 'medium';
        const oConf = ocrEntry?.fieldConfidence?.[field] ?? 'medium';
        // Two independent extraction passes agreeing is real corroboration — boosted, but never
        // above 'high', and never boosted at all if either read was already flagged shaky.
        fieldConfidence[field] = vConf !== 'low' && oConf !== 'low' ? 'high' : 'medium';
      } else {
        // Disagreement: vision (layout-aware) stays primary, but OCR's reading is preserved as a
        // visible alternate rather than silently dropped — same "never silently pick one" rule
        // FieldValue.alternateValues already follows for scalar fields.
        merged[field] = v;
        fieldConfidence[field] = 'low';
        conflicts[field] = [{ value: o, extractionMethod: 'image_ocr' }];
      }
    } else if (vSet) {
      merged[field] = v;
      fieldConfidence[field] = visionEntry?.fieldConfidence?.[field] ?? 'medium';
    } else if (oSet) {
      merged[field] = o;
      fieldConfidence[field] = ocrEntry?.fieldConfidence?.[field] ?? 'medium';
    }
  }

  if (Object.keys(merged).length === 0) return null;
  return { ...merged, fieldConfidence, conflicts: Object.keys(conflicts).length > 0 ? conflicts : undefined };
}

const DRIVER_FIELDS = ['name', 'dob', 'address', 'licenseState', 'licenseNumber', 'licenseClass', 'isCDL', 'issueDate', 'expirationDate', 'restrictions', 'endorsements'];
const VEHICLE_FIELDS = ['vin', 'make', 'model', 'year', 'plate', 'value', 'bodyType'];

export interface ReconcileImageExtractionInput {
  documentId: string;
  documentName: string;
  /** Results from the existing regex/OCR pipeline (extractInsuranceFields) — unchanged, still computed even when vision succeeds, specifically so there's something to reconcile against. */
  ocrResults: ExtractedFieldResult[];
  /** Null when vision wasn't available or the call/response failed — callers then use ocrResults exactly as before, so a vision outage never blocks extraction, it just loses the second opinion. */
  visionResult: VisionExtractionResult | null;
}

export interface ReconcileImageExtractionOutput {
  results: ExtractedFieldResult[];
  /** The vision model's own document-type read, when available — takes priority over the OCR-text keyword heuristic (inferCategoryFromText) since it's not limited to a fixed keyword list and isn't affected by filename. Null means the caller should fall back to that heuristic. */
  documentCategory: DocumentCategory | null;
}

function scalarSource(documentId: string, documentName: string, note: string) {
  return { documentId, documentName, excerpt: note };
}

export function reconcileImageExtraction({ documentId, documentName, ocrResults, visionResult }: ReconcileImageExtractionInput): ReconcileImageExtractionOutput {
  if (!visionResult) {
    return { results: ocrResults, documentCategory: null };
  }

  const results: ExtractedFieldResult[] = [];

  for (const field of visionResult.scalarFields) {
    results.push({
      fieldPath: field.fieldPath,
      value: field.value,
      confidence: field.confidence,
      source: scalarSource(documentId, documentName, 'Read via AI vision'),
      extractionMethod: 'vision_extraction',
    });
  }

  const ocrRowResults = ocrResults.filter((r) => r.fieldPath === 'drivers' || r.fieldPath === 'vehicles' || r.fieldPath === 'lossHistory');
  const ocrScalarResults = ocrResults.filter((r) => r.fieldPath !== 'drivers' && r.fieldPath !== 'vehicles' && r.fieldPath !== 'lossHistory');
  // OCR's own scalar results are pushed alongside vision's under the SAME fieldPath — the existing
  // mergeFieldValue()/setByPath() merge (extractionService.ts) corroborates or conflicts them
  // exactly like any two documents disagreeing on a field, no new code needed for that part.
  results.push(...ocrScalarResults);

  const ocrDriver = ocrRowResults.find((r) => r.fieldPath === 'drivers')?.value as Record<string, unknown> | undefined;
  const mergedDriver = mergeEntryFields(visionResult.driver as EntryWithMeta | undefined, ocrDriver as EntryWithMeta | undefined, DRIVER_FIELDS);
  if (mergedDriver) {
    const hasVision = !!visionResult.driver;
    results.push({
      fieldPath: 'drivers',
      value: mergedDriver,
      confidence: 'medium',
      source: scalarSource(documentId, documentName, hasVision && ocrDriver ? 'Read via AI vision, cross-checked against OCR' : hasVision ? 'Read via AI vision' : 'Read via OCR'),
      extractionMethod: hasVision ? 'vision_extraction' : 'image_ocr',
    });
  }

  const ocrVehicle = ocrRowResults.find((r) => r.fieldPath === 'vehicles')?.value as Record<string, unknown> | undefined;
  const mergedVehicle = mergeEntryFields(visionResult.vehicle as EntryWithMeta | undefined, ocrVehicle as EntryWithMeta | undefined, VEHICLE_FIELDS);
  if (mergedVehicle) {
    const hasVision = !!visionResult.vehicle;
    results.push({
      fieldPath: 'vehicles',
      value: mergedVehicle,
      confidence: 'medium',
      source: scalarSource(documentId, documentName, hasVision && ocrVehicle ? 'Read via AI vision, cross-checked against OCR' : hasVision ? 'Read via AI vision' : 'Read via OCR'),
      extractionMethod: hasVision ? 'vision_extraction' : 'image_ocr',
    });
  }

  // Loss rows: row-by-row field reconciliation (like drivers/vehicles above) would need a reliable
  // way to match "this vision row" to "this OCR row" first, which a loss list doesn't offer a clean
  // key for. Both sources' rows are pushed as-is instead and rely on the existing isDuplicateRow
  // dedup (lossDate+claimType+incurred) to collapse an exact match — the same de-duplication two
  // separate uploaded documents describing the same loss already get today. A near-match that isn't
  // an exact match is not merged — both rows are kept, visible for the broker to reconcile manually.
  for (const loss of visionResult.lossEntries ?? []) {
    results.push({
      fieldPath: 'lossHistory',
      value: { lossDate: loss.lossDate, claimType: loss.claimType, paid: loss.paid, reserved: loss.reserved, incurred: loss.incurred, status: loss.status },
      confidence: loss.confidence,
      source: scalarSource(documentId, documentName, 'Read via AI vision'),
      extractionMethod: 'vision_extraction',
    });
  }
  const ocrLossResults = ocrRowResults.filter((r) => r.fieldPath === 'lossHistory');
  results.push(...ocrLossResults);

  return { results, documentCategory: visionResult.documentType };
}
