import type {
  ApplicationTemplate,
  FieldMapping,
  MappedApplication,
  MappedApplicationSection,
  MappedField,
  RiskProfile,
} from '../../types';
import { CONFIDENCE_ORDER } from '../../utils/confidence';
import { getFieldValueByPath } from '../../utils/riskProfilePath';

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && value >= 1000) return value.toLocaleString('en-US');
  return String(value);
}

/**
 * Maps one target field. Never guesses: a missing, conflicting, or below-threshold-confidence
 * source value is flagged 'needs_review' with a reason — the value (if any) is still shown so
 * the broker can see what's there, but it's never presented as reliable.
 */
function mapField(profile: RiskProfile, mapping: FieldMapping): MappedField {
  const field = getFieldValueByPath(profile, mapping.riskProfilePath);
  const format = mapping.format ?? defaultFormat;
  const editable = mapping.editable ?? true;
  // Default threshold is 'medium': a 'low'-confidence extraction is flagged unless a mapping
  // explicitly opts into accepting it (minConfidence: 'low') for a non-critical field.
  const minConfidence = mapping.minConfidence ?? 'medium';

  const base = { targetFieldId: mapping.targetFieldId, targetLabel: mapping.targetLabel, editable };

  if (!field || field.isMissing) {
    return { ...base, value: '', status: 'needs_review', reviewReason: 'No data available in the risk profile.' };
  }

  const value = format(field.value);

  if (field.isConflicting) {
    return {
      ...base,
      value,
      status: 'needs_review',
      confidence: field.confidence,
      source: field.source,
      reviewReason: 'Conflicting values across documents — resolve in Risk Profile before relying on this field.',
    };
  }

  if (CONFIDENCE_ORDER[field.confidence] > CONFIDENCE_ORDER[minConfidence]) {
    return {
      ...base,
      value,
      status: 'needs_review',
      confidence: field.confidence,
      source: field.source,
      reviewReason: `Low-confidence extraction (${field.confidence}) — verify before submitting.`,
    };
  }

  return { ...base, value, status: 'mapped', confidence: field.confidence, source: field.source };
}

function buildLossHistorySection(profile: RiskProfile): MappedApplicationSection {
  if (profile.lossHistory.length === 0) {
    return {
      title: 'Loss History Summary',
      fields: [
        {
          targetFieldId: 'loss_history_summary',
          targetLabel: 'Loss Runs on File',
          value: '',
          status: 'needs_review',
          reviewReason: 'No loss run has been uploaded for this account yet.',
          editable: false,
        },
      ],
    };
  }

  const sorted = [...profile.lossHistory].sort((a, b) => (a.lossDate < b.lossDate ? 1 : -1));
  return {
    title: 'Loss History Summary',
    fields: sorted.map((entry) => ({
      targetFieldId: `loss_${entry.id}`,
      targetLabel: `${entry.lossDate} — ${entry.claimType}`,
      value: `Paid $${entry.paid.toLocaleString('en-US')} · Reserved $${entry.reserved.toLocaleString('en-US')} · Incurred $${entry.incurred.toLocaleString('en-US')} · ${entry.status === 'open' ? 'Open' : 'Closed'}`,
      status: 'mapped',
      source: entry.source,
      editable: false,
    })),
  };
}

/**
 * The reusable field-mapping layer: turns a RiskProfile into a filled-out target application by
 * walking a declarative ApplicationTemplate. Supporting a new carrier/MGA application is adding a
 * new ApplicationTemplate (data) to services/application/templates.ts — this function and the
 * extraction pipeline it reads from never change.
 */
export function mapRiskProfileToApplication(profile: RiskProfile, template: ApplicationTemplate): MappedApplication {
  const sections: MappedApplicationSection[] = template.sections.map((section) => ({
    title: section.title,
    fields: section.fields.map((mapping) => mapField(profile, mapping)),
  }));

  if (template.includeLossHistory ?? true) {
    sections.push(buildLossHistorySection(profile));
  }

  const fieldsNeedingReview = sections.reduce((sum, s) => sum + s.fields.filter((f) => f.status === 'needs_review').length, 0);

  return {
    accountId: profile.accountId,
    templateId: template.id,
    templateName: template.name,
    generatedAt: new Date().toISOString(),
    sections,
    fieldsNeedingReview,
  };
}
