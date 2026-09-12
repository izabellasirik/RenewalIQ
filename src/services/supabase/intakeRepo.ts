import { supabase } from './client';
import type { CoverageType, IntakeDocument, IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../../types';
import { generateId } from '../../utils/id';

/**
 * The public-intake persistence layer — see supabase/migrations/0004_intake_submissions.sql for the
 * schema and RLS this reads/writes. Every "anon" function here runs with NO signed-in user (the
 * public form page) and relies entirely on the migration's RLS policies for authorization — this
 * file adds no client-side security of its own, it just shapes the requests. Every "broker" function
 * runs with a signed-in session and is scoped to that broker's own rows by the same RLS.
 *
 * Fails soft with `{ ok: false, message }` everywhere, including when Supabase isn't configured —
 * never throws, so a caller (including the anonymous public form) always has a clean way to show
 * "couldn't submit" instead of a blank crash.
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'This isn’t available in this environment. See SUPABASE_SETUP.md.' };
const BUCKET = 'intake-uploads';

function fail(message: string): RepoResult<never> {
  return { ok: false, message };
}

interface IntakeLinkRow {
  id: string;
  user_id: string;
  label: string;
  token: string;
  active: boolean;
  created_at: string;
}

function rowToLink(row: IntakeLinkRow): IntakeLink {
  return { id: row.id, userId: row.user_id, label: row.label, token: row.token, active: row.active, createdAt: row.created_at };
}

interface IntakeSubmissionRow {
  id: string;
  intake_link_id: string;
  user_id: string;
  status: string;
  named_insured: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  dot_number: string | null;
  mc_number: string | null;
  years_in_business: number | null;
  power_units: number | null;
  driver_count: number | null;
  operation_type: string | null;
  commodities_hauled: string | null;
  operating_radius: string | null;
  operating_states: string | null;
  coverage_requested: string[] | null;
  current_carrier: string | null;
  effective_date: string | null;
  additional_notes: string | null;
  created_at: string;
  imported_at: string | null;
  imported_account_id: string | null;
}

function rowToSubmission(row: IntakeSubmissionRow): IntakeSubmission {
  return {
    id: row.id,
    intakeLinkId: row.intake_link_id,
    userId: row.user_id,
    status: row.status as IntakeSubmissionStatus,
    namedInsured: row.named_insured,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    dotNumber: row.dot_number,
    mcNumber: row.mc_number,
    yearsInBusiness: row.years_in_business,
    powerUnits: row.power_units,
    driverCount: row.driver_count,
    operationType: row.operation_type,
    commoditiesHauled: row.commodities_hauled,
    operatingRadius: row.operating_radius,
    operatingStates: row.operating_states,
    coverageRequested: (row.coverage_requested ?? []) as CoverageType[],
    currentCarrier: row.current_carrier,
    effectiveDate: row.effective_date,
    additionalNotes: row.additional_notes,
    createdAt: row.created_at,
    importedAt: row.imported_at,
    importedAccountId: row.imported_account_id,
  };
}

interface IntakeDocumentRow {
  id: string;
  intake_submission_id: string;
  user_id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
}

function rowToDocument(row: IntakeDocumentRow): IntakeDocument {
  return {
    id: row.id,
    intakeSubmissionId: row.intake_submission_id,
    userId: row.user_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Public (anonymous) — the intake form page
// ---------------------------------------------------------------------------------------------

/** Looks up a link by its token to validate it before rendering the form. Returns data: null (not an error) when the token doesn't exist — the caller shows "this link is invalid," not a generic error. */
export async function fetchIntakeLinkByToken(token: string): Promise<RepoResult<IntakeLink | null>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('intake_links').select('*').eq('token', token).maybeSingle();
    if (error) return fail(error.message);
    return { ok: true, data: data ? rowToLink(data as IntakeLinkRow) : null };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load this link.');
  }
}

export interface IntakeAnswers {
  namedInsured: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  dotNumber: string;
  mcNumber: string;
  yearsInBusiness: number | null;
  powerUnits: number | null;
  driverCount: number | null;
  operationType: string;
  commoditiesHauled: string;
  operatingRadius: string;
  operatingStates: string;
  coverageRequested: CoverageType[];
  currentCarrier: string;
  effectiveDate: string;
  additionalNotes: string;
}

/**
 * Inserts one submission and uploads its files, in that order — the submission row must exist
 * first, since intake_documents' RLS insert policy requires a matching pending intake_submissions
 * row (see the migration). `link` is the already-fetched, already-validated intake_links row; its
 * `userId` is what the anti-spoofing WITH CHECK cross-references, so it's forced onto the insert
 * here rather than left to whatever a tampered client might send.
 */
export async function submitIntake(link: IntakeLink, answers: IntakeAnswers, files: File[]): Promise<RepoResult<{ submissionId: string }>> {
  if (!supabase) return NOT_CONFIGURED;
  const submissionId = generateId('isub');
  try {
    const { error: insertErr } = await supabase.from('intake_submissions').insert({
      id: submissionId,
      intake_link_id: link.id,
      user_id: link.userId,
      status: 'pending',
      named_insured: answers.namedInsured || null,
      contact_name: answers.contactName || null,
      contact_email: answers.contactEmail || null,
      contact_phone: answers.contactPhone || null,
      dot_number: answers.dotNumber || null,
      mc_number: answers.mcNumber || null,
      years_in_business: answers.yearsInBusiness,
      power_units: answers.powerUnits,
      driver_count: answers.driverCount,
      operation_type: answers.operationType || null,
      commodities_hauled: answers.commoditiesHauled || null,
      operating_radius: answers.operatingRadius || null,
      operating_states: answers.operatingStates || null,
      coverage_requested: answers.coverageRequested,
      current_carrier: answers.currentCarrier || null,
      effective_date: answers.effectiveDate || null,
      additional_notes: answers.additionalNotes || null,
    });
    if (insertErr) return fail(insertErr.message);

    for (const file of files) {
      const documentId = generateId('idoc');
      const path = `${submissionId}/${documentId}/${file.name}`;
      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadErr) continue; // best-effort: one bad file shouldn't fail the whole submission the applicant already committed to
      await supabase.from('intake_documents').insert({
        id: documentId,
        intake_submission_id: submissionId,
        user_id: link.userId,
        file_name: file.name,
        storage_path: path,
        size_bytes: file.size,
      });
    }

    return { ok: true, data: { submissionId } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not submit this form.');
  }
}

// ---------------------------------------------------------------------------------------------
// Broker (authenticated) — creating/managing links and reviewing submissions
// ---------------------------------------------------------------------------------------------

/**
 * The link's own row id can use the app's normal generateId (never a secret, just a key) — but the
 * TOKEN embedded in the shareable URL is the actual access-control boundary (see the migration's
 * "anyone can read an intake link to validate it" policy): anyone who has it can open the form.
 * generateId is Math.random() + Date.now(), neither of which is meant to resist guessing, so the
 * token specifically gets a real cryptographically-random UUID instead.
 */
function generateIntakeToken(): string {
  return crypto.randomUUID();
}

export async function createIntakeLink(userId: string, label: string): Promise<RepoResult<IntakeLink>> {
  if (!supabase) return NOT_CONFIGURED;
  const link: IntakeLink = { id: generateId('ilink'), userId, label, token: generateIntakeToken(), active: true, createdAt: new Date().toISOString() };
  try {
    const { error } = await supabase.from('intake_links').insert({ id: link.id, user_id: userId, label, token: link.token, active: true, created_at: link.createdAt });
    if (error) return fail(error.message);
    return { ok: true, data: link };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not create this link.');
  }
}

export async function fetchIntakeLinks(userId: string): Promise<RepoResult<IntakeLink[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('intake_links').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) return fail(error.message);
    return { ok: true, data: ((data ?? []) as IntakeLinkRow[]).map(rowToLink) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load your intake links.');
  }
}

export async function setIntakeLinkActive(id: string, active: boolean): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.from('intake_links').update({ active }).eq('id', id);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function fetchIntakeSubmissions(userId: string): Promise<RepoResult<IntakeSubmission[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('intake_submissions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) return fail(error.message);
    return { ok: true, data: ((data ?? []) as IntakeSubmissionRow[]).map(rowToSubmission) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load intake submissions.');
  }
}

export async function fetchIntakeDocuments(intakeSubmissionId: string): Promise<RepoResult<IntakeDocument[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('intake_documents').select('*').eq('intake_submission_id', intakeSubmissionId).order('created_at', { ascending: true });
    if (error) return fail(error.message);
    return { ok: true, data: ((data ?? []) as IntakeDocumentRow[]).map(rowToDocument) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load this submission’s documents.');
  }
}

/** Downloads one intake document's bytes and wraps them back into a File — used only so the import flow can hand real File objects to the existing addFiles pipeline, exactly as if the broker had just uploaded them. */
export async function downloadIntakeDocumentFile(doc: IntakeDocument): Promise<RepoResult<File>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(doc.storagePath);
    if (error || !data) return fail(error?.message ?? 'Could not download this file.');
    return { ok: true, data: new File([data], doc.fileName, { type: data.type }) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not download this file.');
  }
}

export async function markIntakeSubmissionImported(id: string, accountId: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.from('intake_submissions').update({ status: 'imported', imported_at: new Date().toISOString(), imported_account_id: accountId }).eq('id', id);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function dismissIntakeSubmission(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.from('intake_submissions').update({ status: 'dismissed' }).eq('id', id);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
