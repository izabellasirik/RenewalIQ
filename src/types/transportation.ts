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
  minDriverExperienceYears: FieldValue<number>;
  telematics: FieldValue<boolean>;
  dashcams: FieldValue<boolean>;
}
