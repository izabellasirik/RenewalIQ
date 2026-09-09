import type { FieldValue } from '../types';

/**
 * The small, broker-facing vocabulary every extracted/entered value is reduced to for display —
 * the detailed provenance (exact source document, excerpt, extraction method, timestamp) stays
 * available in each field's expandable detail panel, but the headline status a broker sees at a
 * glance is always one of these six, never raw confidence/extractionMethod jargon.
 */
export type DataStatus = 'ai_extracted' | 'broker_confirmed' | 'broker_edited' | 'needs_review' | 'conflict' | 'not_documented';

export const DATA_STATUS_LABELS: Record<DataStatus, string> = {
  ai_extracted: 'AI Extracted',
  broker_confirmed: 'Broker Confirmed',
  broker_edited: 'Broker Edited',
  needs_review: 'Needs Review',
  conflict: 'Conflict',
  not_documented: 'Not Documented',
};

/**
 * A field the broker picked via the conflict resolver (or otherwise confirmed as-is) becomes
 * confidence: 'manual' but keeps its original extractionMethod — that combination is "broker
 * confirmed an existing value," distinct from 'manual_entry', which means the broker actually
 * typed a value in themselves ("broker edited"). Both read as ground truth to the rest of the
 * app; only the label shown to the broker differs.
 */
export function fieldDataStatus(field: Pick<FieldValue<unknown>, 'isMissing' | 'isConflicting' | 'confidence' | 'extractionMethod'>): DataStatus {
  if (field.isConflicting) return 'conflict';
  if (field.isMissing) return 'not_documented';
  if (field.extractionMethod === 'manual_entry') return 'broker_edited';
  if (field.confidence === 'manual') return 'broker_confirmed';
  if (field.confidence === 'low') return 'needs_review';
  return 'ai_extracted';
}
