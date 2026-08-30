import { useState } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { AppetiteFieldKey, AppetiteRecord } from '../../types';
import { APPETITE_FIELD_KEY_LABELS } from '../../types';
import { Button } from '../ui';
import { getCurrentValueDisplay, getCurrentValueRaw } from '../../services/appetite/appetiteFieldKeys';
import { submitAppetiteUpdateRequest } from '../../services/appetiteUpdates/appetiteUpdateService';

const FIELD_KEYS = Object.keys(APPETITE_FIELD_KEY_LABELS) as AppetiteFieldKey[];

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-ink-600)]';

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'success' } | { status: 'error'; message: string };

export function RequestAppetiteUpdateForm({ record, onClose }: { record: AppetiteRecord; onClose: () => void }) {
  const [fieldKey, setFieldKey] = useState<AppetiteFieldKey>(FIELD_KEYS[0]);
  const [proposedValue, setProposedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [submitterName, setSubmitterName] = useState('');
  const [submitterEmail, setSubmitterEmail] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  const isOther = fieldKey === 'other';
  const canSubmit = fieldKey && proposedValue.trim() && submitterName.trim() && submitterEmail.trim() && submitState.status !== 'submitting';

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitState({ status: 'submitting' });
    const result = await submitAppetiteUpdateRequest({
      marketId: record.id,
      marketName: record.marketName,
      fieldKey,
      currentValue: getCurrentValueRaw(record, fieldKey),
      proposedValue: proposedValue.trim(),
      notes: notes.trim(),
      sourceUrl: sourceUrl.trim(),
      sourceReference: sourceReference.trim(),
      submitterName: submitterName.trim(),
      submitterEmail: submitterEmail.trim(),
    });

    if (!result.ok) {
      setSubmitState({ status: 'error', message: result.message });
      return;
    }

    setSubmitState({ status: 'success' });
    setProposedValue('');
    setNotes('');
    setSourceUrl('');
    setSourceReference('');
    setSubmitterName('');
    setSubmitterEmail('');
  }

  if (submitState.status === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] py-8 text-center">
        <CheckCircle2 size={28} className="text-[var(--color-success-500)]" />
        <p className="text-sm font-medium text-[var(--color-ink-800)]">Thanks — your update was submitted for review.</p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] p-4">
      <div>
        <p className={labelClass}>Market</p>
        <p className="text-sm font-medium text-[var(--color-ink-900)]">{record.marketName}</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="appetite-update-field">
          What information needs updating?
        </label>
        <select id="appetite-update-field" value={fieldKey} onChange={(e) => setFieldKey(e.target.value as AppetiteFieldKey)} className={inputClass}>
          {FIELD_KEYS.map((key) => (
            <option key={key} value={key}>
              {APPETITE_FIELD_KEY_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {!isOther && (
        <div>
          <p className={labelClass}>Current value</p>
          <p className="rounded-lg border border-dashed border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-600)]">{getCurrentValueDisplay(record, fieldKey)}</p>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="appetite-update-proposed">
          {isOther ? 'Tell us what needs updating' : 'Suggested new value'} <span className="text-[var(--color-danger-600)]">*</span>
        </label>
        {isOther && <p className="mb-1.5 text-xs font-normal normal-case text-[var(--color-ink-400)]">Describe the appetite information that appears outdated, incorrect, or missing.</p>}
        {isOther ? (
          <textarea
            id="appetite-update-proposed"
            value={proposedValue}
            onChange={(e) => setProposedValue(e.target.value)}
            rows={3}
            placeholder="What needs updating?"
            className={inputClass}
          />
        ) : (
          <input id="appetite-update-proposed" value={proposedValue} onChange={(e) => setProposedValue(e.target.value)} placeholder="What should this be instead?" className={inputClass} />
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="appetite-update-notes">
          Explanation / notes
        </label>
        <textarea id="appetite-update-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Why is this changing?" className={inputClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="appetite-update-source-url">
          Source URL <span className="font-normal normal-case text-[var(--color-ink-400)]">(strongly encouraged — a link to the market's published update, if there is one)</span>
        </label>
        <input id="appetite-update-source-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" className={inputClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="appetite-update-source-reference">
          Source / document reference <span className="font-normal normal-case text-[var(--color-ink-400)]">(optional — e.g. "underwriter email, Aug 12" if there's no URL)</span>
        </label>
        <input id="appetite-update-source-reference" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} className={inputClass} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="appetite-update-name">
            Name <span className="text-[var(--color-danger-600)]">*</span>
          </label>
          <input id="appetite-update-name" value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="appetite-update-email">
            Email <span className="text-[var(--color-danger-600)]">*</span>
          </label>
          <input id="appetite-update-email" type="email" value={submitterEmail} onChange={(e) => setSubmitterEmail(e.target.value)} className={inputClass} />
        </div>
      </div>

      {submitState.status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Your request was not submitted.</strong> {submitState.message}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitState.status === 'submitting' ? 'Submitting…' : 'Submit Request'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
