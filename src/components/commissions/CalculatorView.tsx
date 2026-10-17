import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, Plus, RotateCcw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '../ui';
import { inputClass, labelClass as baseLabel } from '../workspace/formStyles';
import { cn } from '../../utils/cn';
import { TRANSACTION_TYPES, calcLine, fmtPct, lineFor, monthLabel, parseMoney, parsePct, pctInput, statement, type TransactionType } from '../../services/commissions/calc';
import { SAMPLE_CARRIERS } from '../../services/commissions/sampleData';
import { addTransaction, type Result, type SampleLedger } from '../../services/commissions/sampleLedger';
import { AssumptionFlag, ErrorList, Money, TypeBadge } from './shared';

const NEW_ACCOUNT = '__new__';
// Labels with a ⚑ marker stay the same height as plain ones, so the inputs line up.
const labelClass = cn(baseLabel, 'flex min-h-5 items-center gap-1');
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The main Commissions screen: pick a producer and an account, enter premium, carrier commission %
 * and producer split, and see straight away what the producer earns and what the agency keeps.
 * "Add to <month>" records it in the sample ledger; the month so far is summarised underneath.
 */
export function CalculatorView({ ledger, month, by, apply, onOpen }: { ledger: SampleLedger; month: string; by: string; apply: (r: Result) => string[]; onOpen: (view: 'transactions') => void }) {
  // Accounts already in the sample, newest activity first, with what they were last written at.
  const accounts = useMemo(() => {
    const byName = new Map<string, (typeof ledger.transactions)[number]>();
    for (const t of [...ledger.transactions].sort((a, b) => a.date.localeCompare(b.date))) byName.set(t.account, t);
    return [...byName.values()].sort((a, b) => a.account.localeCompare(b.account));
  }, [ledger.transactions]);

  const [producerId, setProducerId] = useState('');
  const [account, setAccount] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const [type, setType] = useState<TransactionType>('new_business');
  const [premium, setPremium] = useState('');
  const [rate, setRate] = useState('');
  const [split, setSplit] = useState('');
  const [details, setDetails] = useState(false);
  const [date, setDate] = useState(() => (todayIso().startsWith(month) ? todayIso() : `${month}-01`));
  const [policy, setPolicy] = useState('');
  const [carrier, setCarrier] = useState(SAMPLE_CARRIERS[0]);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  // Switching the month moves new entries to it.
  useEffect(() => setDate(todayIso().startsWith(month) ? todayIso() : `${month}-01`), [month]);

  const producer = ledger.producers.find((p) => p.id === producerId);
  const p = parseMoney(premium);
  const r = parsePct(rate);
  const s = parsePct(split);
  const ready = p != null && p !== 0 && r != null && s != null;
  const signed = ready ? TRANSACTION_TYPES[type].sign * Math.abs(p!) : 0;
  const out = ready ? calcLine({ premiumCents: signed, rateMilli: r!, splitMilli: s! }) : null;
  const negative = TRANSACTION_TYPES[type].sign < 0;

  const chooseProducer = (id: string) => {
    setProducerId(id);
    const pr = ledger.producers.find((x) => x.id === id);
    if (pr) setSplit(pctInput(pr.splitMilli));
  };
  const chooseAccount = (value: string) => {
    setAccount(value);
    const last = accounts.find((a) => a.account === value);
    if (!last) return;
    // An existing account: suggest its producer, carrier, rate and policy from its latest line.
    if (!producerId) chooseProducer(last.producerId);
    setCarrier(last.carrier);
    setRate(pctInput(last.rateMilli));
    setPolicy(last.policy);
  };
  const clear = () => {
    setPremium('');
    setType('new_business');
    setErrors([]);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const name = account === NEW_ACCOUNT ? newAccount : account;
    const errs = apply(
      addTransaction(
        ledger,
        { date, account: name, policy: policy.trim() || `SMP-NEW-${ledger.nextId}`, carrier, type, premiumCents: p, rateMilli: r, producerId, splitMilli: split.trim() ? s : undefined },
        by
      )
    );
    setErrors(errs);
    if (!errs.length) {
      setLastAdded(`t${ledger.nextId}`);
      clear();
    }
  };

  const st = useMemo(() => statement(ledger, month), [ledger, month]);
  const recent = useMemo(() => ledger.transactions.filter((t) => t.month === month).map(lineFor).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id.slice(1)) - Number(a.id.slice(1))).slice(0, 5), [ledger, month]);
  const name = (id: string) => ledger.producers.find((x) => x.id === id)?.name ?? '—';
  const agentShare = out && out.gross !== 0 ? Math.min(100, Math.max(0, (out.agent / out.gross) * 100)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card>
          <CardHeader>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Calculate a commission</h2>
              <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">Choose a producer and an account, then enter the figures.</p>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="calculator">
              <ErrorList errors={errors} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="calc-producer">Producer</label>
                  <select id="calc-producer" className={inputClass} value={producerId} onChange={(e) => chooseProducer(e.target.value)}>
                    <option value="">Choose a producer…</option>
                    {ledger.producers.map((x) => (
                      <option key={x.id} value={x.id}>{x.name} · {fmtPct(x.splitMilli)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="calc-account">Account</label>
                  <select id="calc-account" className={inputClass} value={account} onChange={(e) => chooseAccount(e.target.value)}>
                    <option value="">Choose an account…</option>
                    {accounts.map((a) => (
                      <option key={a.account} value={a.account}>{a.account}</option>
                    ))}
                    <option value={NEW_ACCOUNT}>+ New account…</option>
                  </select>
                  {account === NEW_ACCOUNT && (
                    <input aria-label="New account name" className={cn(inputClass, 'mt-2')} value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name (fictional)" autoFocus />
                  )}
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="calc-type">Transaction <AssumptionFlag id="A2" /></label>
                <select id="calc-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
                  {Object.entries(TRANSACTION_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}{v.sign < 0 ? ' — takes commission back' : ''}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelClass} htmlFor="calc-premium">Premium ($) <AssumptionFlag id="A5" /></label>
                  <input id="calc-premium" inputMode="decimal" className={cn(inputClass, premium && (p == null || p === 0) && 'border-[var(--color-danger-500)]')} value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="e.g. 48000" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="calc-rate">Carrier commission %</label>
                  <input id="calc-rate" inputMode="decimal" className={cn(inputClass, rate && r == null && 'border-[var(--color-danger-500)]')} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 12.5" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="calc-split">Producer split %</label>
                  <input id="calc-split" inputMode="decimal" className={cn(inputClass, split && s == null && 'border-[var(--color-danger-500)]')} value={split} onChange={(e) => setSplit(e.target.value)} placeholder={producer ? pctInput(producer.splitMilli) : 'e.g. 40'} />
                </div>
              </div>
              {producer && s != null && s !== producer.splitMilli && (
                <p className="-mt-2 flex items-center gap-2 text-xs text-[var(--color-ink-500)]">
                  {producer.name}’s example split is {fmtPct(producer.splitMilli)}.
                  <button type="button" onClick={() => setSplit(pctInput(producer.splitMilli))} className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                    <RotateCcw size={11} aria-hidden /> Use it
                  </button>
                </p>
              )}

              <div>
                <button type="button" onClick={() => setDetails((d) => !d)} aria-expanded={details} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-ink-600)] hover:text-[var(--color-ink-900)] cursor-pointer">
                  <ChevronDown size={15} className={cn('transition-transform', details && 'rotate-180')} aria-hidden /> Date, policy and carrier
                </button>
                {details && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-3" data-testid="calc-details">
                    <div><label className={labelClass} htmlFor="calc-date">Effective date <AssumptionFlag id="A9" /></label><input id="calc-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></div>
                    <div><label className={labelClass} htmlFor="calc-policy">Policy number</label><input id="calc-policy" className={inputClass} value={policy} onChange={(e) => setPolicy(e.target.value)} placeholder="Added automatically" /></div>
                    <div><label className={labelClass} htmlFor="calc-carrier">Carrier</label><select id="calc-carrier" className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)}>{SAMPLE_CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-ink-100)] pt-4">
                <Button type="submit" icon={<Plus size={15} />}>Add to {monthLabel(date.slice(0, 7) || month)}</Button>
                <Button type="button" variant="ghost" onClick={clear}>Clear</Button>
                <span className="text-xs text-[var(--color-ink-400)]">Adds it to the sample ledger and the producer’s statement.</span>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card className="self-start lg:sticky lg:top-6" data-testid="calc-result">
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Result</h2>
            {negative && <span className="text-xs font-medium text-[var(--color-danger-600)]">Chargeback <AssumptionFlag id="A3" /></span>}
          </CardHeader>
          <CardBody className="pt-4" aria-live="polite">
            {out ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[var(--color-accent-100)] px-4 py-3">
                    <p className="truncate text-xs font-medium text-[var(--color-accent-600)]">{producer ? `${producer.name} earns` : 'Producer earns'}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink-900)]" data-result="earns"><Money cents={out.agent} /></p>
                  </div>
                  <div className="rounded-xl bg-[var(--color-success-100)] px-4 py-3">
                    <p className="text-xs font-medium text-[var(--color-success-600)]">Agency retained</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink-900)]" data-result="retained"><Money cents={out.retained} /></p>
                  </div>
                </div>
                <div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--color-ink-100)]" aria-hidden>
                    <div className="bg-[var(--color-accent-500)]" style={{ width: `${agentShare}%` }} />
                    <div className="bg-[var(--color-success-500)]" style={{ width: `${100 - agentShare}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--color-ink-500)]">{fmtPct(s!)} to the producer · {fmtPct(100_000 - s!)} to the agency</p>
                </div>
                <dl className="space-y-1.5 border-t border-[var(--color-ink-100)] pt-3 text-sm text-[var(--color-ink-600)]">
                  <div className="flex justify-between gap-3"><dt>Premium{negative ? ' (negative)' : ''}</dt><dd><Money cents={signed} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>× carrier commission {fmtPct(r!)}</dt><dd className="font-medium text-[var(--color-ink-900)]" data-result="gross">= <Money cents={out.gross} /> gross</dd></div>
                  <div className="flex justify-between gap-3"><dt>× producer split {fmtPct(s!)} <AssumptionFlag id="A1" /></dt><dd>= <Money cents={out.agent} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>Gross − producer earnings</dt><dd>= <Money cents={out.retained} /> retained</dd></div>
                </dl>
              </div>
            ) : (
              <p className="rounded-lg bg-[var(--color-ink-50)] px-4 py-8 text-center text-sm text-[var(--color-ink-500)]" data-testid="calc-empty">
                {premium && (p == null || p === 0) ? 'Enter the premium as a number, e.g. 48000.' : rate && r == null ? 'Enter the carrier commission as a percentage from 0 to 100.' : split && s == null ? 'Enter the split as a percentage from 0 to 100.' : 'Enter a premium, the carrier commission % and the producer split to see the result.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card data-testid="month-summary">
        <CardHeader className="flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink-900)]">{monthLabel(month)} so far</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">{st.rows.reduce((n, x) => n + x.lines.length, 0)} transactions in the sample ledger</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpen('transactions')}>View all transactions</Button>
        </CardHeader>
        <CardBody className="pt-4">
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            <SummaryFigure label="Gross commission" cents={st.totals.gross} id="gross" />
            <SummaryFigure label="Producer earnings" cents={st.totals.agent + st.totals.adjTotal} id="earnings" />
            <SummaryFigure label="Agency retained" cents={st.totals.retained} id="retained" />
          </dl>
          <ul className="mt-4 divide-y divide-[var(--color-ink-100)]" data-testid="recent">
            {recent.map((l) => (
              <li key={l.id} data-recent={l.id} className={cn('flex items-center justify-between gap-3 py-2.5 text-sm', l.id === lastAdded && 'rounded-lg bg-[var(--color-accent-100)]/60 px-2')}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-ink-900)]">{l.account}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-500)]">{name(l.producerId)} · <TypeBadge type={l.type} /></span>
                </span>
                <span className="shrink-0 text-right">
                  <Money cents={l.agent} strong />
                  <span className="block text-xs text-[var(--color-ink-400)]">of <Money cents={l.gross} /></span>
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryFigure({ label, cents, id }: { label: string; cents: number; id: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2.5">
      <dt className="text-[11px] font-medium text-[var(--color-ink-500)]">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold sm:text-lg" data-summary={id}><Money cents={cents} /></dd>
    </div>
  );
}
