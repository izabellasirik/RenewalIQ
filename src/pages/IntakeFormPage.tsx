import { notifyBrokerOfSubmission } from '../services/notifications/notifySubmission';
import { useCallback, useEffect, useRef, useState } from 'react';
import { expandToken } from '../services/publicLinks';
import { useParams } from 'react-router-dom';
import { CircleCheck, Loader2, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { Button } from '../components/ui';
import { Dropzone } from '../components/upload/Dropzone';
import { COVERAGE_LABELS } from '../types';
import type { CoverageType, IntakeLink } from '../types';
import {
  fetchIntakeLinkByToken,
  finalizeIntakeSubmission,
  IntakeNotUpgradedError,
  isTransientError,
  logIntakeEvent,
  startIntakeSubmission,
  submitIntake,
  uploadIntakeFile,
  type IntakeAnswers,
  type IntakeSession,
} from '../services/supabase/intakeRepo';
import { clearIntakeDraft, draftHasContent, loadIntakeDraft, saveIntakeDraft } from '../services/intake/intakeDraft';
import { errorMessage } from '../services/intake/retry';
import { BrandLogo } from '../components/branding/Logo';
import { cn } from '../utils/cn';

const COVERAGE_OPTIONS = Object.keys(COVERAGE_LABELS) as CoverageType[];

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]';

const emptyAnswers: IntakeAnswers = {
  namedInsured: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  dotNumber: '',
  mcNumber: '',
  yearsInBusiness: null,
  powerUnits: null,
  driverCount: null,
  operationType: '',
  commoditiesHauled: '',
  operatingRadius: '',
  operatingStates: '',
  coverageRequested: [],
  currentCarrier: '',
  effectiveDate: '',
  additionalNotes: '',
};

function Field({ label, required, error, id, children }: { label: string; required?: boolean; error?: string | null; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className={cn('scroll-mt-24', error && '[&_input]:border-[var(--color-danger-500)] [&_input]:ring-2 [&_input]:ring-[var(--color-danger-500)]/15')}>
      <label className={labelClass}>
        {label}
        {required && <span className="text-[var(--color-danger-600)]"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-[var(--color-danger-600)]">{error}</p>}
    </div>
  );
}

type RequiredKey = 'namedInsured' | 'dotNumber' | 'contactName' | 'contactEmail';
const REQUIRED: { key: RequiredKey; label: string }[] = [
  { key: 'namedInsured', label: 'Company name' },
  { key: 'dotNumber', label: 'DOT number' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'contactEmail', label: 'Email' },
];

/** What's still missing (or invalid), in the order the fields appear. */
function missingRequired(a: IntakeAnswers): Partial<Record<RequiredKey, string>> {
  const out: Partial<Record<RequiredKey, string>> = {};
  for (const { key } of REQUIRED) if (!a[key].trim()) out[key] = 'Required';
  if (!out.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.contactEmail.trim())) out.contactEmail = 'Enter a valid email address';
  return out;
}

function IntakeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-50)] px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        <div className="mb-2 flex items-center gap-2.5">
          <BrandLogo size={36} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * One chosen file and where it is. ready = chosen, not sent yet; uploaded = the server has it and it's
 * linked to the submission; failed = gave up after retries (retry or remove it); missing = restored
 * from an unfinished submission but not uploaded, so the browser needs the file again.
 */
interface FileItem {
  key: string;
  name: string;
  size: number;
  file?: File;
  state: 'ready' | 'uploading' | 'retrying' | 'uploaded' | 'failed' | 'missing';
  message?: string;
}

const UPLOAD_CONCURRENCY = 2;
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

export function IntakeFormPage() {
  // The short form in links (/i/<32 characters>) and the original (/intake/<uuid>) both work.
  const rawToken = useParams<{ token: string }>().token;
  const token = rawToken ? expandToken(rawToken) : rawToken;
  const [status, setStatus] = useState<'loading' | 'invalid' | 'load_error' | 'ready' | 'submitting' | 'submitted' | 'partial'>('loading');
  const [link, setLink] = useState<IntakeLink | null>(null);
  const [answers, setAnswers] = useState<IntakeAnswers>(emptyAnswers);
  const [items, setItemsState] = useState<FileItem[]>([]);
  const itemsRef = useRef<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ uploaded: number; missing: number } | null>(null);
  const [result, setResult] = useState<{ reference: string; files: number } | null>(null);
  // Only for the pre-0029 fallback: files that didn't arrive.
  const [legacyFailed, setLegacyFailed] = useState<string[]>([]);
  const clientTokenRef = useRef<string>(newKey());
  const sessionRef = useRef<IntakeSession | null>(null);
  // A second Submit while one is running does nothing (the server also refuses to make a duplicate).
  const submittingRef = useRef(false);

  const setItems = useCallback((update: (cur: FileItem[]) => FileItem[]) => {
    itemsRef.current = update(itemsRef.current);
    setItemsState(itemsRef.current);
  }, []);
  const updateItem = useCallback((key: string, patch: Partial<FileItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i))), [setItems]);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    fetchIntakeLinkByToken(token).then((res) => {
      // A failed LOOKUP (Supabase not configured, the backend unreachable, or the table/policies
      // not provisioned yet) is NOT the same thing as "this token doesn't exist" — collapsing both
      // into "invalid link" told every applicant their perfectly valid link was broken whenever the
      // real problem was on the backend, with zero signal for the broker to act on. A genuinely
      // nonexistent/inactive token (a successful lookup that simply found nothing, or an inactive
      // link) still reads as 'invalid'.
      if (!res.ok) {
        setStatus('load_error');
        return;
      }
      if (!res.data || !res.data.active) {
        setStatus('invalid');
        return;
      }
      setLink(res.data);
      // An unfinished submission from this browser: bring it back, same submission.
      const draft = loadIntakeDraft(token);
      if (draft && draftHasContent(draft)) {
        clientTokenRef.current = draft.clientToken;
        if (draft.submissionId && draft.reference) sessionRef.current = { submissionId: draft.submissionId, reference: draft.reference, clientToken: draft.clientToken };
        setAnswers({ ...emptyAnswers, ...draft.answers });
        setItems(() => draft.files.map((f) => ({ key: f.key, name: f.name, size: f.size, state: f.uploaded ? 'uploaded' : 'missing' })));
        setRestored({ uploaded: draft.files.filter((f) => f.uploaded).length, missing: draft.files.filter((f) => !f.uploaded).length });
      }
      setStatus('ready');
    });
  }, [token, setItems]);

  // Keep the draft current while the form is open (answers, files, and the server submission once started).
  useEffect(() => {
    if (!token || (status !== 'ready' && status !== 'submitting')) return;
    saveIntakeDraft(token, {
      clientToken: clientTokenRef.current,
      answers,
      files: items.map((i) => ({ key: i.key, name: i.name, size: i.size, uploaded: i.state === 'uploaded' })),
      ...(sessionRef.current ? { submissionId: sessionRef.current.submissionId, reference: sessionRef.current.reference } : {}),
    });
  }, [token, status, answers, items]);

  // Leaving mid-send loses the files still uploading — ask first.
  useEffect(() => {
    if (status !== 'submitting') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  function set<K extends keyof IntakeAnswers>(key: K, value: IntakeAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function toggleCoverage(type: CoverageType) {
    setAnswers((a) => ({
      ...a,
      coverageRequested: a.coverageRequested.includes(type) ? a.coverageRequested.filter((t) => t !== type) : [...a.coverageRequested, type],
    }));
  }

  function addFiles(newFiles: File[]) {
    setItems((cur) => {
      const next = [...cur];
      for (const f of newFiles) {
        // Re-adding a file from an unfinished submission fills its place (same key → same slot on the server).
        const waiting = next.find((i) => i.state === 'missing' && i.name === f.name && i.size === f.size);
        if (waiting) Object.assign(waiting, { file: f, state: 'ready', message: undefined });
        else next.push({ key: newKey(), name: f.name, size: f.size, file: f, state: 'ready' });
      }
      return next.map((i) => ({ ...i }));
    });
    setError(null);
  }

  function removeFile(key: string) {
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item || item.state === 'uploading' || item.state === 'retrying') return;
    setItems((cur) => cur.filter((i) => i.key !== key));
    if (sessionRef.current && (item.state === 'failed' || item.state === 'uploaded')) void logIntakeEvent(sessionRef.current, 'file_removed', { file: item.name });
  }

  function startOver() {
    if (token) clearIntakeDraft(token);
    clientTokenRef.current = newKey();
    sessionRef.current = null;
    setAnswers(emptyAnswers);
    setItems(() => []);
    setRestored(null);
    setError(null);
    setShowErrors(false);
  }

  const missing = missingRequired(answers);
  const missingKeys = REQUIRED.filter((r) => missing[r.key]);
  // Errors show only after a Submit attempt, then update live as fields are filled in.
  const fieldError = (key: RequiredKey) => (showErrors ? (missing[key] ?? null) : null);

  /** Uploads every file the server doesn't have yet, two at a time, each retried on temporary failures. */
  async function uploadOutstanding(session: IntakeSession) {
    const queue = itemsRef.current.filter((i) => i.state !== 'uploaded' && i.file);
    const work = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { key, name, file } = item;
        updateItem(key, { state: 'uploading', message: undefined });
        try {
          await uploadIntakeFile(session, key, file!, (attempt, reason) => {
            updateItem(key, { state: 'retrying', message: `Connection problem — retrying (attempt ${attempt} of 4)…` });
            void logIntakeEvent(session, 'file_retry', { file: name, attempt, reason });
          });
          updateItem(key, { state: 'uploaded', message: undefined });
        } catch (err) {
          const msg = errorMessage(err);
          updateItem(key, { state: 'failed', message: isTransientError(err) ? 'Couldn’t upload — check your connection and retry.' : msg });
          void logIntakeEvent(session, 'file_failed', { file: name, error: msg });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, work));
  }

  /** Before 0029 is applied: the old way, but success only if every file arrived. */
  async function legacySubmit() {
    if (!link) return;
    const files = itemsRef.current.map((i) => i.file).filter((f): f is File => !!f);
    const res = await submitIntake(link, answers, files);
    if (!res.ok) throw new Error(res.message);
    if (token) clearIntakeDraft(token);
    if (res.data.failedFiles.length > 0) {
      setLegacyFailed(res.data.failedFiles);
      setStatus('partial');
    } else {
      setResult({ reference: '', files: files.length });
      setStatus('submitted');
    }
  }

  async function handleSubmit() {
    if (!link || !token || submittingRef.current) return;
    if (missingKeys.length > 0) {
      // Take them to the first thing that's missing, so it's clear why it didn't send.
      setShowErrors(true);
      const first = document.getElementById(`field-${missingKeys[0].key}`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.querySelector('input')?.focus({ preventScroll: true });
      return;
    }
    const needFile = itemsRef.current.filter((i) => i.state === 'missing');
    if (needFile.length > 0) {
      setError(`Add ${needFile.length === 1 ? 'this file' : 'these files'} again, or remove ${needFile.length === 1 ? 'it' : 'them'}: ${needFile.map((i) => i.name).join(', ')}.`);
      return;
    }
    submittingRef.current = true;
    setStatus('submitting');
    setError(null);
    try {
      setPhase('Saving your answers…');
      let session: IntakeSession;
      try {
        session = await startIntakeSubmission(token, clientTokenRef.current, answers, itemsRef.current.length);
      } catch (err) {
        if (err instanceof IntakeNotUpgradedError) {
          setPhase('Sending your submission…');
          await legacySubmit();
          return;
        }
        throw err;
      }
      sessionRef.current = session;

      setPhase('Uploading documents…');
      await uploadOutstanding(session);
      const failed = itemsRef.current.filter((i) => i.state === 'failed');
      if (failed.length > 0) {
        setError(
          `Your submission isn’t complete yet — ${failed.length === 1 ? '1 file' : `${failed.length} files`} couldn’t be uploaded. Retry, or remove ${failed.length === 1 ? 'it' : 'them'} to send without ${failed.length === 1 ? 'it' : 'them'}. Nothing you entered is lost.`
        );
        setStatus('ready');
        return;
      }

      // The server checks the answers and every file (linked AND in storage) before calling it done.
      setPhase('Verifying your submission…');
      const keys = () => itemsRef.current.map((i) => i.key);
      let fin = await finalizeIntakeSubmission(session, keys());
      if (!fin.ok && fin.missing.length > 0) {
        // Files the server couldn't confirm: send them again once, then verify again.
        for (const k of fin.missing) {
          const it = itemsRef.current.find((i) => i.key === k);
          if (it) updateItem(k, it.file ? { state: 'ready' } : { state: 'missing', message: 'Add this file again' });
        }
        setPhase('Uploading documents…');
        await uploadOutstanding(session);
        if (itemsRef.current.every((i) => i.state === 'uploaded')) {
          setPhase('Verifying your submission…');
          fin = await finalizeIntakeSubmission(session, keys());
        }
      }
      if (!fin.ok) {
        for (const k of fin.missing) updateItem(k, { state: itemsRef.current.find((i) => i.key === k)?.file ? 'failed' : 'missing', message: 'The server couldn’t confirm this file.' });
        setError(
          fin.problems.length > 0
            ? `Please fill in: ${fin.problems.join(', ')}.`
            : 'Your submission isn’t complete yet — some files couldn’t be confirmed. Retry, or remove them to send without them.'
        );
        setStatus('ready');
        return;
      }

      clearIntakeDraft(token);
      setResult({ reference: fin.reference, files: fin.files });
      setStatus('submitted');
      // Saved and verified — email the broker (the server sends it once, however often this runs).
      void notifyBrokerOfSubmission({ kind: 'intake', submissionId: session.submissionId, clientToken: session.clientToken });
    } catch (err) {
      setError(
        isTransientError(err)
          ? 'We couldn’t reach the server. Nothing you entered is lost — check your connection and press Submit again to continue.'
          : `Your submission couldn’t be completed: ${errorMessage(err)}`
      );
      setStatus('ready');
    } finally {
      submittingRef.current = false;
      setPhase(null);
    }
  }

  if (status === 'loading') {
    return (
      <IntakeShell>
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--color-ink-100)] bg-white py-16 text-sm text-[var(--color-ink-500)]">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      </IntakeShell>
    );
  }

  if (status === 'invalid') {
    return (
      <IntakeShell>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-6 py-14 text-center">
          <TriangleAlert size={22} className="text-[var(--color-warning-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">This submission link isn't valid or is no longer active.</p>
          <p className="text-xs text-[var(--color-ink-500)]">Please check the link you were given, or contact whoever sent it to you for a new one.</p>
        </div>
      </IntakeShell>
    );
  }

  if (status === 'load_error') {
    return (
      <IntakeShell>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-6 py-14 text-center">
          <TriangleAlert size={22} className="text-[var(--color-danger-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Something went wrong loading this form.</p>
          <p className="max-w-xs text-xs text-[var(--color-ink-500)]">This isn't a problem with your link — please try again in a moment. If it keeps happening, let whoever sent you this link know.</p>
        </div>
      </IntakeShell>
    );
  }

  const resetForAnother = () => {
    startOver();
    setResult(null);
    setLegacyFailed([]);
    setStatus('ready');
    window.scrollTo({ top: 0 });
  };

  if (status === 'submitted' && result) {
    return (
      <IntakeShell>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-6 py-14 text-center">
          <CircleCheck size={26} className="text-[var(--color-success-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Submitted successfully.</p>
          {result.reference && (
            <div className="mt-1 rounded-lg border border-[var(--color-success-100)] bg-white px-4 py-2">
              <p className="text-xs text-[var(--color-ink-500)]">Your reference number</p>
              <p className="font-mono text-lg font-semibold tracking-wide text-[var(--color-ink-900)]" data-testid="intake-reference">
                {result.reference}
              </p>
            </div>
          )}
          <p className="max-w-xs text-xs text-[var(--color-ink-500)]">
            {result.files > 0 ? `Your answers and ${result.files === 1 ? '1 file were' : `${result.files} files were`} received and confirmed. ` : 'Your answers were received and confirmed. '}
            {result.reference ? 'Keep the reference number in case you need to follow up. ' : ''}You can close this page.
          </p>
          {/* A safety company or agency often has several clients to send — start a fresh, empty form on the same link. */}
          <Button size="sm" icon={<Plus size={14} />} className="mt-3" onClick={resetForAnother}>
            Submit another client
          </Button>
        </div>
      </IntakeShell>
    );
  }

  if (status === 'partial') {
    return (
      <IntakeShell>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-6 py-14 text-center">
          <TriangleAlert size={22} className="text-[var(--color-warning-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Your answers were received, but not every file arrived.</p>
          <p className="max-w-sm text-xs text-[var(--color-ink-600)]">Please send {legacyFailed.length === 1 ? 'this file' : 'these files'} to your broker another way:</p>
          <ul className="list-disc pl-4 text-left text-xs text-[var(--color-ink-700)]">
            {legacyFailed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Button size="sm" icon={<Plus size={14} />} className="mt-3" onClick={resetForAnother}>
            Submit another client
          </Button>
        </div>
      </IntakeShell>
    );
  }

  const busy = status === 'submitting';
  const failedCount = items.filter((i) => i.state === 'failed').length;

  return (
    <IntakeShell>
      <div className="mb-2">
        <h1 className="text-lg font-semibold text-[var(--color-ink-900)]">New Submission</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          You're submitting this directly to{' '}
          {/* The agency name, never link.label — that's the broker's internal note. */}
          {link?.organizationName ? <span className="font-medium text-[var(--color-ink-700)]">{link.organizationName}</span> : 'your insurance broker'} for review.
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          Tell us a bit about the account and attach whatever documents you already have.
        </p>
      </div>

      {restored && (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--color-brand-500)]/30 bg-white px-4 py-3 text-sm text-[var(--color-ink-700)]" role="status">
          <p>
            We kept your unfinished submission.
            {restored.uploaded > 0 && ` ${restored.uploaded === 1 ? '1 file is' : `${restored.uploaded} files are`} already uploaded.`}
            {restored.missing > 0 && ` ${restored.missing === 1 ? '1 file needs' : `${restored.missing} files need`} to be added again.`}
          </p>
          <button type="button" onClick={startOver} className="text-xs font-medium text-[var(--color-ink-500)] underline decoration-dotted underline-offset-2 cursor-pointer">
            Start over
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
        {/* Documents first — most senders start from what they already have. */}
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Documents &amp; Photos</p>
        <Dropzone onFiles={addFiles} allowLinkPaste={false} />
        {items.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Files">
            {items.map((f) => (
              <li
                key={f.key}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm text-[var(--color-ink-700)]',
                  f.state === 'failed' ? 'border-[var(--color-danger-100)] bg-[var(--color-danger-50)]' : f.state === 'missing' ? 'border-[var(--color-warning-100)] bg-[var(--color-warning-50)]' : 'border-[var(--color-ink-100)]'
                )}
                data-file-state={f.state}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs">
                    {(f.state === 'uploading' || f.state === 'retrying') && (
                      <>
                        <Loader2 size={14} className="animate-spin text-[var(--color-brand-700)]" />
                        <span className="text-[var(--color-ink-500)]">Uploading</span>
                      </>
                    )}
                    {f.state === 'uploaded' && (
                      <>
                        <CircleCheck size={14} className="text-[var(--color-success-600)]" />
                        <span className="text-[var(--color-success-600)]">Uploaded</span>
                      </>
                    )}
                    {f.state === 'failed' && (
                      <>
                        <span className="font-medium text-[var(--color-danger-600)]">Failed</span>
                        <button type="button" disabled={busy} onClick={() => void handleSubmit()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[var(--color-brand-700)] hover:bg-white cursor-pointer disabled:opacity-50" aria-label={`Retry ${f.name}`}>
                          <RotateCcw size={12} /> Retry
                        </button>
                      </>
                    )}
                    {f.state === 'missing' && <span className="font-medium text-[var(--color-warning-700)]">Add again</span>}
                    {f.state === 'ready' && busy && <span className="text-[var(--color-ink-400)]">Waiting</span>}
                    {!busy && f.state !== 'uploading' && f.state !== 'retrying' && (
                      <button type="button" onClick={() => removeFile(f.key)} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label={`Remove ${f.name}`}>
                        <X size={14} />
                      </button>
                    )}
                  </span>
                </div>
                {f.message && <p className={cn('text-xs', f.state === 'failed' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]')}>{f.message}</p>}
              </li>
            ))}
          </ul>
        )}


        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Company</p>
        <Field label="Named insured / company name" required id="field-namedInsured" error={fieldError('namedInsured')}>
          <input className={inputClass} value={answers.namedInsured} onChange={(e) => set('namedInsured', e.target.value)} placeholder="e.g. Blue Ridge Logistics LLC" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="DOT number" required id="field-dotNumber" error={fieldError('dotNumber')}>
            <input className={inputClass} value={answers.dotNumber} onChange={(e) => set('dotNumber', e.target.value)} />
          </Field>
          <Field label="MC number (if applicable)">
            <input className={inputClass} value={answers.mcNumber} onChange={(e) => set('mcNumber', e.target.value)} />
          </Field>
          <Field label="Years in business">
            <input type="number" min={0} className={inputClass} value={answers.yearsInBusiness ?? ''} onChange={(e) => set('yearsInBusiness', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Number of power units">
            <input type="number" min={0} className={inputClass} value={answers.powerUnits ?? ''} onChange={(e) => set('powerUnits', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Number of drivers">
            <input type="number" min={0} className={inputClass} value={answers.driverCount ?? ''} onChange={(e) => set('driverCount', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Operation type">
            <input className={inputClass} placeholder="e.g. long-haul, regional, local" value={answers.operationType} onChange={(e) => set('operationType', e.target.value)} />
          </Field>
        </div>
        <Field label="Commodities hauled">
          <input className={inputClass} placeholder="e.g. general freight, produce, machinery" value={answers.commoditiesHauled} onChange={(e) => set('commoditiesHauled', e.target.value)} />
        </Field>
        {/* States operated in isn't asked here (broker feedback) — the broker fills it on the Risk Profile. */}
        <Field label="Operating radius">
          <input className={inputClass} placeholder="e.g. 500 miles, nationwide" value={answers.operatingRadius} onChange={(e) => set('operatingRadius', e.target.value)} />
        </Field>

        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Contact</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Contact name" required id="field-contactName" error={fieldError('contactName')}>
            <input className={inputClass} value={answers.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Email" required id="field-contactEmail" error={fieldError('contactEmail')}>
            <input type="email" className={inputClass} value={answers.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input type="tel" className={inputClass} value={answers.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
          </Field>
        </div>

        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Coverage</p>
        <Field label="Coverage requested">
          <div className="flex flex-wrap gap-2">
            {COVERAGE_OPTIONS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleCoverage(type)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  answers.coverageRequested.includes(type)
                    ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/8 text-[var(--color-brand-800)]'
                    : 'border-[var(--color-ink-200)] text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
                }`}
              >
                {COVERAGE_LABELS[type]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Current carrier (if applicable)">
          <input className={inputClass} value={answers.currentCarrier} onChange={(e) => set('currentCarrier', e.target.value)} />
        </Field>
        <Field label="Effective date">
          <input type="date" className={inputClass} value={answers.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
        </Field>
        <Field label="Additional notes">
          <textarea rows={3} className={inputClass} value={answers.additionalNotes} onChange={(e) => set('additionalNotes', e.target.value)} />
        </Field>

        {error && (
          <p className="text-sm text-[var(--color-danger-600)]" role="alert">
            {error}
          </p>
        )}

        {showErrors && missingKeys.length > 0 && (
          <p className="text-sm text-[var(--color-danger-600)]">Please fill in: {missingKeys.map((r) => r.label).join(', ')}.</p>
        )}
        {busy && phase && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-600)]" role="status">
            <Loader2 size={15} className="animate-spin text-[var(--color-brand-700)]" />
            {phase === 'Uploading documents…' && items.length > 0 ? `Uploading documents… ${items.filter((i) => i.state === 'uploaded').length} of ${items.length} done` : phase}
          </p>
        )}

        <Button className="mt-2" disabled={busy} onClick={() => void handleSubmit()} icon={busy ? <Loader2 size={15} className="animate-spin" /> : undefined}>
          {busy ? 'Submitting…' : failedCount > 0 ? 'Retry and submit' : 'Submit'}
        </Button>
      </div>
    </IntakeShell>
  );
}
