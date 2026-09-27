import type { FieldValue } from './common';

export type CoverageType =
  | 'auto_liability'
  | 'motor_truck_cargo'
  | 'physical_damage'
  | 'general_liability'
  | 'warehouse_legal_liability'
  | 'trailer_interchange'
  | 'non_trucking_liability';

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  auto_liability: 'Auto Liability',
  motor_truck_cargo: 'Motor Truck Cargo',
  physical_damage: 'Physical Damage',
  general_liability: 'General Liability',
  warehouse_legal_liability: 'Warehouse Legal Liability',
  trailer_interchange: 'Trailer Interchange',
  non_trucking_liability: 'Non-Trucking Liability',
};

export interface CoverageLine {
  type: CoverageType;
  currentLimit?: FieldValue<string>;
  requestedLimit: FieldValue<string>;
  /** This coverage's deductible (e.g. Physical Damage, Cargo) — one per coverage, not account-wide. */
  deductible?: FieldValue<string>;
}

/** The editable values of a coverage line. */
export type CoverageField = 'currentLimit' | 'requestedLimit' | 'deductible';

/** Coverages that carry a deductible (shown only on these). */
export const DEDUCTIBLE_COVERAGES: CoverageType[] = ['physical_damage', 'motor_truck_cargo', 'trailer_interchange', 'warehouse_legal_liability', 'general_liability'];
