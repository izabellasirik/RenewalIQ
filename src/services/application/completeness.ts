import type { DocumentCategory, RiskProfile, UploadedDocument } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { mapRiskProfileToApplication } from './fieldMappingEngine';
import { APPLICATION_TEMPLATES, DEFAULT_APPLICATION_TEMPLATE_ID } from './templates';
import { buildSubmissionWarnings } from '../extraction/reconciliation';

/**
 * "What's missing?" — a broker-facing completeness readout built entirely from data Renewal IQ
 * already defines, never a second set of invented insurance requirements:
 *   - Required vs. recommended SCALAR fields come from the application template's own
 *     FieldMapping.required flag (services/application/templates.ts) — the same flag that already
 *     drives the Submission Assistant's field badges. A field is "missing" here exactly when
 *     mapRiskProfileToApplication already says so (status 'missing'); nothing is re-derived.
 *   - "Needs review" / "Conflicts" are the same statuses the Submission Assistant already shows
 *     per field (low-confidence extraction, or documents disagreeing) — surfaced here as one
 *     consolidated list instead of scattered per-field badges.
 *   - Driver/vehicle information reuses the exact "no itemized schedule on file" condition
 *     buildSubmissionWarnings already flags (see services/extraction/reconciliation.ts).
 *   - "Recommended documents" checks for at least one uploaded loss run — the one source document
 *     Renewal IQ can't generate itself. An "Insurance Application" is deliberately NOT on this list:
 *     Renewal IQ generates the application from the structured Risk Profile, so nothing is missing
 *     just because a broker didn't also upload one (uploading an existing application as a source
 *     to extract from is still fully supported — it's just never a completeness requirement).
 */

export interface CompletenessItem {
  label: string;
  detail?: string;
  /** Present only for a scalar field the broker can actually edit in place (the "What's Missing?" panel's Edit/Add action) — a synthetic item like "Driver information" or a missing document has nowhere single to write a value back to, so it's left undefined and stays read-only there. */
  riskProfilePath?: string;
}

export interface SubmissionCompleteness {
  /**
   * Required-fields-filled ratio only, rounded to a whole percent — deliberately not a weighted
   * blend of required+recommended+documents+conflicts. The underlying signal (how many of the
   * fields this product already calls "required" are actually filled) is simple, so the number
   * stays simple rather than implying a precision the rules don't have.
   */
  percent: number;
  missingRequiredFields: CompletenessItem[];
  missingRecommendedFields: CompletenessItem[];
  missingRecommendedDocuments: CompletenessItem[];
  needsReview: CompletenessItem[];
  conflicts: CompletenessItem[];
}

// Deliberately excludes 'application' — Renewal IQ generates the application itself from the
// structured Risk Profile, so an uploaded copy of an existing application is a source document to
// extract from (still fully supported), never a submission-completeness requirement.
const RECOMMENDED_DOCUMENT_CATEGORIES: DocumentCategory[] = ['loss_run'];

export function computeSubmissionCompleteness(profile: RiskProfile, documents: UploadedDocument[]): SubmissionCompleteness {
  const template = APPLICATION_TEMPLATES.find((t) => t.id === DEFAULT_APPLICATION_TEMPLATE_ID) ?? APPLICATION_TEMPLATES[0];
  const application = mapRiskProfileToApplication(profile, template);

  const missingRequiredFields: CompletenessItem[] = [];
  const missingRecommendedFields: CompletenessItem[] = [];
  const needsReview: CompletenessItem[] = [];
  const conflicts: CompletenessItem[] = [];

  for (const section of application.sections) {
    for (const field of section.fields) {
      if (field.status === 'missing') {
        if (!field.neverFlagMissing) {
          (field.required ? missingRequiredFields : missingRecommendedFields).push({ label: field.targetLabel, detail: field.reviewReason, riskProfilePath: field.riskProfilePath });
        }
      } else if (field.status === 'needs_review') {
        needsReview.push({ label: field.targetLabel, detail: field.reviewReason });
      } else if (field.status === 'conflict') {
        conflicts.push({ label: field.targetLabel, detail: field.reviewReason });
      }
    }
  }

  // Itemized rows: an entirely-empty vehicle/driver schedule is already something Renewal IQ flags
  // (see buildSubmissionWarnings) — surfaced here as its own recommended item, since it's broker-
  // fillable data (add a row directly in the Risk Profile), not a missing upload.
  if (profile.drivers.length === 0) missingRecommendedFields.push({ label: 'Driver information', detail: 'No drivers on file yet — add at least one in the Risk Profile.' });
  if (profile.vehicles.length === 0) missingRecommendedFields.push({ label: 'Vehicle information', detail: 'No vehicle schedule on file yet — add at least one in the Risk Profile.' });

  const missingRecommendedDocuments: CompletenessItem[] = [];
  for (const category of RECOMMENDED_DOCUMENT_CATEGORIES) {
    const label = DOCUMENT_CATEGORY_LABELS[category];
    const hasOne = documents.some((d) => d.category === category && d.status !== 'error');
    if (!hasOne) missingRecommendedDocuments.push({ label, detail: `No ${label.toLowerCase()} uploaded yet.` });
  }

  // Cross-field submission-quality checks (e.g. "fleet size says 12 but the vehicle schedule has
  // 9 rows") that a single field's own status can't express — this used to be its own section in
  // the exported PDF; it now lives only here, in the broker UI, per product direction (an exported
  // application should contain application data, not internal review notes). Anything that just
  // restates a field already listed above (e.g. "MC Number is missing") is skipped so the same fact
  // isn't shown twice under two different labels.
  const alreadyFlaggedLabels = [...missingRequiredFields, ...missingRecommendedFields, ...needsReview, ...conflicts].map((i) => i.label);
  for (const warning of buildSubmissionWarnings(profile)) {
    if (!alreadyFlaggedLabels.some((label) => warning.includes(label))) {
      needsReview.push({ label: 'Submission quality', detail: warning });
    }
  }

  const requiredTotal = application.sections.reduce((sum, s) => sum + s.fields.filter((f) => f.required).length, 0);
  const requiredFilled = requiredTotal - missingRequiredFields.length;
  const percent = requiredTotal === 0 ? 100 : Math.round((requiredFilled / requiredTotal) * 100);

  return { percent, missingRequiredFields, missingRecommendedFields, missingRecommendedDocuments, needsReview, conflicts };
}

/** True when nothing at all is flagged — required, recommended, documents, review, or conflict. */
export function isSubmissionComplete(c: SubmissionCompleteness): boolean {
  return (
    c.missingRequiredFields.length === 0 &&
    c.missingRecommendedFields.length === 0 &&
    c.missingRecommendedDocuments.length === 0 &&
    c.needsReview.length === 0 &&
    c.conflicts.length === 0
  );
}
