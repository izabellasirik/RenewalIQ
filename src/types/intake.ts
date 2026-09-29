import type { CoverageType } from './coverage';

/**
 * External Submission Intake — lets a broker share an unauthenticated link so an agency, safety
 * company, or client can submit a new account without a Renewal IQ login. See
 * supabase/migrations/0004_intake_submissions.sql for the full security model: submissions land in
 * a staging table an anonymous visitor can only insert into (never read back), and a broker's own
 * "Import" click (see services/supabase/intakeRepo.ts) turns one into a real account by reusing the
 * exact same createAccountFromExtraction/addFiles pipeline any other submission uses.
 */

/** uploading = the client is still sending it (not importable); incomplete = they stopped before finishing (0029). */
export type IntakeSubmissionStatus = 'uploading' | 'pending' | 'imported' | 'dismissed' | 'incomplete';

export interface IntakeLink {
  id: string;
  userId: string;
  /** Broker-internal note for telling sources apart — never shown to the person filling in the form. */
  label: string;
  /** The agency name the person filling in the form sees ("submitting this directly to …"). Null = not set; the form says "your insurance broker". */
  organizationName: string | null;
  token: string;
  active: boolean;
  createdAt: string;
  /** Whose link it is — shown when an admin sees the agency's links (0036). */
  ownerName?: string;
  /** Submissions through it not yet imported or dismissed (0036) — a link with any can't be deleted. */
  openSubmissions?: number;
  totalSubmissions?: number;
}

/**
 * One applicant's raw answers, exactly as typed on the public form — every field nullable since
 * only named insured / contact name / contact email are required client-side (see
 * IntakeFormPage.tsx). Deliberately flat and un-reconciled: these become 'applicant_provided'
 * FieldValues in the Risk Profile only once a broker imports the submission (see
 * services/intake/importIntakeSubmission.ts), never before.
 */
export interface IntakeSubmission {
  id: string;
  intakeLinkId: string;
  userId: string;
  status: IntakeSubmissionStatus;
  namedInsured: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  yearsInBusiness: number | null;
  powerUnits: number | null;
  driverCount: number | null;
  operationType: string | null;
  commoditiesHauled: string | null;
  operatingRadius: string | null;
  operatingStates: string | null;
  coverageRequested: CoverageType[];
  currentCarrier: string | null;
  effectiveDate: string | null;
  additionalNotes: string | null;
  createdAt: string;
  importedAt: string | null;
  importedAccountId: string | null;
  /** The confirmation number the client was given (0029). */
  reference?: string | null;
  /** How many files the client was sending (0029). */
  expectedFiles?: number | null;
  /** When the server verified the submission complete (0029). */
  completedAt?: string | null;
  lastActivityAt?: string | null;
}

/** One entry of a submission's history (0029 intake_events). */
export interface IntakeEvent {
  id: number;
  event: 'started' | 'resumed' | 'file_uploaded' | 'file_failed' | 'file_retry' | 'file_removed' | 'verification_failed' | 'completed' | 'abandoned' | 'imported' | 'dismissed';
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface IntakeDocument {
  id: string;
  intakeSubmissionId: string;
  userId: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number | null;
  createdAt: string;
}
