import type { Confidence, DocumentCategory, DriverEntry, LossStatus, VehicleEntry } from '../../types';
import { decodeOriented, drawToCanvas } from './imageUtils';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { isValidVin } from '../extraction/fieldExtraction/tableMappers';
import { normalizeClassToken, normalizeDate, normalizeIdToken, normalizePlainName } from '../extraction/fieldExtraction/idDocumentPatterns';
import { parseStateName } from '../../utils/usStates';
import { parseMoney, parseCount } from '../extraction/fieldExtraction/money';

/**
 * Sends the image itself to a vision-capable model (via a Supabase Edge Function that holds the
 * provider API key server-side — see supabase/functions/extract-document-vision) for layout-aware
 * structured extraction, instead of running OCR text through regex. This is the PRIMARY way an
 * image's content is understood; on-device OCR (parseImage.ts) remains as a fallback for when
 * vision isn't available and as a second independent read to reconcile against (see
 * reconcileImageExtraction.ts).
 *
 * Vision is only attempted when Supabase is configured AND the broker is signed in — the Edge
 * Function requires a valid session (Supabase verifies the JWT before the function body even runs)
 * both so a stranger can't run up the account's model-usage bill, and because there's nowhere else
 * a secret key could safely live (see client.ts's isSupabaseConfigured doc comment). Local-only
 * mode (no Supabase configured, or not signed in) always falls back to OCR, same as today.
 *
 * Every value returned by the model is still validated with the exact same format rules OCR-matched
 * values go through (normalizeDate, normalizeIdToken, isValidVin, ...) before being trusted — a
 * capable model is still not a reason to skip the "never hallucinate, never invent an unsupported
 * value" rule the rest of this pipeline follows. A response that fails validation for a field
 * simply omits that field; a response that fails to parse at all returns null, so the caller falls
 * straight back to OCR.
 */

/** Long edge fed to the vision model — comfortably above Anthropic's ~1568px sweet spot for detailed text, so the resize doesn't itself become the reason a field is unreadable. */
const VISION_MAX_DIMENSION = 1568;
const VISION_JPEG_QUALITY = 0.85;

const DOCUMENT_TYPES: DocumentCategory[] = [
  'application',
  'loss_run',
  'vehicle_schedule',
  'driver_schedule',
  'financials',
  'driver_license',
  'vehicle_registration',
  'insurance_id_card',
  'insurance_declarations',
  'other',
];

const CONFIDENCE_VALUES: Confidence[] = ['high', 'medium', 'low'];

function asConfidence(v: unknown): Confidence {
  return typeof v === 'string' && (CONFIDENCE_VALUES as string[]).includes(v) ? (v as Confidence) : 'medium';
}

export interface VisionScalarField {
  fieldPath: string;
  value: string | number | boolean | string[];
  confidence: Confidence;
}

export interface VisionLossEntry {
  lossDate: string;
  claimType: string;
  paid: number;
  reserved: number;
  incurred: number;
  status: LossStatus;
  confidence: Confidence;
}

export interface VisionExtractionResult {
  documentType: DocumentCategory;
  documentTypeConfidence: Confidence;
  scalarFields: VisionScalarField[];
  driver?: Omit<DriverEntry, 'id' | 'source' | 'isManual' | 'lastUpdatedAt' | 'conflicts'>;
  vehicle?: Omit<VehicleEntry, 'id' | 'source' | 'isManual' | 'lastUpdatedAt' | 'conflicts'>;
  lossEntries?: VisionLossEntry[];
  /** Anything readable that doesn't map to a known field — never silently discarded, surfaced to the broker as a note rather than forced into the wrong place. */
  candidateNotes?: string;
}

/** Only these scalar RiskProfile paths are ever accepted from a vision response — mirrors the "don't invent unsupported values" rule that already governs the regex patterns; an unrecognized path is dropped, never passed through. */
const SCALAR_FIELD_VALIDATORS: Record<string, (raw: unknown) => string | number | boolean | string[] | null> = {
  'business.namedInsured': asTrimmedString,
  'business.legalEntity': asTrimmedString,
  'business.address': asTrimmedString,
  'business.city': asTrimmedString,
  'business.state': asStateCode,
  'business.zip': (raw) => (typeof raw === 'string' && /^\d{5}(-\d{4})?$/.test(raw.trim()) ? raw.trim() : null),
  'business.yearsInBusiness': asNonNegativeCount,
  'business.annualRevenue': asMoney,
  'business.descriptionOfOperations': asTrimmedString,
  'transportation.dotNumber': (raw) => asDigitsOfLength(raw, 5, 8),
  'transportation.mcNumber': (raw) => asDigitsOfLength(raw, 4, 8),
  'transportation.fleetSize': asNonNegativeCount,
  'transportation.vehicleTypes': asStringArray,
  'transportation.statesOfOperation': asStateCodeArray,
  'transportation.operatingRadius': asTrimmedString,
  'transportation.commoditiesHauled': asStringArray,
  'transportation.driverCount': asNonNegativeCount,
  'transportation.minDriverAge': asNonNegativeCount,
  'transportation.minDriverExperienceYears': asNonNegativeCount,
  'transportation.telematics': asBoolean,
  'transportation.dashcams': asBoolean,
  'coverageLine': asCoverageType,
  'coverage.auto_liability.requestedLimit': asCoverageLimit,
  'coverage.auto_liability.currentLimit': asCoverageLimit,
  'coverage.motor_truck_cargo.requestedLimit': asCoverageLimit,
  'coverage.motor_truck_cargo.currentLimit': asCoverageLimit,
  'coverage.physical_damage.requestedLimit': asCoverageLimit,
  'coverage.physical_damage.currentLimit': asCoverageLimit,
  'coverage.general_liability.requestedLimit': asCoverageLimit,
  'coverage.general_liability.currentLimit': asCoverageLimit,
  'coverage.warehouse_legal_liability.requestedLimit': asCoverageLimit,
  'coverage.warehouse_legal_liability.currentLimit': asCoverageLimit,
};

/**
 * At least 2 consecutive letters/digits — rejects a non-empty but content-free string (stray
 * punctuation, a symbol the model misread off a barcode/MRZ line, an em-dash). A real incident:
 * "=»" passed the previous "just non-empty" check and was accepted into business.namedInsured, so
 * this validator existed but wasn't actually validating CONTENT, only that a string was present.
 * Deliberately loose (no length/format assumptions beyond this) — it's a hallucination floor, not a
 * business-name format checker.
 */
const HAS_REAL_CONTENT = /[A-Za-z0-9]{2,}/;

function asTrimmedString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length > 0 && t.length <= 200 && HAS_REAL_CONTENT.test(t) ? t : null;
}

function asStateCode(raw: unknown): string | null {
  return typeof raw === 'string' ? parseStateName(raw) : null;
}

function asStateCodeArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const codes = raw.map((r) => (typeof r === 'string' ? parseStateName(r) : null)).filter((c): c is string => !!c);
  return codes.length > 0 ? Array.from(new Set(codes)) : null;
}

function asStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim());
  return items.length > 0 ? items : null;
}

function asNonNegativeCount(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseCount(raw) : null;
  return n !== null && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function asMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  return typeof raw === 'string' ? parseMoney(raw) : null;
}

function asDigitsOfLength(raw: unknown, min: number, max: number): string | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (!s) return null;
  return new RegExp(`^\\d{${min},${max}}$`).test(s) ? s : null;
}

function asBoolean(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

const COVERAGE_TYPES = new Set(['auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability', 'warehouse_legal_liability']);
function asCoverageType(raw: unknown): string | null {
  return typeof raw === 'string' && COVERAGE_TYPES.has(raw) ? raw : null;
}
function asCoverageLimit(raw: unknown): string | null {
  const n = asMoney(raw);
  if (n !== null) return `$${n.toLocaleString('en-US')}`;
  return typeof raw === 'string' && raw.trim().length > 0 && raw.trim().length <= 40 ? raw.trim() : null;
}

function validateScalarFields(raw: unknown): VisionScalarField[] {
  if (!Array.isArray(raw)) return [];
  const results: VisionScalarField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fieldPath = (item as Record<string, unknown>).fieldPath;
    const validator = typeof fieldPath === 'string' ? SCALAR_FIELD_VALIDATORS[fieldPath] : undefined;
    if (!validator) continue;
    const value = validator((item as Record<string, unknown>).value);
    if (value === null || value === undefined) continue;
    results.push({ fieldPath: fieldPath as string, value, confidence: asConfidence((item as Record<string, unknown>).confidence) });
  }
  return results;
}

function validateDriver(raw: unknown): VisionExtractionResult['driver'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const entry: NonNullable<VisionExtractionResult['driver']> = {};
  const fieldConfidence: Partial<Record<string, Confidence>> = {};
  const confMap = (r.fieldConfidence && typeof r.fieldConfidence === 'object' ? (r.fieldConfidence as Record<string, unknown>) : {});

  const name = typeof r.name === 'string' ? normalizePlainName(r.name) : null;
  if (name) { entry.name = name; fieldConfidence.name = asConfidence(confMap.name); }
  const dob = typeof r.dob === 'string' ? normalizeDate(r.dob) : null;
  if (dob) { entry.dob = dob; fieldConfidence.dob = asConfidence(confMap.dob); }
  const address = asTrimmedString(r.address);
  if (address && /\d/.test(address)) { entry.address = address; fieldConfidence.address = asConfidence(confMap.address); }
  const licenseState = typeof r.licenseState === 'string' ? parseStateName(r.licenseState) : null;
  if (licenseState) { entry.licenseState = licenseState; fieldConfidence.licenseState = asConfidence(confMap.licenseState); }
  const licenseNumber = typeof r.licenseNumber === 'string' ? normalizeIdToken(r.licenseNumber) : null;
  if (licenseNumber) { entry.licenseNumber = licenseNumber; fieldConfidence.licenseNumber = asConfidence(confMap.licenseNumber); }
  const licenseClass = typeof r.licenseClass === 'string' ? normalizeClassToken(r.licenseClass) : null;
  if (licenseClass) { entry.licenseClass = licenseClass; fieldConfidence.licenseClass = asConfidence(confMap.licenseClass); }
  if (typeof r.isCDL === 'boolean') entry.isCDL = r.isCDL;
  const issueDate = typeof r.issueDate === 'string' ? normalizeDate(r.issueDate) : null;
  if (issueDate) { entry.issueDate = issueDate; fieldConfidence.issueDate = asConfidence(confMap.issueDate); }
  const expirationDate = typeof r.expirationDate === 'string' ? normalizeDate(r.expirationDate) : null;
  if (expirationDate) { entry.expirationDate = expirationDate; fieldConfidence.expirationDate = asConfidence(confMap.expirationDate); }
  const restrictions = asTrimmedString(r.restrictions);
  if (restrictions && restrictions.length <= 40) { entry.restrictions = restrictions.toUpperCase(); fieldConfidence.restrictions = asConfidence(confMap.restrictions); }
  const endorsements = asTrimmedString(r.endorsements);
  if (endorsements && endorsements.length <= 40) { entry.endorsements = endorsements.toUpperCase(); fieldConfidence.endorsements = asConfidence(confMap.endorsements); }

  if (Object.keys(entry).length === 0) return undefined;
  entry.fieldConfidence = fieldConfidence;
  return entry;
}

function validateVehicle(raw: unknown): VisionExtractionResult['vehicle'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const entry: NonNullable<VisionExtractionResult['vehicle']> = {};
  const fieldConfidence: Partial<Record<string, Confidence>> = {};
  const confMap = (r.fieldConfidence && typeof r.fieldConfidence === 'object' ? (r.fieldConfidence as Record<string, unknown>) : {});

  const vin = typeof r.vin === 'string' ? r.vin.trim().toUpperCase() : null;
  if (vin && isValidVin(vin)) { entry.vin = vin; fieldConfidence.vin = asConfidence(confMap.vin); }
  const year = asNonNegativeCount(r.year);
  if (year !== null && year >= 1980 && year <= new Date().getFullYear() + 1) { entry.year = year; fieldConfidence.year = asConfidence(confMap.year); }
  const make = asTrimmedString(r.make);
  if (make && make.length <= 40) { entry.make = make.toUpperCase(); fieldConfidence.make = asConfidence(confMap.make); }
  const model = asTrimmedString(r.model);
  if (model && model.length <= 40) { entry.model = model.toUpperCase(); fieldConfidence.model = asConfidence(confMap.model); }
  const plate = asTrimmedString(r.plate);
  if (plate && /^[A-Za-z0-9-]{2,10}$/.test(plate)) { entry.plate = plate.toUpperCase(); fieldConfidence.plate = asConfidence(confMap.plate); }
  const value = asMoney(r.value);
  if (value !== null) { entry.value = value; fieldConfidence.value = asConfidence(confMap.value); }

  if (Object.keys(entry).length === 0) return undefined;
  entry.fieldConfidence = fieldConfidence;
  return entry;
}

function validateLossEntries(raw: unknown): VisionLossEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const results: VisionLossEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const lossDate = typeof r.lossDate === 'string' ? normalizeDate(r.lossDate) : null;
    const paid = asMoney(r.paid);
    const incurred = asMoney(r.incurred);
    if (!lossDate || paid === null || incurred === null) continue;
    results.push({
      lossDate,
      claimType: asTrimmedString(r.claimType) ?? 'Unspecified',
      paid,
      reserved: asMoney(r.reserved) ?? 0,
      incurred,
      status: r.status === 'open' ? 'open' : 'closed',
      confidence: asConfidence(r.confidence),
    });
  }
  return results.length > 0 ? results : undefined;
}

/** Validates a raw Edge Function response into a trustworthy VisionExtractionResult, or null if the shape is unusable — every leaf value goes through the same format rules an OCR-matched value would. */
function validateVisionResponse(raw: unknown): VisionExtractionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const documentType = typeof r.documentType === 'string' && (DOCUMENT_TYPES as string[]).includes(r.documentType) ? (r.documentType as DocumentCategory) : 'other';
  const scalarFields = validateScalarFields(r.scalarFields);
  const driver = validateDriver(r.driver);
  const vehicle = validateVehicle(r.vehicle);
  const lossEntries = validateLossEntries(r.lossEntries);
  const candidateNotes = typeof r.candidateNotes === 'string' && r.candidateNotes.trim().length > 0 ? r.candidateNotes.trim().slice(0, 500) : undefined;

  return {
    documentType,
    documentTypeConfidence: asConfidence(r.documentTypeConfidence),
    scalarFields,
    driver,
    vehicle,
    lossEntries,
    candidateNotes,
  };
}

/** True only when the Edge Function can plausibly be called: Supabase is configured and the broker is signed in (the function requires an authenticated session). Doesn't guarantee the function is deployed or the provider key is set — extractViaVision degrades to null (→ OCR fallback) if either is missing. */
export function isVisionExtractionAvailable(currentUserId: string | null): boolean {
  return isSupabaseConfigured && !!currentUserId;
}

async function resizeToBase64(file: File): Promise<{ base64: string; mimeType: string } | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeOriented(file);
  } catch {
    return null;
  }
  try {
    const canvas = drawToCanvas(bitmap, VISION_MAX_DIMENSION);
    const dataUrl = canvas.toDataURL('image/jpeg', VISION_JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    return { base64, mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

/**
 * Attempts vision extraction for one image. Never throws — any failure (not configured, not
 * signed in, function not deployed, provider error, malformed response) resolves to null so the
 * caller always has on-device OCR to fall back to.
 */
export async function extractViaVision(file: File, currentUserId: string | null): Promise<VisionExtractionResult | null> {
  if (!isVisionExtractionAvailable(currentUserId) || !supabase) return null;

  try {
    const encoded = await resizeToBase64(file);
    if (!encoded) return null;

    const { data, error } = await supabase.functions.invoke('extract-document-vision', {
      body: { imageBase64: encoded.base64, mimeType: encoded.mimeType, fileName: file.name },
    });
    if (error || !data) return null;

    return validateVisionResponse(data);
  } catch {
    return null;
  }
}
