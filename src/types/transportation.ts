import type { DurationValue } from '../utils/duration';
import type { FieldValue } from './common';

export interface TransportationInfo {
  dotNumber: FieldValue<string>;
  mcNumber: FieldValue<string>;
  fleetSize: FieldValue<number>;
  vehicleTypes: FieldValue<string[]>;
  operatingRadius: FieldValue<string>;
  statesOfOperation: FieldValue<string[]>;
  commoditiesHauled: FieldValue<string[]>;
  driverCount: FieldValue<number>;
  minDriverAge: FieldValue<number>;
  /** Key name kept for compatibility; value is a legacy number of years or a Duration in months (utils/duration.ts). */
  minDriverExperienceYears: FieldValue<DurationValue>;
  telematics: FieldValue<boolean>;
  /** Free text next to the Yes/No: provider, which units ("Samsara on all power units"). Absent on older profiles. */
  telematicsDetails?: FieldValue<string>;
  dashcams: FieldValue<boolean>;
  /** Free text next to the Yes/No: provider, road-/driver-facing, which units. Absent on older profiles. */
  dashcamsDetails?: FieldValue<string>;
}
