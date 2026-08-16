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
