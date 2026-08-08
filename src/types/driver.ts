import type { FieldSource } from './common';

export interface DriverEntry {
  id: string;
  name?: string;
  dob?: string;
  licenseState?: string;
  yearsExperience?: number;
  violations?: string;
  source: FieldSource;
}
