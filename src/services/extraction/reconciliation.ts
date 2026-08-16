import type { CoverageType, FieldValue, RiskProfile } from '../../types';
import { COVERAGE_LABELS } from '../../types';

export interface FieldReconciliationSource {
  source: string;
  value: unknown;
}

export interface FieldReconciliation {
  field: string;
  value: unknown;
  sources: FieldReconciliationSource[];
  status: 'ok' | 'conflict' | 'missing';
}

/**
 * Projects a FieldValue's existing provenance (source + alternateValues — already populated by
 * mergeFieldValue for every scalar field, not a second tracking system) into the small
 * broker-facing {field, value, sources, status} shape. Deliberately reuses what extraction already
 * recorded rather than re-scanning documents, so a source only appears here if a value was
 * actually accepted from it — a document that merely mentions a field without a parseable value
 * (e.g. prose saying "I'll send it later") isn't represented as a source, since no value was ever
 * extracted from it to reconcile.
 */
function reconcileField(field: string, fv: FieldValue<unknown>): FieldReconciliation {
  const sources: FieldReconciliationSource[] = [];
  if (fv.source) sources.push({ source: fv.source.documentName, value: fv.value });
  for (const alt of fv.alternateValues ?? []) sources.push({ source: alt.source.documentName, value: alt.value });

  const status: FieldReconciliation['status'] = fv.isConflicting ? 'conflict' : fv.isMissing ? 'missing' : 'ok';
  return { field, value: fv.value, sources, status };
}

/**
 * Small cross-document reconciliation layer over the fields most prone to silent disagreement:
 * identifiers (never guessed — status stays 'missing' with no sources when truly absent) and fleet
 * size (compared against the itemized vehicle schedule, since both can independently claim a count).
 */
export function buildFieldReconciliation(profile: RiskProfile): FieldReconciliation[] {
  const results: FieldReconciliation[] = [
    reconcileField('mcNumber', profile.transportation.mcNumber),
    reconcileField('dotNumber', profile.transportation.dotNumber),
    reconcileField('fleetSize', profile.transportation.fleetSize),
  ];

  if (profile.vehicles.length > 0) {
    const fleetSize = results.find((r) => r.field === 'fleetSize')!;
    const alreadyHasVehicleSchedule = fleetSize.sources.some((s) => s.value === profile.vehicles.length);
    if (!alreadyHasVehicleSchedule) {
      fleetSize.sources.push({ source: 'Vehicle schedule (itemized count)', value: profile.vehicles.length });
      if (fleetSize.value !== null && fleetSize.value !== profile.vehicles.length) fleetSize.status = 'conflict';
    }
  }

  for (const line of profile.coverage) {
    results.push(reconcileField(`coverage.${line.type}.requestedLimit`, line.requestedLimit));
  }

  return results;
}

/**
 * Human-readable submission-quality warnings, computed from data the extraction/merge pipeline
 * already tracks (isMissing/isConflicting flags, itemized array lengths) — never a second source of
 * truth, just a plain-language summary of what a broker should double-check before submitting.
 */
export function buildSubmissionWarnings(profile: RiskProfile): string[] {
  const warnings: string[] = [];

  if (profile.transportation.mcNumber.isMissing) {
    warnings.push('MC Number is missing from all submitted documents.');
  }

  if (profile.transportation.fleetSize.isConflicting) {
    const primary = profile.transportation.fleetSize.value;
    const altCount = profile.transportation.fleetSize.alternateValues?.[0]?.value;
    warnings.push(
      `Fleet size conflict: extracted value = ${primary ?? 'unknown'}; vehicle schedule contains ${altCount ?? profile.vehicles.length} vehicle${profile.vehicles.length === 1 ? '' : 's'}. Resolve in Risk Profile before submitting.`
    );
  } else if (profile.transportation.fleetSize.value !== null && profile.vehicles.length > 0 && profile.transportation.fleetSize.value !== profile.vehicles.length) {
    warnings.push(`Fleet size conflict: questionnaire/extracted value = ${profile.transportation.fleetSize.value}; vehicle schedule contains ${profile.vehicles.length} vehicles.`);
  }

  if (profile.vehicles.length === 0) {
    warnings.push('No vehicle schedule on file — vehicle details are missing.');
  }

  const hasCurrentPolicyOnFile = profile.coverage.some((c) => c.currentLimit && !c.currentLimit.isMissing);
  for (const line of profile.coverage) {
    const label = COVERAGE_LABELS[line.type as CoverageType];
    if (line.requestedLimit.isMissing) {
      warnings.push(`${label} was requested but no limit was specified.`);
    }
    const isNewCoverage = hasCurrentPolicyOnFile && (!line.currentLimit || line.currentLimit.isMissing);
    if (isNewCoverage) {
      warnings.push(`${label} is a new requested coverage — not on the current policy.`);
    }
  }

  return warnings;
}
