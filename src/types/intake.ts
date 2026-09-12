import type { CoverageType } from './coverage';

/**
 * External Submission Intake — lets a broker share an unauthenticated link so an agency, safety
 * company, or client can submit a new account without a Renewal IQ login. See
 * supabase/migrations/0004_intake_submissions.sql for the full security model: submissions land in
 * a staging table an anonymous visitor can only insert into (never read back), and a broker's own
 * "Import" click (see services/supabase/intakeRepo.ts) turns one into a real account by reusing the
 * exact same createAccountFromExtraction/addFiles pipeline any other submission uses.
 */

export type IntakeSubmissionStatus = 'pending' | 'imported' | 'dismissed';

export interface IntakeLink {
  id: string;
  userId: string;
  /** Broker-internal — identifies which source this link is for (e.g. "ABC Agency"), never shown to the applicant/recipient. See components/IntakeLinksPage.tsx's "Source: {label}" display and organizationName below for the recipient-facing equivalent. */
  label: string;
  /** The recipient-facing brokerage/organization name ("You're submitting this directly to {organizationName} for review.") — deliberately a separate concept from `label`. Null until the broker sets one (the app pre-fills new links from the broker's most recently created link). See 0007_intake_link_organization_name.sql for why this lives here rather than on a real organization/workspace table, which doesn't exist yet. */
  organizationName: string | null;
  token: string;
  active: boolean;
  createdAt: string;
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
