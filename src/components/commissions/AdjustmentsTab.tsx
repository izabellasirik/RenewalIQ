import { useState, type FormEvent } from 'react';
import { Undo2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { monthLabel, parseMoney } from '../../services/commissions/calc';
import { addAdjustment, reverseAdjustment, type Result, type SampleLedger } from '../../services/commissions/sampleLedger';
import { AssumptionFlag, ErrorList, Money, ProducerSelect } from './shared';

/** Manual adjustments: a reason is required, nothing is edited or deleted, a reversal is a new entry. */
export function AdjustmentsTab({ ledger, month, months, by, apply }: { ledger: SampleLedger; month: string; months: string[]; by: string; apply: (r: Result) => string[] }) {
  const [f, setF] = useState({ month, producerId: '', amount: '', reason: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [reversing, setReversing] = useState<string | null>(null);
  const name = (id: string) => ledger.producers.find((p) => p.id === id)?.name ?? '—';
  const reversedBy = new Map(ledger.adjustments.filter((a) => a.reversesId).map((a) => [a.reversesId!, a.id]));
  const list = [...ledger.adjustments].reverse();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = apply(addAdjustment(ledger, { month: f.month, producerId: f.producerId, amountCents: parseMoney(f.amount), reason: f.reason }, by));
    setErrors(errs);
    if (!errs.length) setF({ month: f.month, producerId: '', amount: '', reason: '' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">New adjustment</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">Changes a producer’s payout for one month <AssumptionFlag id="A8" /></p>
          </div>
        </CardHeader>
        <CardBody className="pt-4">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="adjustment-form">
            <ErrorList errors={errors} />
            <div>
              <label className={labelClass} htmlFor="adj-month">Statement month</label>
              <select id="adj-month" className={inputClass} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="adj-producer">Producer</label>
              <ProducerSelect id="adj-producer" producers={ledger.producers} value={f.producerId} onChange={(v) => setF({ ...f, producerId: v })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="adj-amount">Amount ($) — negative to deduct</label>
              <input id="adj-amount" inputMode="decimal" className={inputClass} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="e.g. 150.00 or -75.00" />
            </div>
            <div>
              <label className={labelClass} htmlFor="adj-reason">Reason — required, kept permanently</label>
              <textarea id="adj-reason" rows={3} className={inputClass} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Agreed one-off bonus for a referral" />
            </div>
            <Button type="submit">Record adjustment</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Adjustments</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">Never edited or deleted — a mistake is corrected with a reversing entry.</p>
          </div>
        </CardHeader>
        <CardBody className="pt-3">
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-ink-500)]">No adjustments yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-ink-100)]" data-testid="adjustments">
              {list.map((a) => {
                const reversed = reversedBy.get(a.id);
                return (
                  <li key={a.id} data-adj={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-[var(--color-ink-900)]">{a.id.toUpperCase()}</span>
                        <span className="text-[var(--color-ink-700)]">{name(a.producerId)}</span>
                        <span className="text-[var(--color-ink-400)]">· {monthLabel(a.month)}</span>
                        {a.reversesId && <Badge tone="neutral">Reverses {a.reversesId.toUpperCase()}</Badge>}
                        {reversed && <Badge tone="danger">Reversed by {reversed.toUpperCase()}</Badge>}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--color-ink-600)]">{a.reason}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">{a.by} · {a.at.slice(0, 16).replace('T', ' ')} UTC</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                      <Money cents={a.amountCents} strong className="text-base" />
                      {!a.reversesId && !reversed && (
                        <Button size="sm" variant="secondary" icon={<Undo2 size={13} />} onClick={() => setReversing(a.id)}>Reverse…</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <ReverseModal ledger={ledger} id={reversing} onClose={() => setReversing(null)} by={by} apply={apply} />
    </div>
  );
}

function ReverseModal({ ledger, id, onClose, by, apply }: { ledger: SampleLedger; id: string | null; onClose: () => void; by: string; apply: (r: Result) => string[] }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const a = ledger.adjustments.find((x) => x.id === id);
  const close = () => {
    setReason('');
    setErrors([]);
    onClose();
  };
  const confirm = () => {
    if (!id) return;
    const errs = apply(reverseAdjustment(ledger, id, reason, by));
    setErrors(errs);
    if (!errs.length) close();
  };
  return (
    <Modal
      open={!!a}
      onClose={close}
      title={a ? `Reverse ${a.id.toUpperCase()}?` : 'Reverse adjustment'}
      subtitle="Adds an opposite entry. The original stays in the history."
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="danger" onClick={confirm}>Reverse adjustment</Button>
        </>
      }
    >
      {a && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2">
            {ledger.producers.find((p) => p.id === a.producerId)?.name} · {monthLabel(a.month)} · <Money cents={a.amountCents} strong /> → a new entry of <Money cents={-a.amountCents} strong />
          </p>
          <ErrorList errors={errors} />
          <div>
            <label className={labelClass} htmlFor="reverse-reason">Why reverse it? (required)</label>
            <input id="reverse-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered against the wrong producer" />
          </div>
        </div>
      )}
    </Modal>
  );
}
