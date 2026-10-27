import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FilePlus2, Paperclip, X } from 'lucide-react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { cancelPolicy, previewCancellationRefund, type CancellationRefundPreview } from '../../services/supabase/ledgerRepo';
import { centsInput, formatCents, parseMoneyCents } from '../../services/workflow/policies';

/**
 * The account's agent (or an admin) cancels a policy / endorsement (0075): full or partial, the effective
 * date, the net premium refunded, why, and the cancellation document if there is one. Full fills in the
 * unused days of the term (worked out by the database, 0077) and the agent can change it to the carrier's
 * amount; partial asks for the amount. It applies right away — the commission on the refund is taken back.
 */
export function CancellationRequestDialog({ accountId, transactionId, policyLabel, onClose, onSent }: { accountId: string; transactionId: string; policyLabel: string; onClose: () => void; onSent: () => void }) {
  const addPlainDocument = useAccountsStore((s) => s.addPlainDocument);
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<'full' | 'partial'>('partial');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [partialRefund, setPartialRefund] = useState('');
  // Full: null = the worked-out refund; otherwise what the agent typed instead.
  const [fullRefund, setFullRefund] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
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
  const calculated = shown?.data ? shown.data.refundNetCents : null;
  const refundValue = type === 'partial' ? partialRefund : (fullRefund ?? (calculated ? centsInput(calculated) : ''));
  const typedCents = fullRefund === null ? null : parseMoneyCents(fullRefund);
  const differs = calculated !== null && calculated > 0 && fullRefund !== null && typedCents !== calculated;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!date) errs.push('Enter the cancellation’s effective date.');
    if (!reason.trim()) errs.push('Say why the policy is cancelled.');
    // Full: the worked-out refund (null → the database works it out) unless the agent typed another amount.
    const cents = type === 'full' && fullRefund === null ? null : parseMoneyCents(refundValue);
    if (type === 'full' && fullRefund === null && calculated === 0) errs.push('The policy has no unused days left on that date — enter the refund if there is one.');
    else if ((type === 'partial' || fullRefund !== null) && (cents === null || Number.isNaN(cents) || cents <= 0)) errs.push('Enter the net premium the carrier refunds, e.g. 4,000.00.');
    if (errs.length) return setErrors(errs);
    setSaving(true);
    const docIds: string[] = [];
    for (const f of files) {
      const id = await addPlainDocument(accountId, f);
      if (!id) {
        setSaving(false);
        return setErrors([`${f.name} couldn’t be uploaded. Try again, or cancel without it and upload it in Checklist & Documents later.`]);
      }
      docIds.push(id);
    }
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
              {t === 'full' ? 'Full' : 'Partial'}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="cancel-date">Effective date</label>
            <input id="cancel-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="cancel-refund">Refund (net, $)</label>
            <input
              id="cancel-refund"
              inputMode="decimal"
              className={`${inputClass} tabular-nums`}
              value={refundValue}
              onChange={(e) => (type === 'partial' ? setPartialRefund(e.target.value) : setFullRefund(e.target.value))}
              placeholder={type === 'full' && !date ? 'Choose the date first' : 'e.g. 4,000.00'}
            />
            {type === 'full' && shown && (
              <p className="mt-1 text-xs text-[var(--color-ink-600)]" data-field="full-refund">
                {shown.error || !shown.data ? (
                  <span className="text-[var(--color-danger-600)]">{shown.error ?? 'Could not work out the refund.'}</span>
                ) : (
                  <>
                    {shown.data.unusedDays} of {shown.data.termDays} days unused
                    {differs && (
                      <>
                        {' · '}
                        <button type="button" className="cursor-pointer font-medium text-[var(--color-brand-700)] hover:underline" onClick={() => setFullRefund(null)}>
                          Use {formatCents(calculated)}
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="cancel-reason">Reason</label>
          <textarea id="cancel-reason" rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two units sold; client moved coverage" />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-1.5 text-[var(--color-ink-700)]">
              <Paperclip size={13} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
              <span className="truncate">{f.name}</span>
              <button type="button" className="cursor-pointer p-0.5 text-[var(--color-ink-400)] hover:text-[var(--color-danger-600)]" aria-label={`Remove ${f.name}`} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex w-fit cursor-pointer items-center gap-1.5 font-medium text-[var(--color-brand-700)] hover:underline">
            <FilePlus2 size={14} aria-hidden /> Attach cancellation document
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            data-testid="cancel-file"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((list) => [...list, ...picked]);
              e.target.value = '';
            }}
          />
        </div>
      </form>
    </Modal>
  );
}
