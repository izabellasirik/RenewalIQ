import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleCheck, Loader2, Plus, TriangleAlert, X } from 'lucide-react';
import { Button } from '../components/ui';
import { Dropzone } from '../components/upload/Dropzone';
import { COVERAGE_LABELS } from '../types';
import type { CoverageType, IntakeLink } from '../types';
import { fetchIntakeLinkByToken, submitIntake, type IntakeAnswers } from '../services/supabase/intakeRepo';
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

export function IntakeFormPage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'invalid' | 'load_error' | 'ready' | 'submitting' | 'submitted' | 'error'>('loading');
  const [link, setLink] = useState<IntakeLink | null>(null);
  const [answers, setAnswers] = useState<IntakeAnswers>(emptyAnswers);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Files that couldn't be uploaded with the last submission — shown so the sender can resend them.
  const [failedFiles, setFailedFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    fetchIntakeLinkByToken(token).then((result) => {
      // A failed LOOKUP (Supabase not configured, the backend unreachable, or the table/policies
      // not provisioned yet) is NOT the same thing as "this token doesn't exist" — collapsing both
      // into "invalid link" told every applicant their perfectly valid link was broken whenever the
      // real problem was on the backend, with zero signal for the broker to act on. A genuinely
      // nonexistent/inactive token (a successful lookup that simply found nothing, or an inactive
      // link) still reads as 'invalid'.
      if (!result.ok) {
        setStatus('load_error');
        return;
      }
      if (!result.data || !result.data.active) {
        setStatus('invalid');
        return;
      }
      setLink(result.data);
      setStatus('ready');
    });
  }, [token]);

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
    setFiles((f) => [...f, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((f) => f.filter((_, i) => i !== index));
  }

  const missing = missingRequired(answers);
  const missingKeys = REQUIRED.filter((r) => missing[r.key]);
  // Errors show only after a Submit attempt, then update live as fields are filled in.
  const fieldError = (key: RequiredKey) => (showErrors ? (missing[key] ?? null) : null);

  async function handleSubmit() {
    if (!link) return;
    if (missingKeys.length > 0) {
      // Take them to the first thing that's missing, so it's clear why it didn't send.
      setShowErrors(true);
      const first = document.getElementById(`field-${missingKeys[0].key}`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.querySelector('input')?.focus({ preventScroll: true });
      return;
    }
    setStatus('submitting');
    setError(null);
    setProgress({ done: 0, total: files.length });
    const result = await submitIntake(link, answers, files, (done, total) => setProgress({ done, total }));
    if (!result.ok) {
      setError(result.message);
      setStatus('ready');
      return;
    }
    setFailedFiles(result.data.failedFiles);
    setStatus('submitted');
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

  if (status === 'submitted') {
    return (
      <IntakeShell>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-6 py-14 text-center">
          <CircleCheck size={26} className="text-[var(--color-success-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Thank you — your submission has been received.</p>
          <p className="max-w-xs text-xs text-[var(--color-ink-500)]">Someone will review it and follow up if anything else is needed. You can close this page.</p>
          {failedFiles.length > 0 && (
            <div className="mt-2 max-w-sm rounded-lg border border-[var(--color-warning-100)] bg-white px-3 py-2 text-left text-xs text-[var(--color-ink-700)]">
              <p className="font-medium text-[var(--color-warning-700)]">
                {failedFiles.length === 1 ? 'This file' : 'These files'} couldn’t be uploaded — please email {failedFiles.length === 1 ? 'it' : 'them'} to your broker:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {failedFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {/* A safety company or agency often has several clients to send — start a fresh, empty form on the same link. */}
          <Button
            size="sm"
            icon={<Plus size={14} />}
            className="mt-3"
            onClick={() => {
              setAnswers(emptyAnswers);
              setFiles([]);
              setError(null);
              setFailedFiles([]);
              setShowErrors(false);
              setProgress(null);
              setStatus('ready');
              window.scrollTo({ top: 0 });
            }}
          >
            Submit another client
          </Button>
        </div>
      </IntakeShell>
    );
  }

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

      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
        {/* Documents first — most senders start from what they already have. */}
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Documents &amp; Photos</p>
        <Dropzone onFiles={addFiles} allowLinkPaste={false} />
        {files.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-sm text-[var(--color-ink-700)]">
                <span className="truncate">{f.name}</span>
                {status === 'submitting' && progress ? (
                  // While sending: a spinner on the file being uploaded, a check on the ones done.
                  i < progress.done ? (
                    <CircleCheck size={15} className="shrink-0 text-[var(--color-success-600)]" aria-label="Uploaded" />
                  ) : i === progress.done ? (
                    <Loader2 size={15} className="shrink-0 animate-spin text-[var(--color-brand-700)]" aria-label="Uploading" />
                  ) : (
                    <span className="shrink-0 text-xs text-[var(--color-ink-400)]">Waiting</span>
                  )
                ) : (
                  <button type="button" onClick={() => removeFile(i)} className="shrink-0 rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label="Remove file">
                    <X size={14} />
                  </button>
                )}
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

        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}

        {showErrors && missingKeys.length > 0 && (
          <p className="text-sm text-[var(--color-danger-600)]">Please fill in: {missingKeys.map((r) => r.label).join(', ')}.</p>
        )}
        {status === 'submitting' && progress && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-600)]" role="status">
            <Loader2 size={15} className="animate-spin text-[var(--color-brand-700)]" />
            {progress.total > 0 && progress.done < progress.total
              ? `Uploading documents… ${progress.done + 1} of ${progress.total}`
              : 'Sending your submission…'}
          </p>
        )}

        <Button className="mt-2" disabled={status === 'submitting'} onClick={handleSubmit} icon={status === 'submitting' ? <Loader2 size={15} className="animate-spin" /> : undefined}>
          {status === 'submitting' ? (progress && progress.total > 0 && progress.done < progress.total ? 'Uploading…' : 'Submitting…') : 'Submit'}
        </Button>
      </div>
    </IntakeShell>
  );
}
