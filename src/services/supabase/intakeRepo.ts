import { supabase } from './client';
import type { CoverageType, IntakeDocument, IntakeEvent, IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../../types';
import { errorMessage, errorStatus, isTransientError, withRetry, withTimeout } from '../intake/retry';
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

const NOT_CONFIGURED_MESSAGE = 'This isn’t available in this environment. See SUPABASE_SETUP.md.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: NOT_CONFIGURED_MESSAGE };
const BUCKET = 'intake-uploads';

function fail(message: string): RepoResult<never> {
  return { ok: false, message };
}

interface IntakeLinkRow {
  id: string;
  user_id: string;
  label: string;
  /** Absent until 0013 is applied. */
  organization_name?: string | null;
  token: string;
  active: boolean;
  created_at: string;
}

function rowToLink(row: IntakeLinkRow): IntakeLink {
  return { id: row.id, userId: row.user_id, label: row.label, organizationName: row.organization_name ?? null, token: row.token, active: row.active, createdAt: row.created_at };
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
  reference?: string | null;
  expected_files?: number | null;
  completed_at?: string | null;
  last_activity_at?: string | null;
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
    reference: row.reference ?? null,
    expectedFiles: row.expected_files ?? null,
    completedAt: row.completed_at ?? null,
    lastActivityAt: row.last_activity_at ?? null,
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

/** Storage rejects some characters in object names (accents, emoji, #, ?, …) — the stored path uses a safe version; the original name is kept in file_name. */
export function storageSafeName(name: string): string {
  const safe = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._ ()-]+/g, '_').replace(/\s+/g, ' ').trim();
  return safe || 'file';
}

// ---------------------------------------------------------------------------------------------
// Verified submission (0029): start → upload + attach each file → finalize (server verifies)
// ---------------------------------------------------------------------------------------------

/** This browser's handle on its submission — the random client token proves it's the same sender. */
export interface IntakeSession {
  submissionId: string;
  reference: string;
  clientToken: string;
}

/** 0029 isn't applied yet (the functions don't exist) — the form falls back to the old way of sending. */
export class IntakeNotUpgradedError extends Error {
  constructor() {
    super('Verified intake needs migration 0029_intake_reliability.sql.');
    this.name = 'IntakeNotUpgradedError';
  }
}

function rpcError(error: { message: string; code?: string; status?: number }): Error {
  if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message)) return new IntakeNotUpgradedError();
  return Object.assign(new Error(error.message), { code: error.code, status: (error as { status?: number }).status });
}

const RPC_TIMEOUT_MS = 30_000;

/**
 * Creates the submission (or returns the one this browser already started — same client token), with
 * the answers saved on the server. Retries temporary failures; a retried request can't make a duplicate.
 */
export async function startIntakeSubmission(linkToken: string, clientToken: string, answers: IntakeAnswers, expectedFiles: number): Promise<IntakeSession> {
  if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
  return withRetry(async () => {
    const { data, error } = await withTimeout(
      Promise.resolve(supabase!.rpc('start_intake_submission', { p_link_token: linkToken, p_client_token: clientToken, p_answers: answers, p_expected_files: expectedFiles })),
      RPC_TIMEOUT_MS,
      'Starting the submission'
    );
    if (error) throw rpcError(error);
    const row = (Array.isArray(data) ? data[0] : data) as { submission_id: string; reference: string; status: string } | undefined;
    if (!row?.submission_id) throw new Error('The server did not confirm the submission.');
    return { submissionId: row.submission_id, reference: row.reference, clientToken };
  });
}

/** Where a file goes in storage: the submission's folder, the file's own key, then its name. Stable across retries. */
export function intakeFilePath(submissionId: string, fileKey: string, fileName: string): string {
  return `${submissionId}/${fileKey}/${storageSafeName(fileName)}`;
}

const isAlreadyThere = (error: unknown) => errorStatus(error) === 409 || /already exists|duplicate/i.test(errorMessage(error));

/**
 * Uploads one file and links it to the submission, retrying temporary failures (1s, 2s, 4s…). Always
 * the same path, so a retry after an upload whose answer was lost finds the file already there
 * instead of leaving an unlinked copy; the server then checks the file really is in storage before
 * linking it. Throws with a readable reason once it gives up.
 */
export async function uploadIntakeFile(session: IntakeSession, fileKey: string, file: File, onRetry?: (attempt: number, reason: string) => void): Promise<void> {
  if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
  const path = intakeFilePath(session.submissionId, fileKey, file.name);
  // Generous for a slow phone connection: a minute plus ~50 KB/s.
  const timeout = 60_000 + Math.ceil(file.size / 50_000) * 1000;
  await withRetry(
    async () => {
      const up = await withTimeout(Promise.resolve(supabase!.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })), timeout, `Uploading ${file.name}`);
      if (up.error && !isAlreadyThere(up.error)) {
        if (errorStatus(up.error) === 413 || /too large|exceeded the maximum/i.test(up.error.message)) throw Object.assign(new Error(`${file.name} is too large to upload.`), { status: 413 });
        throw up.error;
      }
      const { error } = await withTimeout(
        Promise.resolve(
          supabase!.rpc('attach_intake_document', {
            p_submission_id: session.submissionId,
            p_client_token: session.clientToken,
            p_file_key: fileKey,
            p_file_name: file.name,
            p_storage_path: path,
            p_size: file.size,
          })
        ),
        RPC_TIMEOUT_MS,
        `Confirming ${file.name}`
      );
      if (error) {
        // Not in storage after an "uploaded" answer: worth another try; anything else is final.
        if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 503 });
        throw rpcError(error);
      }
    },
    { onRetry: (attempt, err) => onRetry?.(attempt, errorMessage(err)) }
  );
}

export type FinalizeResult = { ok: true; reference: string; files: number } | { ok: false; missing: string[]; problems: string[] };

/** Asks the server to verify everything (answers + every file linked and in storage) and complete the submission. */
export async function finalizeIntakeSubmission(session: IntakeSession, fileKeys: string[]): Promise<FinalizeResult> {
  if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE);
  return withRetry(async () => {
    const { data, error } = await withTimeout(
      Promise.resolve(supabase!.rpc('finalize_intake_submission', { p_submission_id: session.submissionId, p_client_token: session.clientToken, p_file_keys: fileKeys })),
      RPC_TIMEOUT_MS,
      'Verifying the submission'
    );
    if (error) throw rpcError(error);
    const r = data as { ok: boolean; reference?: string; files?: number; missing?: string[]; problems?: string[] };
    return r.ok ? { ok: true, reference: r.reference ?? session.reference, files: r.files ?? fileKeys.length } : { ok: false, missing: r.missing ?? [], problems: r.problems ?? [] };
  });
}

/** Best effort — an audit entry never blocks or fails the submission itself. */
export async function logIntakeEvent(session: IntakeSession, event: 'file_failed' | 'file_retry' | 'file_removed', detail: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('log_intake_event', { p_submission_id: session.submissionId, p_client_token: session.clientToken, p_event: event, p_detail: detail });
  } catch {
    // audit only
  }
}

export { isTransientError };

/**
 * BEFORE 0029 — kept only as the fallback while the migration isn't applied.
 * Inserts one submission and uploads its files, in that order — the submission row must exist
 * first, since intake_documents' RLS insert policy requires a matching pending intake_submissions
 * row (see the migration). `link` is the already-fetched, already-validated intake_links row; its
 * `userId` is what the anti-spoofing WITH CHECK cross-references, so it's forced onto the insert
 * here rather than left to whatever a tampered client might send.
 */
/** `onProgress(done, total)` is called as each file finishes (uploaded or given up on). */
export async function submitIntake(link: IntakeLink, answers: IntakeAnswers, files: File[], onProgress?: (done: number, total: number) => void): Promise<RepoResult<{ submissionId: string; failedFiles: string[] }>> {
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

    // Each file: upload, then record it — retried once. One bad file doesn't fail the submission the
    // applicant already sent, but it's reported back so they know to send it another way.
    const failedFiles: string[] = [];
    let done = 0;
    onProgress?.(0, files.length);
    for (const file of files) {
      let attached = false;
      for (let attempt = 0; attempt < 2 && !attached; attempt++) {
        const documentId = generateId('idoc');
        const path = `${submissionId}/${documentId}/${storageSafeName(file.name)}`;
        const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file);
        if (uploadErr) continue;
        const { error: rowErr } = await supabase.from('intake_documents').insert({
          id: documentId,
          intake_submission_id: submissionId,
          user_id: link.userId,
          file_name: file.name,
          storage_path: path,
          size_bytes: file.size,
        });
        attached = !rowErr;
      }
      if (!attached) failedFiles.push(file.name);
      onProgress?.(++done, files.length);
    }

    return { ok: true, data: { submissionId, failedFiles } };
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

/** `organizationName` is what the person filling in the form sees; null falls back to "your insurance broker". */
export async function createIntakeLink(userId: string, label: string, organizationName: string | null): Promise<RepoResult<IntakeLink>> {
  if (!supabase) return NOT_CONFIGURED;
  const link: IntakeLink = { id: generateId('ilink'), userId, label, organizationName, token: generateIntakeToken(), active: true, createdAt: new Date().toISOString() };
  try {
    const row: Record<string, unknown> = { id: link.id, user_id: userId, label, token: link.token, active: true, created_at: link.createdAt };
    let { error } = await supabase.from('intake_links').insert(organizationName ? { ...row, organization_name: organizationName } : row);
    // Migration 0013 not applied yet: still create the link, just without the agency name.
    if (error && organizationName && (error.code === 'PGRST204' || error.code === '42703' || error.message.includes('organization_name'))) {
      ({ error } = await supabase.from('intake_links').insert(row));
      if (!error) link.organizationName = null;
    }
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

const isMissingFunction = (e: { code?: string; message: string }) => e.code === 'PGRST202' || e.code === '42883' || /could not find the function|schema cache/i.test(e.message);

/**
 * The links this broker manages: their own — and, for an agency admin, every member's (0036), with
 * whose link it is and how many submissions are still open. Before 0036: their own, as before.
 */
export async function fetchManageableIntakeLinks(userId: string): Promise<RepoResult<IntakeLink[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('list_manageable_intake_links');
    if (error && isMissingFunction(error)) return fetchIntakeLinks(userId);
    if (error) return fail(error.message);
    return {
      ok: true,
      data: ((data ?? []) as (IntakeLinkRow & { owner_name: string | null; open_submissions: number; total_submissions: number })[]).map((r) => ({
        ...rowToLink(r),
        ownerName: r.owner_name ?? undefined,
        openSubmissions: r.open_submissions,
        totalSubmissions: r.total_submissions,
      })),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load your intake links.');
  }
}

export async function setIntakeLinkActive(id: string, active: boolean): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  // 0036: checked server-side (the creator, or an admin of their agency).
  let { error } = await supabase.rpc('set_intake_link_active', { p_id: id, p_active: active });
  if (error && isMissingFunction(error)) ({ error } = await supabase.from('intake_links').update({ active }).eq('id', id));
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

/** Deletes a link (0036) — refused while submissions through it are still open. */
export async function deleteIntakeLink(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('delete_intake_link', { p_id: id });
  if (error && isMissingFunction(error)) return fail('Deleting links needs the latest database update (migration 0036).');
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

// ---------------------------------------------------------------------------------------------
// Broker — submission history (0029)
// ---------------------------------------------------------------------------------------------

/** Marks the broker's submissions that stopped mid-send (2 hours without activity) as incomplete. No-op before 0029. */
export async function markStaleIntakeSubmissions(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('mark_stale_intake_submissions');
  } catch {
    // best effort
  }
}

/** A submission's history, oldest first. Empty before 0029. */
export async function fetchIntakeEvents(intakeSubmissionId: string): Promise<RepoResult<IntakeEvent[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('intake_events').select('id, event, detail, created_at').eq('intake_submission_id', intakeSubmissionId).order('id', { ascending: true });
  if (error) return error.code === '42P01' || error.code === 'PGRST205' ? { ok: true, data: [] } : fail(error.message);
  return { ok: true, data: (data ?? []).map((r) => ({ id: r.id as number, event: r.event as IntakeEvent['event'], detail: (r.detail ?? {}) as Record<string, unknown>, createdAt: r.created_at as string })) };
}
