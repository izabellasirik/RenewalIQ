import type { DocumentCategory, ExtractedFieldResult, ReviewCandidate } from '../../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../../types';
import { generateId } from '../../../utils/id';
import { isReadableText } from '../fieldExtraction/textQuality';
import { looksLikeLabel } from '../fieldExtraction/rowValues';
import { toMonths, type DurationValue } from '../../../utils/duration';
import { classifyDocument, ENTITY_LIMITS, type DocumentClassification } from './classifyDocument';
import { assessAddress, assessDriver, assessVehicle, type EntityContext, type Verdict } from './entityValidation';
import { documentSubjectIdentity } from '../fieldExtraction/idDocumentPatterns';

/**
 * The one step between reading a document and changing an account. Everything a reader produced —
 * text patterns, table rows, OCR, the vision model — ends here in exactly one of:
 *
 *   applied  — validated and consistent with what the document is; merged into the Risk Profile.
 *   review   — possibly real but uncertain or at odds with the document; kept on the document for
 *              the broker (Apply / Edit & apply / Ignore). Never in the profile, so never counted.
 *   rejected — labels, rule lines, OCR noise; dropped (only counted).
 *
 * Precision over completeness: when in doubt, review — never guess, never apply.
 */
export interface GateResult {
  applied: ExtractedFieldResult[];
  review: ReviewCandidate[];
  rejected: number;
  classification: DocumentClassification;
}

export interface GateInput {
  results: ExtractedFieldResult[];
  text: string;
  fileName: string;
  /** Read by OCR or from a photo. */
  scanned: boolean;
  /** The vision model's own read of what the document is, for photos. */
  visionCategory?: DocumentCategory | null;
  /** The results are the AI's reading of the image itself; `text` is only OCR of it, never used to second-guess them. */
  aiRead?: boolean;
}

/** Counts a schedule's rows produce — recomputed from the rows that were actually applied. */
const ROW_DERIVED = new Set(['transportation.fleetSize', 'transportation.vehicleTypes', 'transportation.driverCount', 'transportation.minDriverExperienceYears']);
/** Single-subject documents: about a person or a vehicle, not the business applying for insurance. */
const SUBJECT_DOCUMENTS = new Set<DocumentCategory>(['driver_license', 'mvr', 'vehicle_registration', 'vehicle_title']);
const COUNT_FIELDS = /^transportation\.(?:fleetSize|driverCount|powerUnits|trailerCount|numberOf\w+)$/;

/** One scalar value on its own: readable, the right shape for its field, read with some confidence. */
export function assessScalar(r: Pick<ExtractedFieldResult, 'fieldPath' | 'value' | 'confidence'>): Verdict {
  const v = r.value;
  if (typeof v === 'string') {
    if (!isReadableText(v) || looksLikeLabel(v)) return { verdict: 'reject', reason: 'Not readable text.' };
    if (r.fieldPath === 'business.address') return assessAddress(v);
    if (r.fieldPath === 'business.namedInsured' && (v.length > 120 || !/[A-Za-z]{2}/.test(v))) return { verdict: 'reject', reason: 'Not a business name.' };
  }
  if (Array.isArray(v) && v.some((x) => typeof x === 'string' && !isReadableText(x))) return { verdict: 'reject', reason: 'Not readable text.' };
  if (COUNT_FIELDS.test(r.fieldPath) && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10000)) return { verdict: 'reject', reason: 'Not a plausible count.' };
  if (r.confidence === 'low') return { verdict: 'review', reason: 'Read with low confidence.' };
  return { verdict: 'apply' };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function gateExtraction(input: GateInput, now = new Date()): GateResult {
  const classification = classifyDocument({ text: input.text, fileName: input.fileName, visionCategory: input.visionCategory, results: input.results });
  const { category } = classification;
  const typeLabel = DOCUMENT_CATEGORY_LABELS[category];
  const uncertainDocument = classification.certainty === 'low';

  const applied: ExtractedFieldResult[] = [];
  const review: ReviewCandidate[] = [];
  let rejected = 0;
  const hold = (r: ExtractedFieldResult, reason: string) =>
    review.push({ id: generateId('rev'), fieldPath: r.fieldPath, value: r.value, confidence: r.confidence, extractionMethod: r.extractionMethod, source: r.source, reason });

  const drivers: ExtractedFieldResult[] = [];
  const vehicles: ExtractedFieldResult[] = [];
  // A driving record or a license is about its license holder. Anyone else it names — an examiner,
  // an employer's contact, someone in a table of associated persons — is never its driver.
  const oneDriverDocument = category === 'mvr' || category === 'driver_license';
  const subject = oneDriverDocument && !input.aiRead ? documentSubjectIdentity(input.text) : null;
  const licenseKey = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
  const docNoun = category === 'mvr' ? 'driving record' : 'driver’s license';
  const notTheSubject = (r: ExtractedFieldResult): string | null => {
    if (!oneDriverDocument) return null;
    if (r.extractionMethod === 'deterministic_import') return `Listed in a table on this ${docNoun} — it may be someone else the record mentions, not its license holder.`;
    const lic = licenseKey((r.value as { licenseNumber?: unknown }).licenseNumber);
    const subjectLic = licenseKey(subject?.licenseNumber);
    if (lic && subjectLic && lic !== subjectLic) return `Its license number doesn’t match this ${docNoun}’s license holder — it may be someone else the document mentions.`;
    return null;
  };

  for (const r of input.results) {
    if (ROW_DERIVED.has(r.fieldPath) && r.extractionMethod === 'deterministic_import') continue; // recomputed below
    if (r.fieldPath === 'drivers' || r.fieldPath === 'vehicles') {
      const ctx: EntityContext = { origin: r.extractionMethod === 'deterministic_import' || r.rowOrigin === 'table' ? 'table' : 'card', scanned: input.scanned, uncertainDocument };
      const verdict = r.fieldPath === 'drivers' ? assessDriver(r.value as never, ctx, now) : assessVehicle(r.value as never, ctx, now);
      if (verdict.verdict === 'reject') rejected++;
      else if (verdict.verdict === 'review') hold(r, verdict.reason);
      else if (r.holdReason) hold(r, r.holdReason);
      else if (r.fieldPath === 'drivers' && notTheSubject(r)) hold(r, notTheSubject(r)!);
      else (r.fieldPath === 'drivers' ? drivers : vehicles).push(r);
      continue;
    }
    if (r.fieldPath === 'lossHistory' || r.fieldPath === 'lossRun' || r.fieldPath === 'coverageLine') {
      if (r.holdReason && r.fieldPath !== 'lossRun') hold(r, r.holdReason);
      else applied.push(r); // claims need a real date and amounts to be read at all (lossPatterns / tableMappers)
      continue;
    }
    const verdict = assessScalar(r);
    if (verdict.verdict === 'reject') {
      rejected++;
      continue;
    }
    if (verdict.verdict === 'review' || r.holdReason) {
      hold(r, r.holdReason ?? (verdict as { reason: string }).reason);
      continue;
    }
    // A license, MVR, title or registration names a person's or an owner's details, not the
    // business applying — its address, name or state are suggestions, never applied as the business's.
    if (SUBJECT_DOCUMENTS.has(category) && (r.fieldPath.startsWith('business.') || r.fieldPath.startsWith('transportation.') || r.fieldPath.startsWith('coverage.'))) {
      hold(r, `Read from a ${typeLabel.toLowerCase()} — it may be the owner’s or driver’s details, not the business’s.`);
      continue;
    }
    applied.push(r);
  }

  // What the document is limits how many people/vehicles it can hold. More than that means the
  // reader mistook something (labels, an examiner, an owner's address) for them — nothing is
  // applied, the broker picks.
  const limits = ENTITY_LIMITS[category];
  const settle = (list: ExtractedFieldResult[], kind: 'drivers' | 'vehicles') => {
    const max = limits?.[kind];
    if (max === undefined || list.length <= max) return list;
    const noun = kind === 'drivers' ? 'driver' : 'vehicle';
    const reason =
      max === 0
        ? `A ${typeLabel.toLowerCase()} doesn’t list ${noun}s — check whether this is one.`
        : `This looks like a ${typeLabel.toLowerCase()}, which is about one ${noun}, but ${plural(list.length, `possible ${noun}`)} were read.`;
    for (const r of list) hold(r, reason);
    return [];
  };
  const keptDrivers = settle(drivers, 'drivers');
  const keptVehicles = settle(vehicles, 'vehicles');
  applied.push(...keptDrivers, ...keptVehicles);

  // Schedule counts, from the rows that were applied — never from the rows the reader found.
  const src = input.results.find((r) => r.source)?.source;
  const tableVehicles = keptVehicles.filter((r) => r.extractionMethod === 'deterministic_import' || r.rowOrigin === 'table');
  const tableDrivers = keptDrivers.filter((r) => r.extractionMethod === 'deterministic_import' || r.rowOrigin === 'table');
  if (src && tableVehicles.length) {
    applied.push({ fieldPath: 'transportation.fleetSize', value: tableVehicles.length, confidence: 'high', extractionMethod: 'deterministic_import', source: { documentId: src.documentId, documentName: src.documentName, excerpt: `${plural(tableVehicles.length, 'vehicle')} listed` } });
    const types = Array.from(new Set(tableVehicles.map((r) => (r.value as { bodyType?: string }).bodyType).filter((t): t is string => !!t)));
    if (types.length) applied.push({ fieldPath: 'transportation.vehicleTypes', value: types, confidence: 'high', extractionMethod: 'deterministic_import', source: { documentId: src.documentId, documentName: src.documentName, excerpt: `Vehicle types listed: ${types.join(', ')}` } });
  }
  if (src && tableDrivers.length) {
    applied.push({ fieldPath: 'transportation.driverCount', value: tableDrivers.length, confidence: 'high', extractionMethod: 'deterministic_import', source: { documentId: src.documentId, documentName: src.documentName, excerpt: `${plural(tableDrivers.length, 'driver')} listed` } });
    const exp = tableDrivers.map((r) => (r.value as { yearsExperience?: DurationValue }).yearsExperience).filter((v): v is DurationValue => v !== undefined && toMonths(v) !== null);
    if (exp.length) applied.push({ fieldPath: 'transportation.minDriverExperienceYears', value: exp.reduce((min, v) => (toMonths(v)! < toMonths(min)! ? v : min)), confidence: 'high', extractionMethod: 'deterministic_import', source: { documentId: src.documentId, documentName: src.documentName, excerpt: 'Minimum years of experience across the drivers listed' } });
  }

  return { applied, review, rejected, classification };
}
