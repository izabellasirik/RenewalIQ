import type { FieldSource } from './common';

export interface VehicleEntry {
  id: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  value?: number;
  source: FieldSource;
}
