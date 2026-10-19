import { useState, type FormEvent } from 'react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { requestCancellation } from '../../services/supabase/ledgerRepo';
import { parseMoneyCents } from '../../services/workflow/policies';

/**
 * An agent (or admin) asks for a policy's cancellation: full or partial, the effective date, why, the
 * refund they expect, and the cancellation notice from the account's documents. Nothing is worked out
 * here — an admin approves it with the carrier's actual refund and commission adjustment.
 */
export function CancellationRequestDialog({ accountId, transactionId, policyLabel, onClose, onSent }: { accountId: string; transactionId: string; policyLabel: string; onClose: () => void; onSent: () => void }) {
  const documents = useAccountsStore((s) => s.documents[accountId] ?? []);
  const [type, setType] = useState<'full' | 'partial'>('partial');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const [docIds, setDocIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!date) errs.push('Enter the cancellation’s effective date.');
    if (!reason.trim()) errs.push('Say why the policy is cancelled.');
    const cents = parseMoneyCents(refund);
    if (refund.trim() && (cents === null || Number.isNaN(cents) || cents <= 0)) errs.push('Enter the expected refund as an amount, e.g. 4,000.00 (or leave it blank).');
    if (errs.length) return setErrors(errs);
    setSaving(true);
    const res = await requestCancellation(transactionId, type, date, reason.trim(), refund.trim() ? (cents as number) : null, docIds);
    setSaving(false);
    if (!res.ok) return setErrors([res.message]);
    onSent();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Request cancellation — ${policyLabel}`}
      subtitle="An admin approves it with the carrier’s actual refund. The original policy and its commission stay as recorded."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="cancel-request-form" disabled={saving}>Send request</Button>
        </>
      }
    >
      <form id="cancel-request-form" onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="cancel-request-form">
        {errors.length > 0 && (
          <ul className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">
            {errors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <fieldset className="flex gap-4 text-sm">
          <legend className={labelClass}>Cancellation</legend>
          {(['partial', 'full'] as const).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="cancel-type" value={t} checked={type === t} onChange={() => setType(t)} />
              {t === 'full' ? 'Full' : 'Partial (e.g. units removed)'}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="cancel-date">Effective date</label>
            <input id="cancel-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="cancel-refund">Expected refund (net, $)</label>
            <input id="cancel-refund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Optional — the carrier confirms it" />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="cancel-reason">Reason</label>
          <textarea id="cancel-reason" rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two units sold; client moved coverage" />
        </div>
        <div>
          <p className={labelClass}>Cancellation notice</p>
          {documents.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-500)]">No documents on this account yet. Upload the notice in Checklist &amp; Documents, or send the request without it (the admin will ask for it).</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
              {documents.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={docIds.includes(d.id)} onChange={(e) => setDocIds((list) => (e.target.checked ? [...list, d.id] : list.filter((x) => x !== d.id)))} />
                    <span className="truncate">{d.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  );
}
