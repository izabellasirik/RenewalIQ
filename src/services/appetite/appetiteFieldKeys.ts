import type { AppetiteFieldKey, AppetiteOverride, AppetiteRecord, VerificationStatus } from '../../types';
import { formatStates, formatFleetSize } from '../../utils/appetiteFormatters';
import { getDistributionPartnerNamesByRecordId } from './distribution';

/** The shared "we have nothing structured to show" sentinel for the request form — never a fallback onto underwritingNotes/research notes/matching rationale, which aren't a "current value" for any specific field. */
const NOT_DOCUMENTED = 'Not currently documented';

/**
 * The single source of truth for which broker-facing update category maps to which structured
 * AppetiteCriterion on AppetiteRecord — used both to show "current value" on the request form and
 * to decide where an approved override actually gets written. Four categories genuinely don't have
 * one dedicated structured field yet (vehicle/submission requirements, distribution/MGA, other):
 * those return null here on purpose, rather than guessing a mismatched target.
 */
const FIELD_KEY_TO_CRITERION: Partial<Record<AppetiteFieldKey, keyof AppetiteRecord>> = {
  fleet_size: 'fleetSize',
  states: 'states',
  years_in_business: 'yearsInBusinessMin',
  cdl_experience: 'minDriverExperienceYears',
  operation: 'operationTypes',
  coverage: 'linesOffered',
  new_ventures: 'yearsInBusinessMax',
  telematics: 'telematicsRequired',
  dashcams: 'dashcamRequired',
  driver_requirements: 'minDriverAge',
};

/** Formats a structured criterion for display, collapsing every "nothing on file" case to one sentinel rather than showing raw formatter text like "Not verified". */
function displayCriterion<T>(criterion: { value: T | null }, formatter: (v: T) => string): string {
  return criterion.value === null ? NOT_DOCUMENTED : formatter(criterion.value);
}

/**
 * Human-readable current value for a field category, shown on the request form and snapshotted
 * into the request's currentValue column. Never falls back to underwritingNotes, research notes,
 * matching rationale, or verification explanations — those describe the market generally, not the
 * specific field being requested, and presenting them as a "current value" would be misleading.
 * Categories with no dedicated structured field ('vehicle_requirements', 'submission_requirements')
 * read as not-documented instead. 'other' is handled entirely in the UI (no Current Value shown at
 * all) — this case exists only so getCurrentValueDisplay stays total over AppetiteFieldKey.
 */
export function getCurrentValueDisplay(record: AppetiteRecord, fieldKey: AppetiteFieldKey): string {
  switch (fieldKey) {
    case 'states':
      return record.states.value === null ? NOT_DOCUMENTED : formatStates(record);
    case 'fleet_size':
      return record.fleetSize.value === null ? NOT_DOCUMENTED : formatFleetSize(record);
    case 'years_in_business':
      return displayCriterion(record.yearsInBusinessMin, (v) => `${v}+ years`);
    case 'cdl_experience':
      return displayCriterion(record.minDriverExperienceYears, (v) => `${v} years`);
    case 'operation':
      return displayCriterion(record.operationTypes, (v) => v.join(', '));
    case 'coverage':
      return displayCriterion(record.linesOffered, (v) => v.join(', '));
    case 'new_ventures':
      return displayCriterion(record.yearsInBusinessMax, (v) => `under ${v} years`);
    case 'telematics':
      return displayCriterion(record.telematicsRequired, (v) => (v ? 'Required' : 'Not required'));
    case 'dashcams':
      return displayCriterion(record.dashcamRequired, (v) => (v ? 'Required' : 'Not required'));
    case 'driver_requirements':
      return displayCriterion(record.minDriverAge, (v) => `Min. age ${v}`);
    case 'distribution_mga': {
      if (record.marketType !== 'mga') return 'Direct';
      const partnerNames = getDistributionPartnerNamesByRecordId(record.id);
      if (partnerNames.length > 0) return partnerNames.join(', ');
      return record.availableThrough ?? NOT_DOCUMENTED;
    }
    case 'vehicle_requirements':
    case 'submission_requirements':
    case 'other':
      return NOT_DOCUMENTED;
    default:
      return NOT_DOCUMENTED;
  }
}

/** The raw (JSON-serializable) current value snapshotted into the request row at submission time. */
export function getCurrentValueRaw(record: AppetiteRecord, fieldKey: AppetiteFieldKey): unknown {
  const key = FIELD_KEY_TO_CRITERION[fieldKey];
  if (!key) return null;
  const criterion = record[key] as { value: unknown } | undefined;
  return criterion?.value ?? null;
}

/**
 * Applies one approved override on top of a base AppetiteRecord, returning a new record — never
 * mutates the input. For the four categories with no structured criterion, the override is folded
 * into `underwritingNotes` as a clearly-flagged line instead of corrupting an unrelated field.
 * `history` on the affected criterion gets the previous value pushed on, so the criterion-level
 * provenance system (kept unchanged from the existing architecture) records the change.
 */
export function applyOverrideToRecord(record: AppetiteRecord, override: AppetiteOverride): AppetiteRecord {
  const key = FIELD_KEY_TO_CRITERION[override.fieldKey];

  if (!key) {
    const flagged = `[Broker-submitted update, approved ${override.approvedAt.slice(0, 10)}]: ${String(override.value)}`;
    return { ...record, underwritingNotes: record.underwritingNotes ? `${record.underwritingNotes}\n${flagged}` : flagged };
  }

  const existing = record[key] as { value: unknown; history?: unknown[] };
  const nextCriterion = {
    ...existing,
    value: override.value,
    verificationStatus: override.verificationStatus as VerificationStatus,
    source: {
      sourceType: 'BROKER' as const,
      sourceUrl: override.sourceUrl ?? undefined,
      verifiedAt: override.approvedAt,
    },
    history: [
      ...(existing.history ?? []),
      { value: existing.value, source: (existing as { source?: unknown }).source, changedAt: override.approvedAt, updatedBy: override.approvedBy },
    ],
  };

  return { ...record, [key]: nextCriterion };
}

/** Applies every override that matches a record's id, one field at a time. Records with no matching override are returned unchanged. */
export function applyOverrides(base: AppetiteRecord[], overrides: AppetiteOverride[]): AppetiteRecord[] {
  if (overrides.length === 0) return base;
  return base.map((record) => overrides.filter((o) => o.marketId === record.id).reduce((acc, o) => applyOverrideToRecord(acc, o), record));
}
