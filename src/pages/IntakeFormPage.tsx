import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleCheck, Loader2, TriangleAlert, X } from 'lucide-react';
import { Button } from '../components/ui';
import { Dropzone } from '../components/upload/Dropzone';
import { COVERAGE_LABELS } from '../types';
import type { CoverageType, IntakeLink } from '../types';
import { fetchIntakeLinkByToken, submitIntake, type IntakeAnswers } from '../services/supabase/intakeRepo';

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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && <span className="text-[var(--color-danger-600)]"> *</span>}
      </label>
      {children}
    </div>
  );
}

function IntakeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-50)] px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        <div className="mb-2 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-brand-800)] text-sm font-bold text-white">R</div>
          <p className="text-sm font-semibold tracking-tight text-[var(--color-ink-900)]">Renewal IQ</p>
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

  const canSubmit = !!link && answers.namedInsured.trim() && answers.contactName.trim() && answers.contactEmail.trim();

  async function handleSubmit() {
    if (!link || !canSubmit) return;
    setStatus('submitting');
    setError(null);
    const result = await submitIntake(link, answers, files);
    if (!result.ok) {
      setError(result.message);
      setStatus('ready');
      return;
    }
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
          {link?.label ? <span className="font-medium text-[var(--color-ink-700)]">{link.label}</span> : 'your insurance broker'} for review.
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          Tell us a bit about the account and attach whatever documents you already have — you don't need to fill in anything a document already covers. Fields marked{' '}
          <span className="text-[var(--color-danger-600)]">*</span> are required; everything else is optional.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Company</p>
        <Field label="Named insured / company name" required>
          <input className={inputClass} value={answers.namedInsured} onChange={(e) => set('namedInsured', e.target.value)} placeholder="e.g. Blue Ridge Logistics LLC" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="DOT number">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Operating radius">
            <input className={inputClass} placeholder="e.g. 500 miles, nationwide" value={answers.operatingRadius} onChange={(e) => set('operatingRadius', e.target.value)} />
          </Field>
          <Field label="States operated in">
            <input className={inputClass} placeholder="e.g. TX, OK, LA, AR" value={answers.operatingStates} onChange={(e) => set('operatingStates', e.target.value)} />
          </Field>
        </div>

        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Contact</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Contact name" required>
            <input className={inputClass} value={answers.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Email" required>
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

        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">Documents &amp; Photos</p>
        <Dropzone onFiles={addFiles} />
        {files.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-sm text-[var(--color-ink-700)]">
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} className="shrink-0 rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label="Remove file">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}

        <Button className="mt-2" disabled={!canSubmit || status === 'submitting'} onClick={handleSubmit}>
          {status === 'submitting' ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </IntakeShell>
  );
}
