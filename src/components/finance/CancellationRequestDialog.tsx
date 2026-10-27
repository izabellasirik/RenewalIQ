import { useEffect, useState, type FormEvent } from 'react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { cancelPolicy, previewCancellationRefund, type CancellationRefundPreview } from '../../services/supabase/ledgerRepo';
import { formatCents, parseMoneyCents } from '../../services/workflow/policies';
import { formatDateWithYear } from '../../services/workflow/dates';

/**
 * The account's agent (or an admin) cancels a policy / endorsement (0075): full or partial, the effective
 * date, why, and the cancellation notice if there is one. Full refunds the unused days of the term (worked out
 * by the database, 0077); partial asks for the net premium the carrier refunds. It applies right away — the
 * commission on the refund is taken back.
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
  // Full: the refund for the date chosen, as the database works it out.
  const [preview, setPreview] = useState<{ date: string; data: CancellationRefundPreview | null; error?: string } | null>(null);
  useEffect(() => {
    if (type !== 'full' || !date) return;
    let live = true;
    void previewCancellationRefund(transactionId, date).then((r) => {
      if (live) setPreview(r.ok ? { date, data: r.data } : { date, data: null, error: r.message });
    });
    return () => {
      live = false;
    };
  }, [type, date, transactionId]);
  const shown = type === 'full' && date && preview?.date === date ? preview : null;
  const nothingToRefund = !!shown?.data && shown.data.refundNetCents <= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!date) errs.push('Enter the cancellation’s effective date.');
    if (!reason.trim()) errs.push('Say why the policy is cancelled.');
    // Full: the unused days are refunded (worked out by the database). Partial: the amount entered.
    const cents = type === 'full' ? null : parseMoneyCents(refund);
    if (type === 'partial' && (cents === null || Number.isNaN(cents) || cents <= 0)) errs.push('Enter the net premium the carrier refunds, e.g. 4,000.00.');
    if (type === 'full' && nothingToRefund) errs.push('The policy has no unused days left on that date — nothing to refund.');
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
          <Button type="submit" form="cancel-request-form" disabled={saving || nothingToRefund}>{saving ? 'Cancelling…' : 'Cancel policy'}</Button>
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
            <div className="self-end pb-1 text-xs text-[var(--color-ink-600)]" data-field="full-refund">
              {!date ? (
                <p>Choose the effective date — the unused days are refunded.</p>
              ) : !shown ? (
                <p>Working out the refund…</p>
              ) : shown.error || !shown.data ? (
                <p className="text-[var(--color-danger-600)]">{shown.error ?? 'Could not work out the refund.'}</p>
              ) : nothingToRefund ? (
                <p className="text-[var(--color-danger-600)]">No unused days left on this date — nothing to refund.</p>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-ink-900)]">
                    Refund <span className="font-semibold tabular-nums" data-field="full-refund-amount">{formatCents(shown.data.refundNetCents)}</span>
                  </p>
                  <p>
                    {shown.data.unusedDays} of {shown.data.termDays} days unused ({formatDateWithYear(shown.data.termStart)} – {formatDateWithYear(shown.data.termEnd)}) · charged for {shown.data.termDays - shown.data.unusedDays} days
                  </p>
                </>
              )}
            </div>
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
