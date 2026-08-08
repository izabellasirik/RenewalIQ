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
}
