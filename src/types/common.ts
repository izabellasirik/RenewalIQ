/** Confidence level of a value. 'manual' means a broker entered/edited it directly and it is treated as ground truth. */
export type Confidence = 'high' | 'medium' | 'low' | 'manual';

/**
 * How a value was populated. 'deterministic_import' means an exact structured mapping with no
 * interpretation involved — a spreadsheet/CSV column header matched directly to a field, or (in
 * future) a structured API — per the product principle that exact structured sources should be
 * preferred over interpretation when available. 'ai_extraction' means the value was read out of
 * unstructured content (PDF/DOCX/TXT prose) via pattern matching or a real model.
 */
export type ExtractionMethod = 'ai_extraction' | 'deterministic_import' | 'manual_entry';

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
  /** ISO timestamp this specific field was last populated/edited — distinct from the whole-profile updatedAt. */
  lastUpdatedAt?: string;
}

export function emptyField<T>(): FieldValue<T> {
  return { value: null, confidence: 'low', isMissing: true, isConflicting: false };
}

export function manualField<T>(value: T): FieldValue<T> {
  return { value, confidence: 'manual', isMissing: false, isConflicting: false, extractionMethod: 'manual_entry', lastUpdatedAt: new Date().toISOString() };
}
