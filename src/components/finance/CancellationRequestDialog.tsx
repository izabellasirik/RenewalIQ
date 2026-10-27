import { useState, type FormEvent } from 'react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { cancelPolicy } from '../../services/supabase/ledgerRepo';
import { parseMoneyCents } from '../../services/workflow/policies';

/**
 * The account's agent (or an admin) cancels a policy / endorsement (0075): full or partial, the effective
 * date, why, the net premium the carrier refunds, and the cancellation notice if there is one. It applies
 * right away — the commission on the refund is taken back — and an admin reviews it afterwards.
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
    // Full: the whole premium still on the policy is refunded (worked out by the database). Partial: the amount entered.
    const cents = type === 'full' ? null : parseMoneyCents(refund);
    if (type === 'partial' && (cents === null || Number.isNaN(cents) || cents <= 0)) errs.push('Enter the net premium the carrier refunds, e.g. 4,000.00.');
    if (errs.length) return setErrors(errs);
    setSaving(true);
    const res = await cancelPolicy(transactionId, type, date, reason.trim(), cents, docIds);
    setSaving(false);
    if (!res.ok) return setErrors([res.message]);
    onSent();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel — ${policyLabel}`}
      subtitle="The commission on the refunded premium is taken back right away. The original policy stays as recorded."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button type="submit" form="cancel-request-form" disabled={saving}>{saving ? 'Cancelling…' : 'Cancel policy'}</Button>
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
          {type === 'partial' ? (
            <div>
              <label className={labelClass} htmlFor="cancel-refund">Refund from the carrier (net, $)</label>
              <input id="cancel-refund" inputMode="decimal" className={inputClass} value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="e.g. 4,000.00" />
            </div>
          ) : (
            <p className="self-end pb-2 text-xs text-[var(--color-ink-600)]" data-field="full-refund">The whole remaining premium is refunded — no amount needed.</p>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="cancel-reason">Reason</label>
          <textarea id="cancel-reason" rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two units sold; client moved coverage" />
        </div>
        <div>
          <p className={labelClass}>Cancellation notice</p>
          {documents.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-500)]">No documents on this account yet. You can cancel without the notice and upload it in Checklist &amp; Documents later.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
              {[...documents].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)).map((d) => (
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
