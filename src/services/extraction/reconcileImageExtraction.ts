import type { Confidence, DocumentCategory, ExtractedFieldResult, FieldConflict } from '../../types';
import type { VisionDriver, VisionExtractionResult, VisionLossEntry, VisionLossRun, VisionVehicle } from '../ingestion/visionExtraction';
import type { LossRunDraft } from './fieldExtraction/lossRunPatterns';
import { cleanCarrierName } from '../../utils/carrierName';

/**
 * Turns the AI (vision model) reading of a photo or of a scanned PDF's pages into the final
 * ExtractedFieldResults for that document.
 *
 * When the AI read the document, its reading is the ONLY one used: on-device OCR of the same image
 * is weaker on exactly these documents (phone photos, faxed scans), and mixing the two only produced
 * conflicts between a correct AI value and an OCR misread. OCR is used only when the AI reading
 * isn't available at all (not signed in, function unreachable, provider error) — and then every
 * value it read is held for the broker to check, never applied on its own.
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
 * Field-by-field reconciliation of one itemized row (a driver or a vehicle) read twice. Agreement
 * boosts confidence; disagreement keeps the first reading as primary, records the other in
 * `conflicts` and marks the field low-confidence. A field only one reading has is kept as read.
 */
export function mergeEntryFields<T extends EntryWithMeta>(primary: T | undefined, secondary: T | undefined, fieldNames: string[], secondaryMethod: FieldConflict['extractionMethod'] = 'vision_extraction'): (Record<string, unknown> & { fieldConfidence: Partial<Record<string, Confidence>>; conflicts?: Partial<Record<string, FieldConflict[]>> }) | null {
  if (!primary && !secondary) return null;

  const merged: Record<string, unknown> = {};
  const fieldConfidence: Partial<Record<string, Confidence>> = {};
  const conflicts: Partial<Record<string, FieldConflict[]>> = {};

  for (const field of fieldNames) {
    const v = primary?.[field];
    const o = secondary?.[field];
    const vSet = v !== undefined && v !== null && v !== '';
    const oSet = o !== undefined && o !== null && o !== '';

    if (vSet && oSet) {
      if (isEqualLoose(v, o)) {
        merged[field] = v;
        const vConf = primary?.fieldConfidence?.[field] ?? 'medium';
        const oConf = secondary?.fieldConfidence?.[field] ?? 'medium';
        fieldConfidence[field] = vConf !== 'low' && oConf !== 'low' ? 'high' : 'medium';
      } else {
        merged[field] = v;
        fieldConfidence[field] = 'low';
        conflicts[field] = [{ value: o, extractionMethod: secondaryMethod }];
      }
    } else if (vSet) {
      merged[field] = v;
      fieldConfidence[field] = primary?.fieldConfidence?.[field] ?? 'medium';
    } else if (oSet) {
      merged[field] = o;
      fieldConfidence[field] = secondary?.fieldConfidence?.[field] ?? 'medium';
    }
  }

  if (Object.keys(merged).length === 0) return null;
  return { ...merged, fieldConfidence, conflicts: Object.keys(conflicts).length > 0 ? conflicts : undefined };
}

const DRIVER_FIELDS = ['name', 'dob', 'address', 'licenseState', 'licenseNumber', 'licenseClass', 'isCDL', 'issueDate', 'expirationDate', 'cdlOriginalIssueDate', 'hireDate', 'restrictions', 'endorsements', 'violations'];
const VEHICLE_FIELDS = ['vin', 'make', 'model', 'year', 'plate', 'value', 'bodyType'];

export interface ReconcileImageExtractionInput {
  documentId: string;
  documentName: string;
  /** The OCR/text-rule reading — used only when there is no AI reading. */
  ocrResults: ExtractedFieldResult[];
  /** The AI reading; null when it wasn't available or failed. */
  visionResult: VisionExtractionResult | null;
}

export interface ReconcileImageExtractionOutput {
  results: ExtractedFieldResult[];
  /** The AI's own read of what the document is; null when there is no AI reading. */
  documentCategory: DocumentCategory | null;
  /** The AI's free-text notes for readable content with no field to land in. */
  candidateNotes?: string;
}

/** Why OCR-only values are held: the AI reading wasn't there to read the document. */
export const OCR_FALLBACK_HOLD_REASON = 'Read by on-device text recognition because the AI reading wasn’t available — check it against the file.';

/**
 * A driver's license or vehicle registration never legitimately carries applicant-business fields
 * (named insured, business address, DOT #, coverage, ...) — see extractInsuranceFields.ts's
 * `isIdCardDocument` for the same rule on the text path.
 */
const ID_CARD_DOCUMENT_TYPES = new Set<DocumentCategory>(['driver_license', 'vehicle_registration']);

function isBusinessOrTransportationField(fieldPath: string): boolean {
  return fieldPath.startsWith('business.') || fieldPath.startsWith('transportation.') || fieldPath.startsWith('coverage.') || fieldPath === 'coverageLine';
}

const norm = (s: unknown) => (typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

function source(documentId: string, documentName: string, page: number | undefined, excerpt: string) {
  return { documentId, documentName, ...(page !== undefined ? { page } : {}), excerpt };
}

function stripPage<T extends { page?: number }>(row: T): Omit<T, 'page'> {
  const { page: _page, ...rest } = row;
  return rest;
}

/** Every field the AI reading produced, as ExtractedFieldResults (nothing from OCR). */
export function visionToResults(documentId: string, documentName: string, vision: VisionExtractionResult): ExtractedFieldResult[] {
  const results: ExtractedFieldResult[] = [];
  const isIdCardDocument = ID_CARD_DOCUMENT_TYPES.has(vision.documentType);
  const method = 'vision_extraction' as const;

  // Classification first: once the AI has read this as a license/registration, no business,
  // transportation or coverage value from it is used (a prompt is not an enforcement mechanism).
  for (const field of vision.scalarFields) {
    if (isIdCardDocument && isBusinessOrTransportationField(field.fieldPath)) continue;
    results.push({ fieldPath: field.fieldPath, value: field.value, confidence: field.confidence, source: source(documentId, documentName, undefined, 'Read via AI'), extractionMethod: method });
  }

  const pushDriver = (d: VisionDriver, fromList: boolean) =>
    results.push({
      fieldPath: 'drivers',
      value: { ...stripPage(d), fieldConfidence: d.fieldConfidence ?? {} },
      confidence: 'medium',
      source: source(documentId, documentName, d.page, fromList ? 'Read via AI from a driver list' : 'Read via AI'),
      extractionMethod: method,
      ...(fromList ? { rowOrigin: 'table' as const } : {}),
    });
  const pushVehicle = (v: VisionVehicle, fromList: boolean) =>
    results.push({
      fieldPath: 'vehicles',
      value: { ...stripPage(v), fieldConfidence: v.fieldConfidence ?? {} },
      confidence: 'medium',
      source: source(documentId, documentName, v.page, fromList ? 'Read via AI from a vehicle list' : 'Read via AI'),
      extractionMethod: method,
      ...(fromList ? { rowOrigin: 'table' as const } : {}),
    });
  if (vision.driver) pushDriver(vision.driver, false);
  for (const d of dedupeDrivers(vision.drivers ?? [], vision.driver)) pushDriver(d, true);
  if (vision.vehicle) pushVehicle(vision.vehicle, false);
  for (const v of dedupeVehicles(vision.vehicles ?? [], vision.vehicle)) pushVehicle(v, true);

  results.push(...lossRunResults(documentId, documentName, vision));
  return results;
}

const driverKey = (d: VisionDriver) => (d.licenseNumber ? `L:${norm(d.licenseNumber)}` : `N:${norm(d.name)}|${d.dob ?? ''}`);
const vehicleKey = (v: VisionVehicle) => (v.vin ? `V:${v.vin}` : `Y:${v.year ?? ''}|${norm(v.make)}|${norm(v.model)}|${norm(v.plate)}`);

/** Rows repeated on several pages (or the one-driver read repeated in the list) count once; the fuller reading wins each field. */
function dedupeRows<T extends EntryWithMeta & { page?: number }>(rows: T[], key: (r: T) => string, fields: string[], exclude?: T): T[] {
  const byKey = new Map<string, T>();
  const excludeKey = exclude ? key(exclude) : null;
  for (const r of rows) {
    const k = key(r);
    if (k === excludeKey) continue;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, r);
    else {
      const merged = mergeEntryFields(prev, r, fields);
      if (merged) byKey.set(k, { ...(merged as unknown as T), page: prev.page });
    }
  }
  return [...byKey.values()];
}
const dedupeDrivers = (rows: VisionDriver[], single?: VisionDriver) => dedupeRows(rows as (VisionDriver & EntryWithMeta)[], driverKey, DRIVER_FIELDS, single as VisionDriver & EntryWithMeta);
const dedupeVehicles = (rows: VisionVehicle[], single?: VisionVehicle) => dedupeRows(rows as (VisionVehicle & EntryWithMeta)[], vehicleKey, VEHICLE_FIELDS, single as VisionVehicle & EntryWithMeta);

/**
 * Loss-run records (one per policy the report states) and their claims, linked by lossRunKey —
 * the same shape the text reader produces (lossRunPatterns.ts), so settleLossRuns treats both alike.
 */
function lossRunResults(documentId: string, documentName: string, vision: VisionExtractionResult): ExtractedFieldResult[] {
  const results: ExtractedFieldResult[] = [];
  const entries = vision.lossEntries ?? [];
  const runs: (VisionLossRun & { key: string })[] = [];
  // The same policy's header repeated on every page is one record.
  for (const run of vision.lossRuns ?? []) {
    const same = runs.find((r) => (run.policyNumber ? norm(r.policyNumber) === norm(run.policyNumber) && (!r.coverageStart || !run.coverageStart || r.coverageStart === run.coverageStart) : !r.policyNumber));
    if (same) {
      for (const [k, v] of Object.entries(run)) if (v !== undefined && (same as unknown as Record<string, unknown>)[k] === undefined) (same as unknown as Record<string, unknown>)[k] = v;
    } else runs.push({ ...run, key: `${documentId}:ai${runs.length}` });
  }
  // A loss run with claims but no readable header still gets its record (the carrier is filled in later).
  if (runs.length === 0 && entries.length > 0 && vision.documentType === 'loss_run') runs.push({ key: `${documentId}:ai0`, page: entries[0].page });

  const keyFor = (e: VisionLossEntry): string | undefined => {
    if (runs.length === 0) return undefined;
    if (e.policyNumber) {
      const match = runs.find((r) => r.policyNumber && norm(r.policyNumber) === norm(e.policyNumber));
      if (match) return match.key;
    }
    if (runs.length === 1) return runs[0].key;
    // Several policies: the record stated on the claim's own page (the last one stated at or before it).
    const before = runs.filter((r) => r.page !== undefined && e.page !== undefined && r.page <= e.page);
    return before.length === 1 ? before[0].key : undefined;
  };
  const claimKeys = entries.map(keyFor);

  for (const run of runs) {
    const linked = claimKeys.filter((k) => k === run.key).length;
    const draft: LossRunDraft = {
      key: run.key,
      carrier: cleanCarrierName(run.carrier) || 'Carrier not listed',
      ...(run.policyNumber ? { policyNumber: run.policyNumber } : {}),
      ...(run.reportDate ? { reportDate: run.reportDate } : {}),
      ...(run.coverageStart ? { coverageStart: run.coverageStart } : {}),
      ...(run.coverageEnd ? { coverageEnd: run.coverageEnd } : {}),
      ...(run.claimCount !== undefined ? { claimCount: run.claimCount } : {}),
      ...(run.totalPaid !== undefined ? { totalPaid: run.totalPaid } : {}),
      ...(run.totalReserve !== undefined ? { totalReserve: run.totalReserve } : {}),
      ...(run.totalIncurred !== undefined ? { totalIncurred: run.totalIncurred } : {}),
      documentId,
    };
    // "No losses" only when the report says so and no claim was read under it.
    if (run.noLosses && linked === 0) {
      draft.claimCount ??= 0;
      draft.totalPaid ??= 0;
      draft.totalReserve ??= 0;
      draft.totalIncurred ??= 0;
    }
    results.push({
      fieldPath: 'lossRun',
      value: draft,
      confidence: 'medium',
      source: source(documentId, documentName, run.page, ['Loss run (read via AI)', draft.carrier !== 'Carrier not listed' && draft.carrier, draft.policyNumber && `policy ${draft.policyNumber}`].filter(Boolean).join(' — ')),
      extractionMethod: 'vision_extraction',
    });
  }

  entries.forEach((loss, i) => {
    results.push({
      fieldPath: 'lossHistory',
      value: {
        lossDate: loss.lossDate,
        claimType: loss.claimType,
        paid: loss.paid,
        reserved: loss.reserved,
        incurred: loss.incurred,
        status: loss.status,
        ...(loss.claimNumber ? { claimNumber: loss.claimNumber } : {}),
        ...(loss.description ? { description: loss.description } : {}),
        ...(claimKeys[i] ? { lossRunKey: claimKeys[i] } : {}),
      },
      confidence: loss.confidence,
      source: source(documentId, documentName, loss.page, 'Read via AI'),
      extractionMethod: 'vision_extraction',
    });
  });
  return results;
}

/**
 * OCR's reading, for when there is no AI reading: low confidence and held for the broker. A loss
 * run's record header still applies (it carries no amounts); its claims are held, unlinked.
 */
export function holdOcrResults(results: ExtractedFieldResult[]): ExtractedFieldResult[] {
  return results.map((r) => {
    if (r.fieldPath === 'lossRun') return r;
    let value = r.value;
    if (r.fieldPath === 'lossHistory' && value && typeof value === 'object') {
      const { lossRunKey: _key, ...rest } = value as Record<string, unknown>;
      value = rest;
    }
    return { ...r, value, confidence: 'low' as const, holdReason: OCR_FALLBACK_HOLD_REASON };
  });
}

/**
 * Combines the AI reading of each scanned page into one reading of the document: every page's
 * fields, drivers, vehicles, claims and loss-run headers (tagged with their page), and the document
 * type most pages agree on.
 */
export function mergeVisionPages(pages: { page: number; result: VisionExtractionResult }[]): VisionExtractionResult | null {
  if (pages.length === 0) return null;
  if (pages.length === 1 && pages[0].page === 1) return pages[0].result;
  const tag = <T extends object>(rows: T[] | undefined, page: number) => (rows ?? []).map((r) => ({ ...r, page }));
  const counts = new Map<DocumentCategory, number>();
  for (const { result } of pages) if (result.documentType !== 'other') counts.set(result.documentType, (counts.get(result.documentType) ?? 0) + 1);
  const documentType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
  const typed = pages.filter((p) => p.result.documentType === documentType);
  const drivers = pages.flatMap(({ page, result }) => [...tag(result.drivers, page), ...(result.driver ? tag([result.driver], page) : [])]);
  const vehicles = pages.flatMap(({ page, result }) => [...tag(result.vehicles, page), ...(result.vehicle ? tag([result.vehicle], page) : [])]);
  // One person/vehicle across the whole document (a two-page MVR) stays the one-subject read.
  const oneDriver = drivers.length > 0 && new Set(drivers.map(driverKey)).size === 1 && pages.every((p) => !p.result.drivers?.length);
  const oneVehicle = vehicles.length > 0 && new Set(vehicles.map(vehicleKey)).size === 1 && pages.every((p) => !p.result.vehicles?.length);
  const notes = pages.map((p) => p.result.candidateNotes).filter(Boolean);
  return {
    documentType,
    documentTypeConfidence: typed.some((p) => p.result.documentTypeConfidence === 'high') ? 'high' : typed.length ? 'medium' : 'low',
    scalarFields: pages.flatMap((p) => p.result.scalarFields),
    ...(oneDriver ? { driver: dedupeDrivers(drivers)[0] } : drivers.length ? { drivers } : {}),
    ...(oneVehicle ? { vehicle: dedupeVehicles(vehicles)[0] } : vehicles.length ? { vehicles } : {}),
    lossEntries: pages.flatMap(({ page, result }) => tag(result.lossEntries, page)),
    lossRuns: pages.flatMap(({ page, result }) => tag(result.lossRuns, page)),
    ...(notes.length ? { candidateNotes: notes.join('\n').slice(0, 1500) } : {}),
  };
}

export function reconcileImageExtraction({ documentId, documentName, ocrResults, visionResult }: ReconcileImageExtractionInput): ReconcileImageExtractionOutput {
  if (!visionResult) return { results: holdOcrResults(ocrResults), documentCategory: null };
  return { results: visionToResults(documentId, documentName, visionResult), documentCategory: visionResult.documentType, candidateNotes: visionResult.candidateNotes };
}
