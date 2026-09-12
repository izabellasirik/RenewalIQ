import type { ExtractedFieldResult, IntakeSubmission } from '../../types';
import { createEmptyRiskProfile, mergeIntoRiskProfile } from '../extraction';
import { useAccountsStore } from '../../state/useAccountsStore';
import {
  fetchIntakeDocuments,
  downloadIntakeDocumentFile,
  fetchIntakeLinkById,
  claimIntakeSubmissionForImport,
  setImportedAccountId,
  revertIntakeSubmissionClaim,
} from '../supabase/intakeRepo';

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
  /** True when the reason this call didn't create an account is that the submission was already imported (by an earlier click, another tab, or another device) — the caller should refresh its list and show the existing imported state rather than treating this as a failure to report. */
  alreadyImported?: boolean;
}

/**
 * The broker's one-click "Import" action — turns a pending intake_submissions row into a real
 * account using the exact same primitives any other submission uses: createAccountFromExtraction to
 * commit the applicant-provided profile, then addFiles for each uploaded document so the real
 * OCR/vision extraction pipeline runs on them exactly as if the broker had just uploaded them
 * directly. Adds no new account-creation or extraction logic of its own.
 *
 * Claims the submission (an atomic, conditional status flip) BEFORE creating anything — see
 * claimIntakeSubmissionForImport's own comment. This is what makes a double-click, a second browser
 * tab, or a retried request safe: only the first caller to win the claim ever creates an account.
 */
export async function importIntakeSubmission(submission: IntakeSubmission): Promise<ImportResult> {
  const claim = await claimIntakeSubmissionForImport(submission.id);
  if (!claim.ok) return { ok: false, message: claim.message };
  if (!claim.data) {
    return { ok: false, alreadyImported: true, message: 'This submission was already imported.' };
  }

  const docsResult = await fetchIntakeDocuments(submission.id);
  if (!docsResult.ok) {
    // Nothing was created yet — put the claim back so this isn't stuck "imported" with no account
    // behind it, and the broker can just click Import again.
    await revertIntakeSubmissionClaim(submission.id);
    return { ok: false, message: docsResult.message };
  }

  const files: File[] = [];
  for (const doc of docsResult.data) {
    const fileResult = await downloadIntakeDocumentFile(doc);
    if (fileResult.ok) files.push(fileResult.data);
    // A single file that fails to download doesn't block the rest — the account is still created
    // from the applicant's typed answers and whatever documents did come through.
  }

  const profile = mergeIntoRiskProfile(createEmptyRiskProfile('pending'), buildApplicantFieldResults(submission));
  const namedInsured = submission.namedInsured?.trim() || 'Untitled Submission';
  const state = deriveDomicileState(submission.operatingStates);

  // The intake link's internal label (e.g. "ABC Agency") — never shown to the applicant, but the
  // whole reason this import must not silently lose it: it's how the broker tells their sources
  // apart afterward (see Account.intakeSourceLabel). A failed lookup here (deleted link, transient
  // error) still lets the import proceed — losing source attribution on one edge case is better
  // than blocking the import entirely.
  const linkResult = await fetchIntakeLinkById(submission.intakeLinkId);
  const sourceLabel = linkResult.ok ? (linkResult.data?.label ?? undefined) : undefined;

  const { createAccountFromExtraction, addFiles, syncAccountAndAwait, deleteAccountPermanently } = useAccountsStore.getState();
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
    sourceLabel
  );

  // Confirm the account's core data (submissions/field_values/field_alternates/coverage_lines/
  // vehicles/drivers/losses/activity_events — see saveSubmissionSnapshot) actually reached
  // Supabase BEFORE treating this import as real. Without this, an "authenticated" submission
  // could end up local-only after a failed cloud save with nothing but a small TopBar banner
  // (easy to miss) to show for it, while the intake row already reads "Imported" — the whole
  // "does not reliably save" bug report. A no-op success if this account isn't cloud-backed
  // (Supabase not configured / not signed in), same as syncNow elsewhere in the app.
  const syncResult = await syncAccountAndAwait(accountId);
  if (!syncResult.ok) {
    // The exact table/operation/code/message/details/hint is already logged in full by logAndFail
    // inside submissionsRepo.ts at the moment it happened — this just ties it to the import attempt
    // for anyone reading the console. The broker-facing message stays short and non-technical (see
    // TopBar.tsx's "Cloud save failed" banner for the same principle) — never the raw Postgres text.
    // eslint-disable-next-line no-console
    console.error(`[RenewalIQ intake import] Cloud save failed for intake submission ${submission.id}:`, syncResult.message);

    // Nothing durable exists yet — undo the local account and the claim so Import can just be
    // retried cleanly, instead of leaving an "Imported" row with a broken/local-only account
    // behind it, or risking a duplicate account on the next attempt.
    const deleteResult = await deleteAccountPermanently(accountId);
    await revertIntakeSubmissionClaim(submission.id);
    if (!deleteResult.ok) {
      // eslint-disable-next-line no-console
      console.error(`[RenewalIQ intake import] Cleanup after failed import also failed for account ${accountId}:`, deleteResult.message);
    }
    return {
      ok: false,
      message: "Couldn't save this submission to your account. Nothing was imported — please try again. (See the browser console for details.)",
    };
  }

  if (files.length > 0) addFiles(accountId, files);

  // The account is now confirmed durable, so the claim stands even if this last linking step
  // fails — reverting here would risk a second account being created on retry. The broker still
  // gets a clear signal that the link may not have saved.
  const linkAccountResult = await setImportedAccountId(submission.id, accountId);
  if (!linkAccountResult.ok) {
    // eslint-disable-next-line no-console
    console.error(`[RenewalIQ intake import] Couldn't record imported_account_id for intake submission ${submission.id}:`, linkAccountResult.message);
    return { ok: true, accountId, message: 'Account created, but the link back to this intake submission may not have saved. (See the browser console for details.)' };
  }

  return { ok: true, accountId };
}
