import type { VerificationStatus } from './appetite';

/**
 * Broker-facing categories a "Request Appetite Update" can target. Not every category maps to a
 * single structured AppetiteCriterion on AppetiteRecord (vehicle/submission requirements,
 * distribution/MGA, and "other" don't have one dedicated field) — see
 * services/appetite/appetiteFieldKeys.ts for exactly which ones do and how an approved value gets
 * applied. All categories are still accepted, stored, and audited regardless.
 */
export type AppetiteFieldKey =
  | 'fleet_size'
  | 'states'
  | 'years_in_business'
  | 'cdl_experience'
  | 'operation'
  | 'coverage'
  | 'new_ventures'
  | 'telematics'
  | 'dashcams'
  | 'driver_requirements'
  | 'vehicle_requirements'
  | 'submission_requirements'
  | 'distribution_mga'
  | 'other';

export const APPETITE_FIELD_KEY_LABELS: Record<AppetiteFieldKey, string> = {
  fleet_size: 'Fleet size',
  states: 'States',
  years_in_business: 'Years in business',
  cdl_experience: 'CDL experience',
  operation: 'Operation',
  coverage: 'Coverage',
  new_ventures: 'New ventures',
  telematics: 'Telematics',
  dashcams: 'Dashcams',
  driver_requirements: 'Driver requirements',
  vehicle_requirements: 'Vehicle requirements',
  submission_requirements: 'Submission requirements',
  distribution_mga: 'Distribution / MGA',
  other: 'Other',
};

export type AppetiteUpdateStatus = 'pending' | 'approved' | 'rejected' | 'needs_more_information';

/** Mirrors the `appetite_update_requests` Supabase table — see supabase/migrations. */
export interface AppetiteUpdateRequest {
  id: string;
  marketId: string;
  marketName: string;
  fieldKey: AppetiteFieldKey;
  /** Snapshot of the current value shown to the broker at submission time, for audit context — not re-derived later. */
  currentValue: unknown;
  proposedValue: string;
  notes: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  submitterName: string;
  submitterEmail: string;
  status: AppetiteUpdateStatus;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Mirrors the `appetite_update_history` Supabase table — one durable row per submission and per review decision made on it. Never deleted, including for rejections. */
export interface AppetiteUpdateHistoryEntry {
  id: string;
  requestId: string;
  marketId: string;
  fieldKey: AppetiteFieldKey;
  previousValue: unknown;
  newValue: unknown;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  status: AppetiteUpdateStatus;
  sourceUrl: string | null;
  reviewNotes: string | null;
}

/**
 * Mirrors the `appetite_overrides` Supabase table — the only thing an approval actually writes
 * live. `verificationStatus` is chosen explicitly by the admin at approval time (see Part 9 of the
 * spec this implements) — approving a broker submission never auto-promotes it to VERIFIED.
 */
export interface AppetiteOverride {
  id: string;
  marketId: string;
  fieldKey: AppetiteFieldKey;
  value: unknown;
  verificationStatus: VerificationStatus;
  sourceUrl: string | null;
  approvedBy: string;
  approvedAt: string;
  requestId: string;
}
