import { useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { cn } from '../../utils/cn';
import { TRANSACTION_TYPES, fmtPct, lineFor, moneyInput, monthLabel, parseMoney, parsePct, pctInput, type TransactionType } from '../../services/commissions/calc';
import { SAMPLE_CARRIERS } from '../../services/commissions/sampleData';
import { addTransaction, editTransaction, setDefaultSplit, type Result, type SampleLedger } from '../../services/commissions/sampleLedger';
import { AssumptionFlag, ErrorList, InlineNumber, Money, ProducerSelect, TypeBadge } from './shared';

// The desktop table is dense (ten columns, three editable), so its cells are a little tighter than elsewhere.
const thT = thClass.replace('px-3', 'px-2');
const tdT = tdClass.replace('px-3', 'px-2');
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
import { tdClass, thClass } from './commissionsUi';

/** One month's transactions: premium, commission % and split are editable; every change is audited. */
export function TransactionsTab({ ledger, month, by, apply }: { ledger: SampleLedger; month: string; by: string; apply: (r: Result) => string[] }) {
  const [adding, setAdding] = useState(false);
  const lines = useMemo(() => ledger.transactions.filter((t) => t.month === month).map(lineFor).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), [ledger, month]);
  const tot = (k: 'signedPremiumCents' | 'gross' | 'agent' | 'retained') => lines.reduce((s, l) => s + l[k], 0);
  const name = (id: string) => ledger.producers.find((p) => p.id === id)?.name ?? '—';
  const edit = (id: string, field: 'premium' | 'rate' | 'split', raw: string) => apply(editTransaction(ledger, id, field, field === 'premium' ? parseMoney(raw) : parsePct(raw), by)).length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Transactions · {monthLabel(month)}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">
              Edit a premium, carrier commission % or split and the line recalculates. Each change is recorded in the audit history.
            </p>
          </div>
          <Button icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add transaction</Button>
        </CardHeader>
        <CardBody className="px-0 pb-0 pt-4">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-sm" data-testid="transactions">
              <thead className="border-y border-[var(--color-ink-100)] bg-[var(--color-ink-50)]">
                <tr>
                  <th className={cn(thT, 'pl-5')}>Date · type <AssumptionFlag id="A9" /></th>
                  <th className={thT}>Account / policy</th>
                  <th className={cn(thT, 'text-right')}>Premium</th>
                  <th className={cn(thT, 'text-right')}>Carrier %</th>
                  <th className={cn(thT, 'text-right')}>Split %</th>
                  <th className={cn(thT, 'text-right')}>Gross</th>
                  <th className={cn(thT, 'text-right')}>Payout</th>
                  <th className={cn(thT, 'pr-5 text-right')} title="Agency retained = gross − payout">Retained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-ink-100)]">
                {lines.map((l) => (
                  <tr key={l.id} data-tx={l.id} className={cn(l.gross < 0 && 'bg-[var(--color-danger-100)]/35')}>
                    <td className={cn(tdT, 'whitespace-nowrap pl-5')}>
                      <p className="text-[var(--color-ink-500)]" title={l.date}>{shortDate(l.date)}</p>
                      <div className="mt-1"><TypeBadge type={l.type} /></div>
                    </td>
                    <td className={cn(tdT, 'min-w-[150px]')}>
                      <p className="font-medium text-[var(--color-ink-900)]">{l.account}</p>
                      <p className="text-xs text-[var(--color-ink-500)]" title={l.carrier}>{name(l.producerId)} <span className="text-[var(--color-ink-400)]">· {l.policy}</span></p>
                    </td>
                    <td className={cn(tdT, 'text-right')}>
                      <InlineNumber label={`Premium for ${l.policy} on ${l.date}`} value={moneyInput(l.premiumCents)} onCommit={(v) => edit(l.id, 'premium', v)} width="w-24" />
                    </td>
                    <td className={cn(tdT, 'text-right')}><InlineNumber label={`Carrier commission % for ${l.policy} on ${l.date}`} value={pctInput(l.rateMilli)} onCommit={(v) => edit(l.id, 'rate', v)} width="w-14" /></td>
                    <td className={cn(tdT, 'text-right')}><InlineNumber label={`Split % for ${l.policy} on ${l.date}`} value={pctInput(l.splitMilli)} onCommit={(v) => edit(l.id, 'split', v)} width="w-14" /></td>
                    <td className={cn(tdT, 'text-right')} data-cell="gross"><Money cents={l.gross} /></td>
                    <td className={cn(tdT, 'text-right')} data-cell="agent"><Money cents={l.agent} strong /></td>
                    <td className={cn(tdT, 'pr-5 text-right')} data-cell="retained"><Money cents={l.retained} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[var(--color-ink-200)] bg-[var(--color-ink-50)] font-semibold">
                <tr>
                  <td className={cn(tdT, 'pl-5')} colSpan={2}>Totals · {lines.length} transactions</td>
                  <td className={cn(tdT, 'text-right')}><Money cents={tot('signedPremiumCents')} /></td>
                  <td className={tdT} />
                  <td className={tdT} />
                  <td className={cn(tdT, 'text-right')} data-total="gross"><Money cents={tot('gross')} /></td>
                  <td className={cn(tdT, 'text-right')} data-total="agent"><Money cents={tot('agent')} /></td>
                  <td className={cn(tdT, 'pr-5 text-right')} data-total="retained"><Money cents={tot('retained')} /></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone cards */}
          <ul className="divide-y divide-[var(--color-ink-100)] border-t border-[var(--color-ink-100)] xl:hidden" data-testid="transactions-mobile">
            {lines.map((l) => (
              <li key={l.id} data-tx-card={l.id} className={cn('px-5 py-4', l.gross < 0 && 'bg-[var(--color-danger-100)]/35')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--color-ink-900)]">{l.account}</p>
                    <p className="text-xs text-[var(--color-ink-400)]">{l.date} · {l.policy}</p>
                    <p className="text-xs text-[var(--color-ink-500)]">{name(l.producerId)}</p>
                  </div>
                  <TypeBadge type={l.type} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-500)]">
                  <label className="flex flex-col gap-1">Premium<InlineNumber label={`Premium for ${l.policy} on ${l.date}`} value={moneyInput(l.premiumCents)} onCommit={(v) => edit(l.id, 'premium', v)} width="w-full" /></label>
                  <label className="flex flex-col gap-1">Carrier %<InlineNumber label={`Carrier commission % for ${l.policy} on ${l.date}`} value={pctInput(l.rateMilli)} onCommit={(v) => edit(l.id, 'rate', v)} width="w-full" /></label>
                  <label className="flex flex-col gap-1">Split %<InlineNumber label={`Split % for ${l.policy} on ${l.date}`} value={pctInput(l.splitMilli)} onCommit={(v) => edit(l.id, 'split', v)} width="w-full" /></label>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-[var(--color-ink-400)]">Gross</dt><dd><Money cents={l.gross} /></dd></div>
                  <div><dt className="text-xs text-[var(--color-ink-400)]">Payout</dt><dd><Money cents={l.agent} strong /></dd></div>
                  <div><dt className="text-xs text-[var(--color-ink-400)]">Agency</dt><dd><Money cents={l.retained} /></dd></div>
                </dl>
              </li>
            ))}
            <li className="flex justify-between bg-[var(--color-ink-50)] px-5 py-3 text-sm font-semibold">
              <span>Totals</span>
              <span className="text-right">Gross <Money cents={tot('gross')} /> · Payout <Money cents={tot('agent')} /></span>
            </li>
          </ul>
        </CardBody>
      </Card>
      <p className="-mt-3 text-xs text-[var(--color-ink-500)]">
        Red lines are cancellations and return premium: they take commission back from the producer and from the agency <AssumptionFlag id="A2" /> <AssumptionFlag id="A3" />
      </p>

      <Card>
        <CardHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Example producer splits <AssumptionFlag id="A7" /></h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">Fictional example rates, used for transactions added from now on. Existing lines keep the split they were entered with.</p>
          </div>
        </CardHeader>
        <CardBody className="pt-3">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="default-splits">
            {ledger.producers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
                <span className="text-sm font-medium text-[var(--color-ink-800)]">
                  {p.name}
                </span>
                <InlineNumber label={`Default split for ${p.name}`} value={pctInput(p.splitMilli)} onCommit={(v) => apply(setDefaultSplit(ledger, p.id, parsePct(v), by)).length === 0} width="w-16" suffix="%" />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <AddTransactionModal open={adding} onClose={() => setAdding(false)} ledger={ledger} month={month} by={by} apply={apply} />
    </div>
  );
}

function AddTransactionModal({ open, onClose, ledger, month, by, apply }: { open: boolean; onClose: () => void; ledger: SampleLedger; month: string; by: string; apply: (r: Result) => string[] }) {
  const blank = { date: `${month}-20`, account: '', policy: '', carrier: SAMPLE_CARRIERS[0], type: 'endorsement_add' as TransactionType, premium: '', rate: '', producerId: '', split: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const producer = ledger.producers.find((p) => p.id === f.producerId);
  const close = () => {
    setF(blank);
    setErrors([]);
    onClose();
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const errs = apply(
      addTransaction(ledger, { date: f.date, account: f.account, policy: f.policy, carrier: f.carrier, type: f.type, premiumCents: parseMoney(f.premium), rateMilli: parsePct(f.rate), producerId: f.producerId, splitMilli: f.split.trim() ? parsePct(f.split) : undefined }, by)
    );
    setErrors(errs);
    if (!errs.length) close();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a sample transaction"
      subtitle="Fictional entries only. Cancellations and return premium are made negative automatically."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={() => submit()}>Add transaction</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2" data-testid="add-transaction">
        <div className="sm:col-span-2"><ErrorList errors={errors} /></div>
        <div><label className={labelClass} htmlFor="tx-date">Effective date</label><input id="tx-date" type="date" className={inputClass} value={f.date} onChange={set('date')} /></div>
        <div><label className={labelClass} htmlFor="tx-type">Type</label><select id="tx-type" className={inputClass} value={f.type} onChange={set('type')}>{Object.entries(TRANSACTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="tx-account">Account (fictional)</label><input id="tx-account" className={inputClass} value={f.account} onChange={set('account')} placeholder="e.g. Sample Freight LLC" /></div>
        <div><label className={labelClass} htmlFor="tx-policy">Policy number</label><input id="tx-policy" className={inputClass} value={f.policy} onChange={set('policy')} placeholder="e.g. SMP-AL-24099" /></div>
        <div className="sm:col-span-2"><label className={labelClass} htmlFor="tx-carrier">Carrier</label><select id="tx-carrier" className={inputClass} value={f.carrier} onChange={set('carrier')}>{SAMPLE_CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className={labelClass} htmlFor="tx-premium">Premium ($)</label><input id="tx-premium" inputMode="decimal" className={inputClass} value={f.premium} onChange={set('premium')} placeholder="e.g. 3500" /></div>
        <div><label className={labelClass} htmlFor="tx-rate">Carrier commission %</label><input id="tx-rate" inputMode="decimal" className={inputClass} value={f.rate} onChange={set('rate')} placeholder="e.g. 12.5" /></div>
        <div><label className={labelClass} htmlFor="tx-producer">Producer</label><ProducerSelect id="tx-producer" producers={ledger.producers} value={f.producerId} onChange={(v) => setF((x) => ({ ...x, producerId: v }))} /></div>
        <div><label className={labelClass} htmlFor="tx-split">Split % {producer ? <span className="font-normal text-[var(--color-ink-400)]">(blank = {fmtPct(producer.splitMilli)})</span> : ''}</label><input id="tx-split" inputMode="decimal" className={inputClass} value={f.split} onChange={set('split')} placeholder={producer ? pctInput(producer.splitMilli) : 'producer’s default'} /></div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
