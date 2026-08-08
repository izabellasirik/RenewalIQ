import type { FieldSource } from './common';

export interface VehicleEntry {
  id: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  value?: number;
  /** Normalized category (Tractor / Power Unit, Straight Truck, Trailer, Van, Pickup) — only set when an explicit type/body-type column says so, never guessed from make/model. */
  bodyType?: string;
  source: FieldSource;
}
