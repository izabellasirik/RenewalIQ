import type { ExtractedFieldResult, IntakeSubmission } from '../../types';
import { createEmptyRiskProfile, mergeIntoRiskProfile } from '../extraction';
import { useAccountsStore } from '../../state/useAccountsStore';
import { fetchIntakeDocuments, downloadIntakeDocumentFile, markIntakeSubmissionImported } from '../supabase/intakeRepo';

function splitList(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * First entry of the applicant's stated operating states, used as a starting value for the
 * account's single domicile-state field (Account.state / business.state) — the intake form doesn't
 * ask a separate "what state are you domiciled in" question (see the field list in
 * IntakeFormPage.tsx), so this is a reasonable default the broker can correct in the Risk Profile
 * exactly like any other extracted value, never invented beyond what the applicant actually typed.
 */
function deriveDomicileState(operatingStates: string | null): string {
  const first = splitList(operatingStates)[0] ?? '';
  return first.length === 2 ? first.toUpperCase() : first;
}

/**
 * Builds one ExtractedFieldResult per non-empty applicant answer, tagged
 * extractionMethod: 'applicant_provided' — these merge into the Risk Profile through the exact same
 * mergeIntoRiskProfile/mergeFieldValue pipeline any document's results do, so a document extraction
 * that later disagrees with what the applicant typed produces a genuine, visible conflict rather
 * than a silent overwrite (see utils/dataStatus.ts's fieldDataStatus). Deliberately does NOT touch
 * currentCarrier/additionalNotes/operationType — none of those has a corresponding Risk Profile
 * field, so they stay as intake-submission-only reference data shown to the broker during import
 * (see IntakeLinksPage.tsx) instead of being forced into a field that doesn't fit them.
 */
function buildApplicantFieldResults(submission: IntakeSubmission): ExtractedFieldResult[] {
  const source = { documentId: `intake:${submission.id}`, documentName: 'Intake form submission' };
  const results: ExtractedFieldResult[] = [];

  function push(fieldPath: string, value: unknown) {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    results.push({ fieldPath, value, confidence: 'high', source, extractionMethod: 'applicant_provided' });
  }

  push('business.namedInsured', submission.namedInsured);
  push('business.yearsInBusiness', submission.yearsInBusiness);
  push('business.effectiveDate', submission.effectiveDate);
  push('business.state', deriveDomicileState(submission.operatingStates) || null);
  push('transportation.dotNumber', submission.dotNumber);
  push('transportation.mcNumber', submission.mcNumber);
  push('transportation.fleetSize', submission.powerUnits);
  push('transportation.driverCount', submission.driverCount);
  push('transportation.commoditiesHauled', splitList(submission.commoditiesHauled));
  push('transportation.operatingRadius', submission.operatingRadius);
  push('transportation.statesOfOperation', splitList(submission.operatingStates));
  for (const type of submission.coverageRequested) push('coverageLine', type);

  return results;
}

export interface ImportResult {
  ok: boolean;
  accountId?: string;
  message?: string;
  /** Imported, but something needs the broker's attention (e.g. a file that couldn't be downloaded). */
  warning?: string;
}

/**
 * The broker's "Import" action — turns a pending intake_submissions row into a real
 * account using the exact same primitives any other submission uses: createAccountFromExtraction to
 * commit the applicant-provided profile, then addFiles for each uploaded document so the real
 * OCR/vision extraction pipeline runs on them exactly as if the broker had just uploaded them
 * directly. Adds no new account-creation or extraction logic of its own.
 */
/** Waits until each document's file has reached the account's cloud storage (it gets a storagePath), or the time is up. Returns the names still not there. */
async function waitForUploads(accountId: string, documentIds: string[], timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const docs = useAccountsStore.getState().documents[accountId] ?? [];
    const pending = documentIds.map((id) => docs.find((d) => d.id === id)).filter((d) => !d || !d.storagePath);
    if (pending.length === 0) return [];
    if (Date.now() > deadline) return pending.map((d) => d?.name ?? 'a document');
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function importIntakeSubmission(submission: IntakeSubmission): Promise<ImportResult> {
  // Still being sent: its remaining files would be refused after an import and lost (the database refuses it too).
  if (submission.status === 'uploading') return { ok: false, message: 'The client is still sending this submission — it can be imported once they finish.' };
  const docsResult = await fetchIntakeDocuments(submission.id);
  if (!docsResult.ok) return { ok: false, message: docsResult.message };

  const files: File[] = [];
  const missing: string[] = [];
  for (const doc of docsResult.data) {
    // One retry — a dropped connection shouldn't lose a document.
    let fileResult = await downloadIntakeDocumentFile(doc);
    if (!fileResult.ok) fileResult = await downloadIntakeDocumentFile(doc);
    if (fileResult.ok) files.push(fileResult.data);
    else missing.push(doc.fileName);
    // A single file that fails to download doesn't block the rest — the account is still created
    // from the applicant's typed answers and whatever documents did come through — but it's reported.
  }

  const profile = mergeIntoRiskProfile(createEmptyRiskProfile('pending'), buildApplicantFieldResults(submission));
  const namedInsured = submission.namedInsured?.trim() || 'Untitled Submission';
  const state = deriveDomicileState(submission.operatingStates);

  const { createAccountFromExtraction, addFiles, saveAccountNow, deleteAccountPermanently } = useAccountsStore.getState();
  const accountId = createAccountFromExtraction(
    namedInsured,
    state,
    [],
    profile,
    undefined,
    {
      name: submission.contactName ?? undefined,
      email: submission.contactEmail ?? undefined,
      phone: submission.contactPhone ?? undefined,
    },
    // Saved (and awaited) just below instead — two overlapping saves would race.
    { skipAutoSync: true }
  );

  // The submission is only marked imported once the account and its Risk Profile are actually in
  // the cloud. If that save fails, the new account is removed again and the submission stays
  // pending, so the broker can simply retry — never an "Imported" row with nothing behind it.
  const saved = await saveAccountNow(accountId);
  if (!saved.ok) {
    // Files are only added after a successful save, so there's nothing in Storage to clean up.
    await deleteAccountPermanently(accountId, { rollbackUnsavedImport: true });
    return { ok: false, message: `Couldn't save this submission to your account, so nothing was imported — please try again.${saved.message ? ` (${saved.message})` : ''}` };
  }

  // An admin importing a teammate's submission: the account belongs to the broker whose link it came through.
  let assignWarning: string | null = null;
  const { currentUserId, assignAccountToAgent } = useAccountsStore.getState();
  if (submission.userId && currentUserId && submission.userId !== currentUserId) {
    const assigned = await assignAccountToAgent(accountId, submission.userId);
    if (!assigned.ok) assignWarning = `The account was created but couldn't be assigned to the submission's broker: ${assigned.message}`;
  }

  // Marked imported only once the documents are in the account's cloud storage (the originals stay in
  // intake storage either way, so a slow upload is never a lost file).
  const notYetUploaded = files.length > 0 ? await waitForUploads(accountId, addFiles(accountId, files), 120_000) : [];

  const markResult = await markIntakeSubmissionImported(submission.id, accountId);
  const warnings = [
    notYetUploaded.length > 0
      ? `${notYetUploaded.length} document${notYetUploaded.length === 1 ? ' is' : 's are'} still uploading to the account (${notYetUploaded.join(', ')}) — keep this tab open for a moment; the originals stay in the submission, so Reimport is always possible.`
      : null,
    missing.length > 0 ? `${missing.length} document${missing.length === 1 ? '' : 's'} couldn't be downloaded (${missing.join(', ')}) — use Reimport, or download ${missing.length === 1 ? 'it' : 'them'} here and upload to the account.` : null,
    markResult.ok ? null : `The account was created, but the submission couldn't be marked imported: ${markResult.message}`,
    assignWarning,
  ].filter(Boolean);
  return { ok: true, accountId, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
}

/** Downloads a submission's files (one retry each). */
async function downloadSubmissionFiles(submissionId: string): Promise<{ ok: false; message: string } | { ok: true; files: File[]; missing: string[] }> {
  const docsResult = await fetchIntakeDocuments(submissionId);
  if (!docsResult.ok) return { ok: false, message: docsResult.message };
  const files: File[] = [];
  const missing: string[] = [];
  for (const doc of docsResult.data) {
    let fileResult = await downloadIntakeDocumentFile(doc);
    if (!fileResult.ok) fileResult = await downloadIntakeDocumentFile(doc);
    if (fileResult.ok) files.push(fileResult.data);
    else missing.push(doc.fileName);
  }
  return { ok: true, files, missing };
}

/**
 * "Add submission to existing account" — the broker decided a new submission is the same business as
 * an account they already have. Its files go into that account through the normal upload pipeline
 * (read, validated, and applied or sent to review exactly like any upload — nothing the client typed
 * overwrites the account's data); the client's contact is added if the account doesn't have them yet;
 * the submission is marked imported into that account. Nothing is merged automatically.
 */
export async function addIntakeSubmissionToAccount(submission: IntakeSubmission, accountId: string): Promise<ImportResult> {
  if (submission.status === 'uploading') return { ok: false, message: 'The client is still sending this submission — it can be added once they finish.' };
  let store = useAccountsStore.getState();
  if (!store.accounts.some((a) => a.id === accountId)) {
    await store.hydrateCloudSubmissions();
    store = useAccountsStore.getState();
  }
  const account = store.accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, message: "You don't have access to that account — ask its broker or an admin, or create a new account." };

  const downloaded = await downloadSubmissionFiles(submission.id);
  if (!downloaded.ok) return { ok: false, message: downloaded.message };

  const email = submission.contactEmail?.trim().toLowerCase();
  const known = (account.contacts ?? []).some((c) => (email && c.email?.trim().toLowerCase() === email) || (!email && c.name === submission.contactName));
  if (!known && (submission.contactName || submission.contactEmail || submission.contactPhone)) {
    store.addContact(accountId, { name: submission.contactName ?? submission.contactEmail ?? 'Client', email: submission.contactEmail ?? undefined, phone: submission.contactPhone ?? undefined });
  }

  const notYetUploaded = downloaded.files.length > 0 ? await waitForUploads(accountId, store.addFiles(accountId, downloaded.files), 120_000) : [];
  const markResult = await markIntakeSubmissionImported(submission.id, accountId);
  const warnings = [
    notYetUploaded.length > 0 ? `${notYetUploaded.length} document${notYetUploaded.length === 1 ? ' is' : 's are'} still uploading to the account (${notYetUploaded.join(', ')}) — keep this tab open for a moment.` : null,
    downloaded.missing.length > 0 ? `${downloaded.missing.length} document${downloaded.missing.length === 1 ? '' : 's'} couldn't be downloaded (${downloaded.missing.join(', ')}).` : null,
    markResult.ok ? null : `The files were added, but the submission couldn't be marked imported: ${markResult.message}`,
  ].filter(Boolean);
  return { ok: true, accountId, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
}
