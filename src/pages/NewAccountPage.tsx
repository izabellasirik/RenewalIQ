import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, TriangleAlert, UploadCloud } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Dropzone } from '../components/upload/Dropzone';
import { IdentityResolutionStep } from '../components/newSubmission/IdentityResolutionStep';
import { Button, Card, CardBody } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { sampleAccount } from '../data/sampleAccounts';
import { createEmptyRiskProfile, mergeIntoRiskProfile, applyManualEdit, extractInsuranceFields } from '../services/extraction';
import { generateId } from '../utils/id';
import { inferCategory, inferFileType } from '../utils/documents';
import { US_STATES } from '../utils/usStates';
import type { RiskProfile, UploadedDocument } from '../types';

type Mode = 'choice' | 'manual' | 'processing' | 'confirm';
type DraftDoc = Omit<UploadedDocument, 'accountId'>;

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

  const [namedInsuredInput, setNamedInsuredInput] = useState('');
  const [stateInput, setStateInput] = useState('');

  function finalizeAccount(namedInsured: string, state: string, docs: DraftDoc[], profile: RiskProfile) {
    const id = createAccountFromExtraction(namedInsured, state, docs, profile);
    navigate(`/accounts/${id}/risk-profile`);
  }

  async function handleFiles(files: File[]) {
    setMode('processing');
    setFailures([]);
    setPhase('Uploading documents…');
    await wait(200);

    const { parseFile } = await import('../services/ingestion');

    setPhase('Reading files…');
    let profile = createEmptyRiskProfile('pending');
    const docs: DraftDoc[] = [];
    const newFailures: { name: string; message: string }[] = [];

    for (const file of files) {
      const docId = generateId('doc');
      const base = {
        id: docId,
        name: file.name,
        fileType: inferFileType(file.name),
        category: inferCategory(file.name),
        uploadedAt: new Date().toISOString(),
        sizeBytes: file.size,
      };
      try {
        const raw = await parseFile(file);
        setPhase('Extracting account information…');
        const results = extractInsuranceFields(raw, { documentId: docId, documentName: file.name });
        profile = mergeIntoRiskProfile(profile, results);
        docs.push({ ...base, status: 'processed', fieldsExtracted: results.length, warnings: raw.warnings.length > 0 ? raw.warnings : undefined });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not process this file.';
        newFailures.push({ name: file.name, message });
        docs.push({ ...base, status: 'error', warnings: [message] });
      }
    }

    setPhase('Creating Risk Profile…');
    await wait(250);

    setDraftDocs(docs);
    setDraftProfile(profile);
    setFailures(newFailures);

    const ni = profile.business.namedInsured;
    const st = profile.business.state;
    const identityResolved = !ni.isMissing && !ni.isConflicting && !st.isMissing && !st.isConflicting;

    if (identityResolved && newFailures.length === 0) {
      finalizeAccount(ni.value as string, st.value as string, docs, profile);
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
    const ni = draftProfile.business.namedInsured;
    const st = draftProfile.business.state;
    if (ni.isMissing || ni.isConflicting || st.isMissing || st.isConflicting) return;
    finalizeAccount(ni.value as string, st.value as string, draftDocs, draftProfile);
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!namedInsuredInput.trim() || !stateInput) return;
    const id = createAccount(namedInsuredInput.trim(), stateInput);
    navigate(`/accounts/${id}/upload`);
  }

  function handleUseSample() {
    const id = ensureSampleAccount();
    navigate(`/accounts/${id}/upload`);
  }

  const canContinue =
    !!draftProfile &&
    !draftProfile.business.namedInsured.isMissing &&
    !draftProfile.business.namedInsured.isConflicting &&
    !draftProfile.business.state.isMissing &&
    !draftProfile.business.state.isConflicting;

  return (
    <PageContainer
      title="New Submission"
      description="Give Renewal IQ the documents you already have. We'll organize the account for you."
    >
      <div className="mx-auto w-full max-w-xl">
        {mode === 'choice' && (
          <div className="flex flex-col gap-4">
            <Dropzone onFiles={handleFiles} />
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
                <Button type="submit" disabled={!namedInsuredInput.trim() || !stateInput} className="mt-1">
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
            <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
              <Loader2 size={28} className="animate-spin text-[var(--color-brand-700)]" />
              <p className="text-sm font-medium text-[var(--color-ink-700)]">{phase}</p>
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

            <IdentityResolutionStep
              namedInsured={draftProfile.business.namedInsured}
              domicileState={draftProfile.business.state}
              onResolveNamedInsured={(value) => resolveIdentityField('namedInsured', value)}
              onResolveState={(value) => resolveIdentityField('state', value)}
            />

            <div className="flex items-center justify-between">
              <button onClick={() => setMode('choice')} className="text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer">
                Cancel and start over
              </button>
              <Button disabled={!canContinue} onClick={handleContinue}>
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
