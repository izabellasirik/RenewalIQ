import type { Confidence, ExtractionMethod, FieldSource } from './common';

/** Dot-path into RiskProfile, e.g. "business.namedInsured" or "transportation.fleetSize" */
export type FieldPath = string;

export interface ExtractedFieldResult {
  fieldPath: FieldPath;
  value: unknown;
  confidence: Confidence;
  source: FieldSource;
  /** Defaults to 'ai_extraction' when omitted. */
  extractionMethod?: ExtractionMethod;
  /** A driver/vehicle row read from a schedule or list (any reader) rather than from one license/registration — judged like a table row (see extractionGate). */
  rowOrigin?: 'table';
  /** Never applied on its own: held for the broker with this reason (e.g. read by OCR because the AI reading wasn't available). */
  holdReason?: string;
}
