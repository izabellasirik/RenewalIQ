import type { FieldSource } from './common';

export interface DriverEntry {
  id: string;
  name?: string;
  dob?: string;
  licenseState?: string;
  yearsExperience?: number;
  violations?: string;
  /** Absent for a broker-added row (isManual: true) — there is no document to point to. */
  source?: FieldSource;
  /** True for a row the broker added or edited directly, rather than one extracted from a document. Deleting a document never removes or alters a manual row. */
  isManual?: boolean;
  lastUpdatedAt?: string;
}
