import type { FieldValue } from './common';

export type CoverageType = 'auto_liability' | 'motor_truck_cargo' | 'physical_damage' | 'general_liability' | 'warehouse_legal_liability';

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  auto_liability: 'Auto Liability',
  motor_truck_cargo: 'Motor Truck Cargo',
  physical_damage: 'Physical Damage',
  general_liability: 'General Liability',
  warehouse_legal_liability: 'Warehouse Legal Liability',
};

export interface CoverageLine {
  type: CoverageType;
  currentLimit?: FieldValue<string>;
  requestedLimit: FieldValue<string>;
}

/**
 * A coverage line only exists in `RiskProfile.coverage` at all when it was genuinely extracted from
 * a document, imported from an intake submission, or explicitly added by the broker (see
 * services/extraction/extractionService.ts's 'coverageLine'/'coverage.*' merge handling and
 * useAccountsStore's addCoverageLine) — never created as a default/placeholder set. So "applicable"
 * for completion purposes is simply "a line exists here"; nothing further to check.
 *
 * Current Limit is informational only and never gates completion — a new-business or
 * no-current-coverage account legitimately has no current policy to report, so only the Requested
 * Limit (what's actually being asked for) determines whether an applicable line is done.
 */
export function isCoverageLineComplete(line: CoverageLine): boolean {
  return !line.requestedLimit.isMissing && !line.requestedLimit.isConflicting;
}

/** True when every coverage line the submission actually has is complete (see isCoverageLineComplete) — vacuously true for an empty array, so callers that want "nothing requested yet" treated as not-done must check `coverage.length` themselves. */
export function isCoverageComplete(coverage: CoverageLine[]): boolean {
  return coverage.every(isCoverageLineComplete);
}
