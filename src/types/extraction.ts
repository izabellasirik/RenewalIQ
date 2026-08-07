import type { Confidence, FieldSource } from './common';
import type { UploadedDocument } from './document';

/** Dot-path into RiskProfile, e.g. "business.namedInsured" or "transportation.fleetSize" */
export type FieldPath = string;

export interface ExtractedFieldResult {
  fieldPath: FieldPath;
  value: unknown;
  confidence: Confidence;
  source: FieldSource;
}

export interface ExtractionProvider {
  extract(doc: UploadedDocument): Promise<ExtractedFieldResult[]>;
}
