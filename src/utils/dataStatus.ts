import type { FieldValue } from '../types';

/**
 * The small, broker-facing vocabulary every extracted/entered value is reduced to for display —
 * the detailed provenance (exact source document, excerpt, extraction method, timestamp) stays
 * available in each field's expandable detail panel, but the headline status a broker sees at a
 * glance is always one of these six, never raw confidence/extractionMethod jargon.
 */
export type DataStatus = 'ai_extracted' | 'broker_confirmed' | 'broker_edited' | 'needs_review' | 'conflict' | 'not_documented' | 'applicant_provided';

export const DATA_STATUS_LABELS: Record<DataStatus, string> = {
  ai_extracted: 'AI Extracted',
  broker_confirmed: 'Broker Confirmed',
  broker_edited: 'Broker Edited',
  needs_review: 'Needs Review',
  conflict: 'Conflict',
  not_documented: 'Not Documented',
  applicant_provided: 'Applicant Provided',
};

/**
 * A field the broker picked via the conflict resolver becomes confidence: 'manual' AND
 * confirmedByBroker: true, keeping its original extractionMethod — that's "broker confirmed an
 * existing value," distinct from 'manual_entry', which means the broker actually typed a value in
 * themselves ("broker edited"). Both read as ground truth to the rest of the app; only the label
 * shown to the broker differs.
 *
 * Status is driven by `confirmedByBroker`, an explicit flag set in exactly one place
 * (resolveFieldConflict, only from a real broker click) — deliberately NOT inferred from
 * `confidence === 'manual'` alone. A real incident showed why: confidence is also the field used
 * to decide merge priority (a broker-picked value must always outrank a later extraction), so any
 * future code path that produces confidence: 'manual' for a reason OTHER than a broker click would
 * have silently mislabeled an AI value as broker-confirmed under the old confidence-only check.
 * Requiring the explicit flag makes that class of bug impossible by construction.
 *
 * 'applicant_provided' sits below broker_confirmed (a broker's explicit confirmation always wins
 * the label) but above needs_review/ai_extracted — an applicant's own answer on the intake form is
 * more trustworthy than an unreviewed low-confidence OCR read, but it's still self-reported and not
 * broker- or document-verified, so it gets its own distinct label rather than being folded into
 * ai_extracted.
 */
export function fieldDataStatus(field: Pick<FieldValue<unknown>, 'isMissing' | 'isConflicting' | 'confidence' | 'extractionMethod' | 'confirmedByBroker'>): DataStatus {
  if (field.isConflicting) return 'conflict';
  if (field.isMissing) return 'not_documented';
  if (field.extractionMethod === 'manual_entry') return 'broker_edited';
  if (field.confirmedByBroker) return 'broker_confirmed';
  if (field.extractionMethod === 'applicant_provided') return 'applicant_provided';
  if (field.confidence === 'low') return 'needs_review';
  return 'ai_extracted';
}
