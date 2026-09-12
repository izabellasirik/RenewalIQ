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
}

/**
 * The broker's one-click "Import" action — turns a pending intake_submissions row into a real
 * account using the exact same primitives any other submission uses: createAccountFromExtraction to
 * commit the applicant-provided profile, then addFiles for each uploaded document so the real
 * OCR/vision extraction pipeline runs on them exactly as if the broker had just uploaded them
 * directly. Adds no new account-creation or extraction logic of its own.
 */
export async function importIntakeSubmission(submission: IntakeSubmission): Promise<ImportResult> {
  const docsResult = await fetchIntakeDocuments(submission.id);
  if (!docsResult.ok) return { ok: false, message: docsResult.message };

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

  const { createAccountFromExtraction, addFiles } = useAccountsStore.getState();
  const accountId = createAccountFromExtraction(namedInsured, state, [], profile, undefined, {
    name: submission.contactName ?? undefined,
    email: submission.contactEmail ?? undefined,
    phone: submission.contactPhone ?? undefined,
  });

  if (files.length > 0) addFiles(accountId, files);

  const markResult = await markIntakeSubmissionImported(submission.id, accountId);
  if (!markResult.ok) return { ok: true, accountId, message: `Account created, but couldn't mark the intake submission as imported: ${markResult.message}` };

  return { ok: true, accountId };
}
