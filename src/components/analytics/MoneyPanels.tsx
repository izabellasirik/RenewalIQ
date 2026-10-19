import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Modal, OverflowMenu } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAgentCommissionRates } from '../../hooks/useAgentCommission';
import { useMoneyEntries } from '../../hooks/useMoneyEntries';
import { useCarrierRates } from '../../hooks/useCarrierRates';
import { useLedger } from '../../hooks/useLedger';
import { formatShortDate, toLocalDateKey } from '../../services/workflow/dates';
import { centsInput, formatCents, policyRows } from '../../services/workflow/policies';
import { useRememberedView } from '../../hooks/useRememberedView';
import { aDateKey, aString, defined, oneOf } from '../../services/preferences/viewPreferences';
import { moneyReport, profitLossReport } from '../../services/reports/analyticsReports';
import { DownloadButtons } from './DownloadButtons';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  checkMoneyEntry,
  monthLabel,
  profitAndLoss,
  type CategoryTotal,
  type MoneyEntry,
  type MoneyFields,
  type MoneyInput,
  type MoneyKind,
} from '../../services/finance/money';
import { cn } from '../../utils/cn';

/**
 * Admin-only money views on Analytics: Profit & loss (income − expenses − agent commission, by month
 * and category; income includes the carrier commission on the policies) and Income & expenses (the
 * entries the admins record). Records only — nothing here moves money. The filters are remembered for
 * each admin and can be cleared.
 */

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'last_year' | 'all' | 'custom';
const PERIOD_LABELS: Record<Exclude<Period, 'custom'>, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  last_year: 'Last year',
  all: 'All dates',
};

function periodRange(p: Exclude<Period, 'custom'>, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const key = (d: Date) => toLocalDateKey(d);
  switch (p) {
    case 'this_month':
      return { from: key(new Date(y, m, 1)), to: key(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: key(new Date(y, q, 1)), to: key(new Date(y, q + 3, 0)) };
    }
    case 'this_year':
      return { from: key(new Date(y, 0, 1)), to: key(new Date(y, 11, 31)) };
    case 'last_year':
      return { from: key(new Date(y - 1, 0, 1)), to: key(new Date(y - 1, 11, 31)) };
    default:
      return { from: '', to: '' };
  }
}

/** The period (shared by both tabs), remembered for each admin. A link with ?period= / ?from= / ?to= sets it once. */
interface PeriodView {
  period: Period;
  from: string;
  to: string;
}
const PERIODS: Period[] = [...(Object.keys(PERIOD_LABELS) as Period[]), 'custom'];
const PERIOD_DEFAULTS: PeriodView = { period: 'this_year', from: '', to: '' };
const sanitizePeriod = (saved: Record<string, unknown>): Partial<PeriodView> => defined<PeriodView>({ period: oneOf(PERIODS)(saved.period), from: aDateKey(saved.from), to: aDateKey(saved.to) });

function usePeriod() {
  const [view, update, reset] = useRememberedView('analytics-period', PERIOD_DEFAULTS, sanitizePeriod);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.has('period') && !params.has('from') && !params.has('to')) return;
    const custom = params.has('from') || params.has('to');
    update(custom ? { period: 'custom', from: params.get('from') ?? '', to: params.get('to') ?? '' } : { period: oneOf(PERIODS)(params.get('period')) ?? 'this_year', from: '', to: '' });
    const n = new URLSearchParams(params);
    for (const k of ['period', 'from', 'to']) n.delete(k);
    setParams(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const preset = view.period;
  const range = preset === 'custom' ? { from: view.from, to: view.to } : periodRange(preset);
  const choose = (p: Period) => (p === 'custom' ? update({ period: 'custom', ...range }) : update({ period: p, from: '', to: '' }));
  const setFrom = (v: string) => update({ period: 'custom', from: v, to: range.to });
  const setTo = (v: string) => update({ period: 'custom', from: range.from, to: v });
  const changed = preset !== 'this_year';
  return { preset, ...range, choose, setFrom, setTo, changed, reset };
}

/** "Your filters are saved for next time · Clear filters". */
function SavedFiltersNote({ active, onClear, testId }: { active: boolean; onClear: () => void; testId: string }) {
  return (
    <p className="text-xs text-[var(--color-ink-500)]">
      {active ? 'Your filters are saved for next time.' : 'Filters you choose are saved for next time.'}
      {active && (
        <button type="button" onClick={onClear} className="ml-2 cursor-pointer font-medium text-[var(--color-brand-700)] hover:underline" data-testid={testId}>
          Clear filters
        </button>
      )}
    </p>
  );
}

function PeriodPicker({ period }: { period: ReturnType<typeof usePeriod> }) {
  return (
    <>
      <div>
        <label className={labelClass} htmlFor="mp-period">Period</label>
        <select id="mp-period" className={inputClass} value={period.preset} onChange={(e) => period.choose(e.target.value as Period)}>
          {(Object.keys(PERIOD_LABELS) as Exclude<Period, 'custom'>[]).map((p) => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
          <option value="custom">Custom dates</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="mp-from">From</label>
        <input id="mp-from" type="date" className={inputClass} value={period.from} onChange={(e) => period.setFrom(e.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="mp-to">To</label>
        <input id="mp-to" type="date" className={inputClass} value={period.to} onChange={(e) => period.setTo(e.target.value)} />
      </div>
    </>
  );
}

function Tile({ label, cents, id, tone, note }: { label: string; cents: number; id: string; tone?: 'good' | 'bad' | 'plain'; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]">
      <dt className="text-xs text-[var(--color-ink-500)]">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'good' ? 'text-[var(--color-success-600)]' : tone === 'bad' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-900)]'
        )}
        data-total={id}
      >
        {formatCents(cents)}
      </dd>
      {note && <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-400)]">{note}</p>}
    </div>
  );
}

function Unavailable({ message }: { message?: string }) {
  return (
    <Card>
      <CardBody className="pt-5 text-sm text-[var(--color-ink-600)]" data-testid="money-unavailable">
        {message ?? 'Income and expenses aren’t available right now.'}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────── Profit & loss ───────────────────────────────

export function ProfitLossPanel() {
  const period = usePeriod();
  const money = useMoneyEntries(true);
  const accounts = useAccountsStore((s) => s.accounts);
  const quotes = useAccountsStore((s) => s.quotes);
  const rates = useAgentCommissionRates();
  const rows = useMemo(() => policyRows(accounts, quotes), [accounts, quotes]);
  const carrier = useCarrierRates();
  const ledger = useLedger();
  const pl = useMemo(
    () => profitAndLoss(money.entries, rows, rates.rates, period.from, period.to, { carrier: { rateOn: carrier.rateOn, isSet: carrier.isSet }, ledger: ledger.data?.transactions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money.entries, rows, rates.rates, period.from, period.to, carrier.rows, ledger.data]
  );
  const [, setParams] = useSearchParams();

  return (
    <>
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[200px_170px_170px_1fr]">
            <PeriodPicker period={period} />
            <div className="flex justify-start lg:justify-end">
              <DownloadButtons report={() => profitLossReport(pl, period.from, period.to)} testId="pl-download" />
            </div>
          </div>
          <div className="mt-3">
            <SavedFiltersNote active={period.changed} onClear={period.reset} testId="pl-filters-clear" />
          </div>
        </CardBody>
      </Card>

      {money.status === 'unavailable' && <Unavailable message={money.message} />}

      {pl.recordedCarrierEntries > 0 && (
        <p className="rounded-lg border border-[var(--color-warning-600)]/30 bg-[var(--color-warning-100)] px-3 py-2 text-sm text-[var(--color-ink-700)]" role="status" data-testid="pl-recorded-carrier">
          {pl.recordedCarrierEntries === 1 ? '1 income entry' : `${pl.recordedCarrierEntries} income entries`} in this period {pl.recordedCarrierEntries === 1 ? 'is' : 'are'} recorded as carrier commission. Carrier commission on policies and endorsements is now added automatically, so {pl.recordedCarrierEntries === 1 ? 'it may be' : 'they may be'} counted twice. Check {pl.recordedCarrierEntries === 1 ? 'it' : 'them'} in Income &amp; expenses and remove or re-categorize {pl.recordedCarrierEntries === 1 ? 'it' : 'them'} if so.
        </p>
      )}

      <p className="text-xs text-[var(--color-ink-500)]" data-testid="pl-source">
        {pl.fromRecords
          ? `Carrier commission and agent commission are the amounts frozen in the commission records${pl.adjustmentCount ? `, ${pl.adjustmentCount} correction${pl.adjustmentCount === 1 ? '' : 's'} and cancellation${pl.adjustmentCount === 1 ? '' : 's'} included` : ''}.${pl.estimatedCount ? ` ${pl.estimatedCount} ${pl.estimatedCount === 1 ? 'policy isn’t' : 'policies aren’t'} recorded yet (historical) and ${pl.estimatedCount === 1 ? 'is' : 'are'} estimated with today’s rates.` : ''}`
          : 'Worked out from the policies and endorsements with the carrier rates on their bound dates (commission records need migration 0064).'}
      </p>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pl-totals">
        <Tile
          label="Income"
          cents={pl.incomeCents}
          id="income"
          note={`${formatCents(pl.carrierCents)} carrier commission + ${formatCents(pl.otherIncomeCents)} recorded${pl.carrierNotSetCount ? ` · ${pl.carrierNotSetCount} without a carrier % set` : ''}`}
        />
        <Tile label="Expenses" cents={pl.expenseCents} id="expenses" />
        <Tile label="Agent commission" cents={pl.commissionCents} id="commission" note={pl.commissionMissing ? `${pl.commissionMissing} ${pl.commissionMissing === 1 ? 'policy / endorsement' : 'policies / endorsements'} without an agent, a split or a carrier %` : 'Each agent’s split of the carrier commission, as recorded'} />
        <Tile label={pl.profitCents >= 0 ? 'Profit' : 'Loss'} cents={pl.profitCents} id="profit" tone={pl.profitCents > 0 ? 'good' : pl.profitCents < 0 ? 'bad' : 'plain'} note="Income − expenses − agent commission" />
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryCard title="Income by category" list={pl.income} total={pl.incomeCents} empty="No income recorded in this period." onAdd={() => setParams(new URLSearchParams({ view: 'money' }), { replace: true })} />
        <CategoryCard title="Expenses by category" list={pl.expenses} total={pl.expenseCents} empty="No expenses recorded in this period." onAdd={() => setParams(new URLSearchParams({ view: 'money' }), { replace: true })} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">By month</h3>
        </CardHeader>
        <CardBody className="pt-0">
          {pl.months.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-ink-500)]">Nothing in this period yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm" data-testid="pl-months">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-ink-400)]">
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Month</th>
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Carrier commission</th>
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Income</th>
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Expenses</th>
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Agent commission</th>
                    <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Profit / loss</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {pl.months.map((m) => (
                    <tr key={m.month} data-month={m.month}>
                      <td className="border-b border-[var(--color-ink-50)] px-3 py-2 text-[var(--color-ink-800)]">{monthLabel(m.month)}</td>
                      <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right text-[var(--color-ink-600)]">{formatCents(m.carrierCents)}</td>
                      <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right">{formatCents(m.incomeCents)}</td>
                      <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right">{formatCents(m.expenseCents)}</td>
                      <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right">{formatCents(m.commissionCents)}</td>
                      <td className={cn('whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right font-semibold', m.profitCents < 0 ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-900)]')}>{formatCents(m.profitCents)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-[var(--color-ink-900)]">
                    <td className="px-3 py-2">Total</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatCents(pl.carrierCents)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatCents(pl.incomeCents)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatCents(pl.expenseCents)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatCents(pl.commissionCents)}</td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right', pl.profitCents < 0 && 'text-[var(--color-danger-600)]')}>{formatCents(pl.profitCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-[var(--color-ink-500)]">
            Premium bound in this period: <span className="font-medium tabular-nums text-[var(--color-ink-700)]">{formatCents(pl.premiumNetCents)}</span> net. Income includes the carrier commission on it (each carrier’s %, set in Policies &amp; endorsements; none until set), and the agent commission is each agent’s split of it — so don’t also record either one by hand.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

function CategoryCard({ title, list, total, empty, onAdd }: { title: string; list: CategoryTotal[]; total: number; empty: string; onAdd: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{title}</h3>
      </CardHeader>
      <CardBody className="pt-0">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-sm text-[var(--color-ink-500)]">
            {empty}
            <button type="button" onClick={onAdd} className="font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
              Record income and expenses
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {list.map((c) => (
              <li key={c.category} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 leading-snug text-[var(--color-ink-700)]" title={c.category}>{c.category}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-ink-100)]">
                  <span className="block h-full rounded-full bg-[var(--color-brand-600)]" style={{ width: `${total ? Math.max(2, (c.cents / total) * 100) : 0}%` }} />
                </span>
                <span className="w-28 shrink-0 text-right font-medium tabular-nums text-[var(--color-ink-900)]">{formatCents(c.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────── Income & expenses ───────────────────────────────

const MONEY_VIEW_DEFAULTS: { kind: 'all' | MoneyKind; search: string } = { kind: 'all', search: '' };
const sanitizeMoneyView = (saved: Record<string, unknown>) => defined<typeof MONEY_VIEW_DEFAULTS>({ kind: oneOf<'all' | MoneyKind>(['all', 'income', 'expense'])(saved.kind), search: aString(saved.search) });

export function IncomeExpensesPanel() {
  const period = usePeriod();
  const money = useMoneyEntries(true);
  const [filters, updateFilters, resetFilters] = useRememberedView('analytics-money', MONEY_VIEW_DEFAULTS, sanitizeMoneyView);
  const { kind, search } = filters;
  const setKind = (k: 'all' | MoneyKind) => updateFilters({ kind: k });
  const setSearch = (q: string) => updateFilters({ search: q });
  const filtersActive = period.changed || kind !== 'all' || !!search;
  const [editing, setEditing] = useState<MoneyEntry | MoneyKind | null>(null);
  const [removing, setRemoving] = useState<MoneyEntry | null>(null);
  const [error, setError] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return money.entries
      .filter((e) => (!period.from || e.date >= period.from) && (!period.to || e.date <= period.to))
      .filter((e) => kind === 'all' || e.kind === kind)
      .filter((e) => !q || [e.category, e.description, e.notes].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [money.entries, period.from, period.to, kind, search]);
  const income = shown.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amountCents, 0);
  const expenses = shown.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amountCents, 0);

  return (
    <>
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[200px_170px_170px_160px_minmax(0,1fr)]">
            <PeriodPicker period={period} />
            <div>
              <label className={labelClass} htmlFor="mp-kind">Show</label>
              <select id="mp-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="all">All</option>
                <option value="income">Income</option>
                <option value="expense">Expenses</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="mp-search">Search</label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" aria-hidden />
                <input id="mp-search" className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Category, description or notes" />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <SavedFiltersNote
              active={filtersActive}
              onClear={() => {
                period.reset();
                resetFilters();
              }}
              testId="money-filters-clear"
            />
            <DownloadButtons
              report={() => moneyReport(shown, period.from, period.to, [kind !== 'all' ? `Show: ${kind === 'income' ? 'Income' : 'Expenses'}` : '', search ? `Search: “${search}”` : ''].filter(Boolean))}
              disabled={!shown.length}
              testId="money-download"
            />
          </div>
        </CardBody>
      </Card>

      {money.status === 'unavailable' ? (
        <Unavailable message={money.message} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="money-totals">
              <div className="flex gap-1.5">
                <dt className="text-[var(--color-ink-500)]">Income</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-ink-900)]" data-total="income">{formatCents(income)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[var(--color-ink-500)]">Expenses</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-ink-900)]" data-total="expenses">{formatCents(expenses)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Plus size={14} />} onClick={() => setEditing('income')}>
                Add income
              </Button>
              <Button icon={<Plus size={14} />} onClick={() => setEditing('expense')}>
                Add expense
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-danger-600)]" role="alert">{error}</p>}

          <Card>
            <CardBody className="pt-2">
              {money.status === 'loading' ? (
                <p className="py-8 text-center text-sm text-[var(--color-ink-500)]">Loading…</p>
              ) : money.entries.length === 0 ? (
                <EmptyState
                  icon={<Wallet size={26} strokeWidth={1.5} />}
                  title="No income or expenses recorded yet"
                  description="Record the money coming in (agency fees, contingency bonuses…) and going out (rent, marketing, payroll…). Carrier commission on policies is added to Profit & loss automatically. Only the agency’s admins can see them."
                />
              ) : shown.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-ink-500)]">Nothing matches these filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm" data-testid="money-table">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-ink-400)]">
                        <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Date</th>
                        <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Category</th>
                        <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Description</th>
                        <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Amount</th>
                        <th className="border-b border-[var(--color-ink-100)] px-3 py-2" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((e) => (
                        <tr key={e.id} data-entry={e.id} data-kind={e.kind}>
                          <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-[var(--color-ink-700)]">{formatShortDate(e.date)}</td>
                          <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2">
                            <span className={cn('mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', e.kind === 'income' ? 'bg-[var(--color-success-100)] text-[var(--color-success-600)]' : 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]')}>
                              {e.kind === 'income' ? 'Income' : 'Expense'}
                            </span>
                            <span className="text-[var(--color-ink-800)]">{e.category}</span>
                          </td>
                          <td className="min-w-[220px] border-b border-[var(--color-ink-50)] px-3 py-2 text-[var(--color-ink-700)]">
                            {e.description || <span className="text-[var(--color-ink-400)]">—</span>}
                            {e.notes && <span className="mt-0.5 block whitespace-pre-line text-xs text-[var(--color-ink-500)]">{e.notes}</span>}
                          </td>
                          <td className={cn('whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right font-semibold tabular-nums', e.kind === 'income' ? 'text-[var(--color-success-600)]' : 'text-[var(--color-ink-900)]')}>
                            {e.kind === 'income' ? '+' : '−'}
                            {formatCents(e.amountCents)}
                          </td>
                          <td className="w-10 border-b border-[var(--color-ink-50)] px-1 py-1 text-right">
                            <OverflowMenu
                              items={[
                                { key: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => setEditing(e) },
                                { key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => setRemoving(e) },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {editing && (
        <MoneyForm
          key={typeof editing === 'string' ? editing : editing.id}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(fields, id) => money.save(fields, id)}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const err = await money.remove(removing.id);
          setError(err ?? '');
          setRemoving(null);
        }}
        title={`Delete this ${removing?.kind === 'income' ? 'income' : 'expense'}?`}
        description={`${removing?.category ?? ''} ${removing ? formatCents(removing.amountCents) : ''} on ${removing ? formatShortDate(removing.date) : ''} is removed from the agency’s records.`}
        confirmLabel="Delete"
      />
    </>
  );
}

function MoneyForm({ editing, onClose, onSave }: { editing: MoneyEntry | MoneyKind; onClose: () => void; onSave: (fields: MoneyFields, id?: string) => Promise<string | null> }) {
  const existing = typeof editing === 'string' ? null : editing;
  const [f, setF] = useState<MoneyInput>(() =>
    existing
      ? { kind: existing.kind, date: existing.date, category: existing.category, description: existing.description, amount: centsInput(existing.amountCents), notes: existing.notes }
      : { kind: editing as MoneyKind, date: '', category: '', description: '', amount: '', notes: '' }
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const categories = f.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const set = <K extends keyof MoneyInput>(k: K, v: MoneyInput[K]) => setF((cur) => ({ ...cur, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = checkMoneyEntry(f);
    if (!check.ok) return setErrors(check.errors);
    setSaving(true);
    const err = await onSave(check.fields, existing?.id);
    setSaving(false);
    if (err) return setErrors([err]);
    onClose();
  }
  const noun = f.kind === 'income' ? 'income' : 'expense';

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit ${noun}` : `Add ${noun}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="money-form" disabled={saving}>{existing ? 'Save changes' : `Add ${noun}`}</Button>
        </>
      }
    >
      <form id="money-form" onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="money-form">
        {errors.length > 0 && (
          <ul className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">
            {errors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="money-date">Date</label>
            <input id="money-date" type="date" className={inputClass} value={f.date} onChange={(e) => set('date', e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelClass} htmlFor="money-amount">Amount ($)</label>
            <input id="money-amount" inputMode="decimal" className={inputClass} value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="2,500.00" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="money-category">Category</label>
            <input id="money-category" className={inputClass} value={f.category} onChange={(e) => set('category', e.target.value)} list="money-categories" placeholder={f.kind === 'income' ? 'e.g. Agency fees' : 'e.g. Rent'} />
            <datalist id="money-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            {f.kind === 'income' && <p className="mt-1 text-xs text-[var(--color-ink-500)]">Carrier commission on policies and endorsements is added to Profit &amp; loss automatically — don’t record it here.</p>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button key={c} type="button" onClick={() => set('category', c)} className={cn('rounded-full border px-2.5 py-0.5 text-xs cursor-pointer', f.category === c ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white' : 'border-[var(--color-ink-200)] text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="money-description">Description</label>
            <input id="money-description" className={inputClass} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={f.kind === 'income' ? 'e.g. October statement' : 'e.g. October office rent'} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="money-notes">Notes</label>
            <textarea id="money-notes" rows={2} className={inputClass} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
