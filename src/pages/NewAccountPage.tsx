import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, Clock, Loader2, Sparkles, TriangleAlert, UploadCloud } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Dropzone } from '../components/upload/Dropzone';
import { IdentityResolutionStep, type IdentitySuggestion } from '../components/newSubmission/IdentityResolutionStep';
import { Button, Card, CardBody } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { sampleAccount } from '../data/sampleAccounts';
import { createEmptyRiskProfile, mergeIntoRiskProfile, applyManualEdit } from '../services/extraction';
import { generateId } from '../utils/id';
import { inferCategory, inferCategoryFromResults, inferCategoryFromText, inferFileType } from '../utils/documents';
import { US_STATES } from '../utils/usStates';
import type { RiskProfile, UploadedDocument } from '../types';
import { DocumentLinkError } from '../services/ingestion/documentLinks';
import { NewAccountTypeFields } from '../components/renewals/NewAccountTypeFields';
import { EMPTY_ACCOUNT_DETAILS, NewAccountDetailsFields, readAccountDetails, type NewAccountDetailsValue } from '../components/newSubmission/NewAccountDetailsFields';
import { useReferralSources } from '../hooks/useReferralSources';
import { EMPTY_ACCOUNT_TYPE, readAccountType, type NewAccountTypeValue } from '../components/renewals/renewalForm';
import { normalizeDateKey } from '../services/workflow/dates';
import { DuplicateAccountWarning } from '../components/newSubmission/DuplicateAccountWarning';
import { localAccountCandidates, runDuplicateCheck, unseenMatches, type AccountIdentity, type DuplicateCheckResult } from '../services/accounts/duplicateCheck';
import { fetchAccountDuplicates } from '../services/supabase/intakeRepo';
import { isSupabaseConfigured } from '../services/supabase/client';

type Mode = 'choice' | 'manual' | 'processing' | 'confirm' | 'error';
type DraftDoc = Omit<UploadedDocument, 'accountId'>;

/** The files being read into the new submission, each with where it's at. */
function FileQueue({ items }: { items: { key: string; name: string; status: 'waiting' | 'reading' | 'done' | 'failed' }[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid="file-queue">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-2" data-status={i.status}>
          {i.status === 'reading' ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-[var(--color-brand-700)]" />
          ) : i.status === 'done' ? (
            <CircleCheck size={14} className="shrink-0 text-[var(--color-success-600)]" />
          ) : i.status === 'failed' ? (
            <TriangleAlert size={14} className="shrink-0 text-[var(--color-warning-600)]" />
          ) : (
            <Clock size={14} className="shrink-0 text-[var(--color-ink-400)]" />
          )}
          <span className="min-w-0 text-[var(--color-ink-700)] [overflow-wrap:anywhere]">{i.name}</span>
          <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-400)]">
            {i.status === 'reading' ? 'Reading…' : i.status === 'done' ? 'Read' : i.status === 'failed' ? 'Couldn’t read' : 'Waiting'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Name and state the documents suggest but that weren't applied on their own (held for review), and
 * — for the state — the state on a driver's license, which is the driver's, not necessarily the
 * business's. Offered with where they're from; the broker decides.
 */
function identitySuggestions(docs: DraftDoc[], profile: RiskProfile): { nameSuggestions: IdentitySuggestion[]; stateSuggestions: IdentitySuggestion[] } {
  const nameSuggestions: IdentitySuggestion[] = [];
  const stateSuggestions: IdentitySuggestion[] = [];
  for (const d of docs) {
    for (const c of d.reviewCandidates ?? []) {
      if (c.fieldPath === 'business.namedInsured' && typeof c.value === 'string') nameSuggestions.push({ value: c.value, note: `${d.name} — ${c.reason}` });
      if (c.fieldPath === 'business.state' && typeof c.value === 'string') stateSuggestions.push({ value: c.value, note: `${d.name} — ${c.reason}` });
      const drv = c.fieldPath === 'drivers' ? (c.value as { licenseState?: string; name?: string }) : null;
      if (drv?.licenseState) stateSuggestions.push({ value: drv.licenseState, note: `${d.name} — the driver’s license state${drv.name ? ` (${drv.name})` : ''}` });
    }
  }
  for (const drv of profile.drivers) {
    if (drv.licenseState) stateSuggestions.push({ value: drv.licenseState, note: `${drv.source?.documentName ?? 'A document'} — the driver’s license state${drv.name ? ` (${drv.name})` : ''}` });
  }
  return { nameSuggestions, stateSuggestions };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function NewAccountPage() {
  const navigate = useNavigate();
  const createAccount = useAccountsStore((s) => s.createAccount);
  const createAccountFromExtraction = useAccountsStore((s) => s.createAccountFromExtraction);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);

  const [mode, setMode] = useState<Mode>('choice');
  const [phase, setPhase] = useState('');
  const [draftProfile, setDraftProfile] = useState<RiskProfile | null>(null);
  const [draftDocs, setDraftDocs] = useState<DraftDoc[]>([]);
  const [failures, setFailures] = useState<{ name: string; message: string }[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [namedInsuredInput, setNamedInsuredInput] = useState('');
  const [stateInput, setStateInput] = useState('');
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  // New venture or renewal (and a renewal's date) — asked on both ways of creating an account.
  const [accountType, setAccountType] = useState<NewAccountTypeValue>(EMPTY_ACCOUNT_TYPE);
  const [typeTouched, setTypeTouched] = useState(false);
  const setup = readAccountType(accountType);
  // Referral source, status and a first note — required on every new submission.
  const [detailsInput, setDetailsInput] = useState<NewAccountDetailsValue>(EMPTY_ACCOUNT_DETAILS);
  const referralSources = useReferralSources();
  const details = readAccountDetails(detailsInput, referralSources);
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const applyNewAccountDetails = useAccountsStore((s) => s.applyNewAccountDetails);

  // Possible existing accounts (0072): checked as the name is typed, and again right before an account is saved.
  const accounts = useAccountsStore((s) => s.accounts);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const memberEmail = (userId: string) => agencyMembers.find((m) => m.userId === userId)?.email ?? null;
  const checkDuplicates = (identity: AccountIdentity) =>
    runDuplicateCheck(identity, {
      remote: isSupabaseConfigured && currentUserId ? () => fetchAccountDuplicates(identity) : undefined,
      local: localAccountCandidates(accounts, riskProfiles),
    });
  type Gate = { identity: AccountIdentity; status: 'checking' | 'review' | 'failed'; result?: DuplicateCheckResult; message?: string; proceed: () => void };
  const [gate, setGate] = useState<Gate | null>(null);
  const [preview, setPreview] = useState<{ identity: AccountIdentity; result: DuplicateCheckResult } | null>(null);

  /**
   * Saves through the duplicate check: no possible match (and every account compared) → saved; otherwise the
   * broker sees the matches and chooses. "Create separate account" checks once more and asks again only if
   * something new turned up. A failed check is shown with Retry — never taken as "no duplicates".
   */
  async function guardedCreate(identity: AccountIdentity, proceed: () => void, shown?: DuplicateCheckResult) {
    setGate({ identity, status: 'checking', result: shown, proceed });
    const r = await checkDuplicates(identity);
    // A review happens on the confirm step when the account comes from documents (their draft is kept).
    const hold = () => setMode((m) => (m === 'processing' ? 'confirm' : m));
    if (!r.ok) {
      setGate({ identity, status: 'failed', message: r.message, proceed });
      hold();
      return;
    }
    const fresh = shown ? unseenMatches(shown.matches, r.result.matches) : r.result.matches;
    if (fresh.length === 0 && (shown || r.result.complete)) {
      setGate(null);
      proceed();
      return;
    }
    setGate({ identity, status: 'review', result: r.result, proceed });
    hold();
  }

  useEffect(() => {
    const name = namedInsuredInput.trim();
    if (mode !== 'manual' || name.length < 3) return setPreview(null);
    let current = true;
    const t = setTimeout(() => {
      void checkDuplicates({ name }).then((r) => {
        if (current) setPreview(r.ok && r.result.matches.length ? { identity: { name }, result: r.result } : null);
      });
    }, 500);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [namedInsuredInput, mode]);

  function finalizeAccount(namedInsured: string, state: string, docs: DraftDoc[], profile: RiskProfile, files: File[]) {
    const identity = { name: namedInsured, dotNumber: profile.transportation.dotNumber.value ?? null, mcNumber: profile.transportation.mcNumber.value ?? null };
    void guardedCreate(identity, () => {
      try {
        commitAccount(namedInsured, state, docs, profile, files);
      } catch (err) {
        console.error('New submission failed', err);
        setFatalError(err instanceof Error ? err.message : String(err));
        setMode('error');
      }
    });
  }

  function commitAccount(namedInsured: string, state: string, docs: DraftDoc[], profile: RiskProfile, files: File[]) {
    const id = createAccountFromExtraction(namedInsured, state, docs, profile, files, undefined, setup ? { setup } : undefined);
    if (detailsRef.current) applyNewAccountDetails(id, detailsRef.current);
    // Straight to the Risk Profile to review what was extracted.
    navigate(`/accounts/${id}/risk-profile`);
  }

  // Files are read one after another from a queue; more can be added at any time (while others
  // are still being read, or at the confirm step) and are read into the same new submission.
  const queue = useRef<File[]>([]);
  const running = useRef(false);
  const draft = useRef<{ profile: RiskProfile; docs: DraftDoc[]; files: File[]; failures: { name: string; message: string }[] } | null>(null);
  const [items, setItems] = useState<{ key: string; name: string; status: 'waiting' | 'reading' | 'done' | 'failed' }[]>([]);
  const markItem = (key: string, status: 'reading' | 'done' | 'failed') => setItems((all) => all.map((i) => (i.key === key ? { ...i, status } : i)));
  const keys = useRef(new WeakMap<File, string>());

  function startOver() {
    setGate(null);
    queue.current = [];
    draft.current = null;
    setItems([]);
    setDraftDocs([]);
    setDraftProfile(null);
    setDraftFiles([]);
    setFailures([]);
    setAccountType(EMPTY_ACCOUNT_TYPE);
    setTypeTouched(false);
    setMode('choice');
  }

  // Anything unexpected ends on a message with a way back — never on a spinner that never stops.
  function handleFiles(files: File[]) {
    if (!files.length) return;
    for (const f of files) keys.current.set(f, generateId('q'));
    queue.current.push(...files);
    setItems((all) => [...all, ...files.map((f) => ({ key: keys.current.get(f)!, name: f.name, status: 'waiting' as const }))]);
    if (running.current) return;
    running.current = true;
    processQueue()
      .catch((err) => {
        console.error('New submission failed', err);
        setFatalError(err instanceof Error ? err.message : String(err));
        setMode('error');
      })
      .finally(() => {
        running.current = false;
      });
  }

  async function processQueue() {
    setMode('processing');
    setPhase('Reading files…');
    const { readDocumentFile } = await import('../services/ingestion/readDocument');
    if (!draft.current) draft.current = { profile: createEmptyRiskProfile('pending'), docs: [], files: [], failures: [] };
    const d = draft.current;

    let file: File | undefined;
    while ((file = queue.current.shift())) {
      const key = keys.current.get(file) ?? '';
      markItem(key, 'reading');
      const docId = generateId('doc');
      const fileType = inferFileType(file.name);
      const isImageSource = fileType === 'image';
      const base = {
        id: docId,
        name: file.name,
        fileType,
        category: inferCategory(file.name),
        uploadedAt: new Date().toISOString(),
        sizeBytes: file.size,
      };
      setPhase(isImageSource ? `Reading image ${file.name}…` : `Reading ${file.name}…`);
      try {
        // The same reader as every other upload (native text → AI → OCR fallback held for review),
        // and the same gate: only validated values go into the new account.
        const read = await readDocumentFile(file, docId, file.name, useAccountsStore.getState().currentUserId);
        const { raw, classification } = read;
        const results = read.results;
        const gate = { review: read.review, rejected: read.rejectedCount, classification };
        // Nothing read at all (no text, no AI reading) alongside a warning — surface that as a
        // failure rather than a quietly-successful "0 fields extracted".
        if (raw.text.trim().length === 0 && raw.warnings.length > 0 && results.length === 0 && read.review.length === 0) {
          d.failures.push({ name: file.name, message: raw.warnings.join(' ') });
          d.docs.push({ ...base, status: 'error', warnings: raw.warnings, previewDataUrl: raw.imagePreviewDataUrl });
          d.files.push(file);
          markItem(key, 'failed');
          continue;
        }
        d.profile = mergeIntoRiskProfile(d.profile, results);
        // A link was downloaded: keep the real document for preview/upload, not the shortcut.
        d.files.push(raw.linkedFile ?? file);
        const contentCategory =
          read.documentCategory ?? (isImageSource && raw.text ? inferCategoryFromText(raw.text) : base.category === 'other' ? inferCategoryFromResults(results) : null);
        d.docs.push({
          ...base,
          category: contentCategory ?? base.category,
          status: 'processed',
          fieldsExtracted: results.length,
          extractedFields: results.map((r) => ({ fieldPath: r.fieldPath, value: r.value, confidence: r.confidence, extractionMethod: r.extractionMethod })),
          ...(gate.review.length ? { reviewCandidates: gate.review } : {}),
          ...(gate.rejected ? { rejectedCount: gate.rejected } : {}),
          warnings: raw.warnings.length > 0 ? raw.warnings : undefined,
          previewDataUrl: raw.imagePreviewDataUrl,
          ...(raw.sourceUrl ? { sourceUrl: raw.sourceUrl } : {}),
          ...(raw.linkedFile
            ? { name: raw.linkedFile.name, fileType: inferFileType(raw.linkedFile.name), category: contentCategory ?? inferCategory(raw.linkedFile.name), sizeBytes: raw.linkedFile.size }
            : {}),
        });
        markItem(key, 'done');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not process this file.';
        d.failures.push({ name: file.name, message });
        const sourceUrl = err instanceof DocumentLinkError ? err.sourceUrl : undefined;
        d.docs.push({ ...base, status: 'error', warnings: [message], ...(sourceUrl ? { sourceUrl } : {}) });
        d.files.push(file);
        markItem(key, 'failed');
      }
    }

    setPhase('Creating Risk Profile…');
    await wait(250);
    // Something added in the last moment: read it too before deciding.
    if (queue.current.length) return processQueue();

    setDraftDocs([...d.docs]);
    setDraftProfile(d.profile);
    setDraftFiles([...d.files]);
    setFailures([...d.failures]);

    const ni = d.profile.business.namedInsured;
    const st = d.profile.business.state;
    const identityResolved = !ni.isMissing && !ni.isConflicting && !st.isMissing && !st.isConflicting;

    // The referral source, status and note are asked on the confirm step unless already filled in.
    if (identityResolved && d.failures.length === 0 && detailsRef.current) {
      finalizeAccount(ni.value as string, st.value as string, d.docs, d.profile, d.files);
    } else {
      setMode('confirm');
    }
  }

  function resolveIdentityField(key: 'namedInsured' | 'state', value: string) {
    if (!draftProfile) return;
    const updated = applyManualEdit({ ...draftProfile }, 'business', key, value);
    setDraftProfile(updated);
  }

  function handleContinue() {
    if (!draftProfile) return;
    setTypeTouched(true);
    if (!setup || !details) return;
    const ni = draftProfile.business.namedInsured;
    const st = draftProfile.business.state;
    if (ni.isMissing || ni.isConflicting) return;
    // The state is optional here — it can be filled in on the Risk Profile later. A conflicting
    // state stays a conflict there to resolve; the account starts without one.
    const state = !st.isMissing && !st.isConflicting ? (st.value as string) : '';
    try {
      finalizeAccount(ni.value as string, state, draftDocs, draftProfile, draftFiles);
    } catch (err) {
      console.error('New submission failed', err);
      setFatalError(err instanceof Error ? err.message : String(err));
      setMode('error');
    }
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    setTypeTouched(true);
    if (!namedInsuredInput.trim() || !stateInput || !setup || !details) return;
    const name = namedInsuredInput.trim();
    const chosen = details;
    void guardedCreate({ name }, () => {
      const id = createAccount(name, stateInput, setup);
      applyNewAccountDetails(id, chosen);
      navigate(`/accounts/${id}/upload`);
    });
  }

  const gatePanel = gate && (
    <div className="mb-4" data-testid="duplicate-gate">
      {gate.status === 'checking' && !gate.result && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-600)]" role="status">
          <Loader2 size={14} className="animate-spin" /> Checking for existing accounts in your agency…
        </p>
      )}
      {gate.status === 'failed' && (
        <div className="rounded-lg border border-[var(--color-warning-500)] bg-[var(--color-warning-100)] p-3 text-sm" role="alert" data-testid="duplicate-check-failed">
          <p className="font-semibold text-[var(--color-ink-900)]">Couldn’t check for existing accounts</p>
          <p className="mt-1 text-xs text-[var(--color-ink-600)]">{gate.message} Nothing was saved. Try again, or create the account without the check.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void guardedCreate(gate.identity, gate.proceed)}>Retry</Button>
            <Button size="sm" variant="secondary" onClick={() => { const go = gate.proceed; setGate(null); go(); }}>Create without checking</Button>
            <Button size="sm" variant="ghost" onClick={() => setGate(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {gate.result && gate.status !== 'failed' && (
        <DuplicateAccountWarning
          identity={gate.identity}
          matches={gate.result.matches}
          complete={gate.result.complete}
          currentUserId={currentUserId}
          memberEmail={memberEmail}
          busy={gate.status === 'checking'}
          onCreateAnyway={() => void guardedCreate(gate.identity, gate.proceed, gate.result)}
          onCancel={() => setGate(null)}
        />
      )}
    </div>
  );

  function handleUseSample() {
    const id = ensureSampleAccount();
    navigate(`/accounts/${id}/upload`);
  }

  const canContinue =
    !!draftProfile &&
    !draftProfile.business.namedInsured.isMissing &&
    !draftProfile.business.namedInsured.isConflicting &&
    !running.current;

  return (
    <PageContainer
      title="New Submission"
      description="Give RenewalIQ the documents you already have. We'll organize the account for you."
    >
      <div className="mx-auto w-full max-w-xl">
        {mode === 'choice' && (
          <div className="flex flex-col gap-4">
            <Dropzone onFiles={handleFiles} allowLinkPaste={false} />
            <div className="text-center">
              <button
                onClick={() => setMode('manual')}
                className="text-sm font-medium text-[var(--color-ink-500)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-700)] cursor-pointer"
              >
                Start manually instead
              </button>
            </div>
            <div className="mt-2 text-center">
              <button
                onClick={handleUseSample}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-400)] hover:text-[var(--color-ink-600)] cursor-pointer"
              >
                <Sparkles size={12} />
                Try demo account — {sampleAccount.namedInsured}
              </button>
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <Card>
            <CardBody className="pt-6">
              <form onSubmit={handleManualSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Named Insured</label>
                  <input
                    autoFocus
                    value={namedInsuredInput}
                    onChange={(e) => setNamedInsuredInput(e.target.value)}
                    placeholder="e.g. Blue Ridge Logistics LLC"
                    className="w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Domicile State</label>
                  <select
                    value={stateInput}
                    onChange={(e) => setStateInput(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                  >
                    <option value="">Select state…</option>
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
                {!gate && preview && preview.identity.name === namedInsuredInput.trim() && (
                  <DuplicateAccountWarning identity={preview.identity} matches={preview.result.matches} complete={preview.result.complete} currentUserId={currentUserId} memberEmail={memberEmail} />
                )}
                <NewAccountTypeFields value={accountType} onChange={setAccountType} showErrors={typeTouched} />
                <NewAccountDetailsFields value={detailsInput} onChange={setDetailsInput} showErrors={typeTouched} />
                {gatePanel}
                <Button type="submit" disabled={!namedInsuredInput.trim() || !stateInput || !!gate} className="mt-1">
                  Create Submission
                </Button>

              </form>

              <button
                onClick={() => setMode('choice')}
                className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer"
              >
                <UploadCloud size={13} />
                Upload documents instead
              </button>
            </CardBody>
          </Card>
        )}

        {mode === 'processing' && (
          <Card>
            <CardBody className="flex flex-col gap-4 py-6">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="shrink-0 animate-spin text-[var(--color-brand-700)]" />
                <p className="min-w-0 text-sm font-medium text-[var(--color-ink-700)] [overflow-wrap:anywhere]">{phase}</p>
                <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-500)]" data-testid="queue-progress">
                  {items.filter((i) => i.status === 'done' || i.status === 'failed').length} of {items.length} read
                </span>
              </div>
              <FileQueue items={items} />
              <div data-testid="add-more">
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-500)]">Add more documents — they'll be read into the same submission.</p>
                <Dropzone onFiles={handleFiles} allowLinkPaste={false} />
              </div>
            </CardBody>
          </Card>
        )}

        {mode === 'error' && (
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <TriangleAlert size={26} className="text-[var(--color-danger-600)]" />
              <p className="text-sm font-medium text-[var(--color-ink-900)]">The submission couldn’t be created.</p>
              {fatalError && <p className="max-w-md text-xs text-[var(--color-ink-500)]">{fatalError}</p>}
              <Button
                size="sm"
                onClick={() => {
                  setFatalError(null);
                  startOver();
                }}
              >
                Try again
              </Button>
            </CardBody>
          </Card>
        )}

        {mode === 'confirm' && draftProfile && (
          <div className="flex flex-col gap-4">
            {failures.length > 0 && (
              <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/40 px-4 py-3">
                <div className="flex items-start gap-2">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-warning-700)]">
                      {failures.length === 1 ? '1 document could not be processed' : `${failures.length} documents could not be processed`}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-warning-600)]">
                      {failures.map((f) => (
                        <li key={f.name}>
                          <span className="font-medium">{f.name}</span> — {f.message}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-[var(--color-ink-500)]">The rest of your documents were processed normally.</p>
                  </div>
                </div>
              </div>
            )}

            <FileQueue items={items} />
            <div data-testid="add-more">
              <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-500)]">Forgot something? Add more documents to this submission.</p>
              <Dropzone onFiles={handleFiles} allowLinkPaste={false} />
            </div>

            <IdentityResolutionStep
              namedInsured={draftProfile.business.namedInsured}
              domicileState={draftProfile.business.state}
              onResolveNamedInsured={(value) => resolveIdentityField('namedInsured', value)}
              onResolveState={(value) => resolveIdentityField('state', value)}
              {...identitySuggestions(draftDocs, draftProfile)}
            />

            <Card>
              <CardBody className="pt-5">
                <NewAccountTypeFields
                  value={accountType}
                  onChange={(v) => {
                    // Choosing Renewal suggests the effective date read from the documents.
                    const read = normalizeDateKey((draftProfile.business.effectiveDate?.value as string | null | undefined) ?? null);
                    setAccountType(v.businessType === 'renewal' && accountType.businessType !== 'renewal' && !v.renewalDate && read ? { ...v, renewalDate: read } : v);
                  }}
                  showErrors={typeTouched}
                />
              </CardBody>
            </Card>

            <Card>
              <CardBody className="pt-5">
                <NewAccountDetailsFields value={detailsInput} onChange={setDetailsInput} showErrors={typeTouched} />
              </CardBody>
            </Card>

            {gatePanel}
            <div className="flex items-center justify-between">
              <button onClick={startOver} className="text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer">
                Cancel and start over
              </button>
              <Button disabled={!canContinue || !!gate} onClick={handleContinue}>
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
