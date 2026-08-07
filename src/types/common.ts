/** Confidence level of a value. 'manual' means a broker entered/edited it directly and it is treated as ground truth. */
export type Confidence = 'high' | 'medium' | 'low' | 'manual';

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
  alternateValues?: { value: T; source: FieldSource }[];
}

export function emptyField<T>(): FieldValue<T> {
  return { value: null, confidence: 'low', isMissing: true, isConflicting: false };
}

export function manualField<T>(value: T): FieldValue<T> {
  return { value, confidence: 'manual', isMissing: false, isConflicting: false };
}
