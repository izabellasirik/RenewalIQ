/** Confidence level of a value. 'manual' means a broker entered/edited it directly and it is treated as ground truth. */
export type Confidence = 'high' | 'medium' | 'low' | 'manual';

/**
 * How a value was populated. 'deterministic_import' means an exact structured mapping with no
 * interpretation involved — a spreadsheet/CSV column header matched directly to a field, or (in
 * future) a structured API — per the product principle that exact structured sources should be
 * preferred over interpretation when available. 'ai_extraction' means the value was read out of
 * unstructured content (PDF/DOCX/TXT prose) via pattern matching. 'image_ocr' means the value came
 * from a photo/screenshot run through on-device OCR before that same pattern matching — kept
 * distinct from 'ai_extraction' because OCR text carries its own, generally lower,
 * transcription-error risk that the UI should always be able to disclose (see
 * services/ingestion/parseImage.ts and FieldRow's extraction-method label). 'vision_extraction'
 * means a layout-aware multimodal model read the image directly (see
 * services/ingestion/visionExtraction.ts) rather than reading OCR'd text through a regex — distinct
 * from both, since it can legitimately reach 'high' confidence on a clean image the way OCR+regex
 * never can (OCR is always capped at 'medium' — see extractInsuranceFields.ts's capConfidence).
 * 'applicant_provided' means an external, unauthenticated applicant typed the value into the public
 * intake form (see components/intake) — distinct from 'manual_entry' (a broker typing on the
 * applicant's behalf) because it carries less trust: a document later extracting a different value
 * for the same field is a genuine, visible conflict to review, not an overwrite, whereas the same
 * disagreement against a broker's own manual entry stays broker-wins per the existing merge rules.
 */
export type ExtractionMethod = 'ai_extraction' | 'deterministic_import' | 'manual_entry' | 'image_ocr' | 'vision_extraction' | 'applicant_provided';

export interface FieldSource {
  documentId: string;
  documentName: string;
  page?: number;
  excerpt?: string;
}

/**
 * Wraps every extracted (or manually entered) value with its provenance.
 * Nothing in the risk profile is ever presented as ground truth without this.
 */
export interface FieldValue<T> {
  value: T | null;
  confidence: Confidence;
  source?: FieldSource;
  isMissing: boolean;
  isConflicting: boolean;
  alternateValues?: { value: T; source: FieldSource; extractionMethod?: ExtractionMethod }[];
  /** How this value was populated. Undefined only for a field that has never been set. */
  extractionMethod?: ExtractionMethod;
  /**
   * True ONLY when a broker explicitly reviewed and picked this exact value via the conflict
   * resolver ("Use this value") — never set anywhere else. This is a deliberately separate signal
   * from `confidence === 'manual'`: the confidence value alone decided merge priority (a manual
   * pick should never lose to a later extraction) and the UI's "Broker Confirmed" label used to be
   * inferred from it, which meant any future code path that produced confidence: 'manual' for a
   * non-broker reason would silently mislabel an unreviewed value as broker-confirmed. Requiring
   * this explicit flag makes that class of bug impossible by construction — see
   * utils/dataStatus.ts's fieldDataStatus.
   */
  confirmedByBroker?: boolean;
  /** ISO timestamp this specific field was last populated/edited — distinct from the whole-profile updatedAt. */
  lastUpdatedAt?: string;
}

/**
 * One disagreeing alternate reading for a single field on an itemized row (a DriverEntry/
 * VehicleEntry), recorded when two independent extraction passes over the SAME image — typically
 * the vision model and on-device OCR — read a different value for that field. Mirrors
 * FieldValue.alternateValues in spirit (nothing a second source read is ever silently discarded)
 * but shaped for array-row entries, which aren't wrapped in FieldValue<T> the way scalar
 * business/transportation fields are. The row's primary value stays whichever source is generally
 * more reliable (vision, when both attempted the field); this is what's left over.
 */
export interface FieldConflict {
  value: unknown;
  extractionMethod: ExtractionMethod;
}

export function emptyField<T>(): FieldValue<T> {
  return { value: null, confidence: 'low', isMissing: true, isConflicting: false };
}

export function manualField<T>(value: T): FieldValue<T> {
  return { value, confidence: 'manual', isMissing: false, isConflicting: false, extractionMethod: 'manual_entry', confirmedByBroker: true, lastUpdatedAt: new Date().toISOString() };
}
