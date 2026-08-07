import type { Confidence, ExtractionMethod, FieldSource } from './common';
import type { UploadedDocument } from './document';

/** Dot-path into RiskProfile, e.g. "business.namedInsured" or "transportation.fleetSize" */
export type FieldPath = string;

export interface ExtractedFieldResult {
  fieldPath: FieldPath;
  value: unknown;
  confidence: Confidence;
  source: FieldSource;
  /** Defaults to 'ai_extraction' when omitted — set explicitly if a provider distinguishes OCR/LLM/API-sourced results. */
  extractionMethod?: ExtractionMethod;
}

export interface ExtractionProvider {
  extract(doc: UploadedDocument): Promise<ExtractedFieldResult[]>;
}
