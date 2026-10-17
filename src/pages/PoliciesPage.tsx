import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { FileCheck2, Search } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Card, CardBody, EmptyState } from '../components/ui';
import { inputClass, labelClass } from '../components/workspace/formStyles';
import { useAccountsStore } from '../state/useAccountsStore';
import { COVERAGE_LABELS } from '../types';
import { formatShortDate } from '../services/workflow/dates';
import {
  DATE_PRESET_LABELS,
  POLICY_DATE_LABELS,
  filterPolicies,
  formatCents,
  policiesFeatureEnabled,
  policyRows,
  policyTotalCents,
  policyTotals,
  presetRange,
  type DatePreset,
  type PolicyDateField,
  type PolicyRow,
} from '../services/workflow/policies';

const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 align-top text-sm text-[var(--color-ink-800)]';
const num = 'text-right tabular-nums';
const DATE_FIELDS = Object.keys(POLICY_DATE_LABELS) as PolicyDateField[];
const PRESETS = Object.keys(DATE_PRESET_LABELS) as DatePreset[];

/**
 * Every policy bound from Markets & Quotes, across the accounts this user can open, filtered by date
 * (Carrier 103 Phase 1). Reads only what the app already has — nothing new is fetched, nothing about
 * commission is shown. The filter lives in the URL so a filtered list can be bookmarked or shared.
 */
export function PoliciesPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const quotes = useAccountsStore((s) => s.quotes);
  const [params, setParams] = useSearchParams();
  const dateField = (DATE_FIELDS as string[]).includes(params.get('date') ?? '') ? (params.get('date') as PolicyDateField) : 'boundDate';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [search, setSearch] = useState('');
  const all = useMemo(() => policyRows(accounts, quotes), [accounts, quotes]);
  const rows = useMemo(() => filterPolicies(all, { dateField, from, to, search }), [all, dateField, from, to, search]);
  const totals = policyTotals(rows);
  const preset = PRESETS.find((p) => p !== 'all' && presetRange(p).from === from && presetRange(p).to === to) ?? (from || to ? 'custom' : 'all');

  if (!policiesFeatureEnabled()) return <Navigate to="/" replace />;

  const update = (patch: Record<string, string>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v) n.set(k, v);
        else n.delete(k);
      }
      return n;
    }, { replace: true });

  return (
    <PageContainer title="Policies" description="Every policy bound from Markets & Quotes — filter by bound, effective or expiration date.">
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[160px_170px_150px_150px_minmax(0,1fr)]" data-testid="policy-filters">
            <div>
              <label className={labelClass} htmlFor="pf-field">Date</label>
              <select id="pf-field" className={inputClass} value={dateField} onChange={(e) => update({ date: e.target.value === 'boundDate' ? '' : e.target.value })}>
                {DATE_FIELDS.map((f) => <option key={f} value={f}>{POLICY_DATE_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-preset">Period</label>
              <select id="pf-preset" className={inputClass} value={preset} onChange={(e) => update(e.target.value === 'custom' ? {} : presetRange(e.target.value as DatePreset))}>
                {PRESETS.map((p) => <option key={p} value={p}>{DATE_PRESET_LABELS[p]}</option>)}
                {preset === 'custom' && <option value="custom">Custom dates</option>}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-from">From</label>
              <input id="pf-from" type="date" className={inputClass} value={from} onChange={(e) => update({ from: e.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-to">To</label>
              <input id="pf-to" type="date" className={inputClass} value={to} onChange={(e) => update({ to: e.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-search">Search</label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" aria-hidden />
                <input id="pf-search" className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Insured, policy number or carrier" />
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="policy-totals">
        <Stat label="Policies" value={String(totals.count)} id="count" />
        <Stat label="Net premium" value={formatCents(totals.netPremiumCents)} id="net" />
        <Stat label="Taxes" value={formatCents(totals.taxesCents)} id="taxes" />
        <Stat label="Fees" value={formatCents(totals.feesCents)} id="fees" />
        <Stat label="Total" value={formatCents(totals.totalCents)} id="total" strong />
      </dl>

      <Card>
        <CardBody className="pt-2">
          {all.length === 0 ? (
            <EmptyState
              icon={<FileCheck2 size={26} strokeWidth={1.5} />}
              title="No policies yet"
              description="When a market is bound, open the account’s Markets & Quotes and choose “Add policy” to record the policy number, dates, and net premium, taxes and fees."
            />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-ink-500)]" data-testid="policies-none">No policies match these dates or this search.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-[var(--color-ink-100)] md:hidden" data-testid="policy-cards">
                {rows.map((r) => (
                  <li key={r.policy.id} className="py-3">
                    <PolicyLink row={r} />
                    <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{describe(r)}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-600)]">
                      Bound {formatShortDate(r.policy.boundDate)} · Term {formatShortDate(r.policy.effectiveDate)} – {formatShortDate(r.policy.expirationDate)}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="font-semibold tabular-nums">{formatCents(policyTotalCents(r.policy))}</span>
                      <span className="text-xs text-[var(--color-ink-500)]"> · net {formatCents(r.policy.netPremiumCents)}, taxes {formatCents(r.policy.taxesCents)}, fees {formatCents(r.policy.feesCents)}</span>
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full border-collapse" data-testid="policy-table">
                  <thead>
                    <tr>
                      <th className={th}>Insured / policy</th>
                      <th className={th}>Carrier · coverage</th>
                      <th className={th}>Bound</th>
                      <th className={th}>Term</th>
                      <th className={`${th} ${num}`}>Net premium</th>
                      <th className={`${th} ${num}`}>Taxes</th>
                      <th className={`${th} ${num}`}>Fees</th>
                      <th className={`${th} ${num}`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.policy.id} data-row={r.policy.id}>
                        <td className={td}>
                          <PolicyLink row={r} />
                        </td>
                        <td className={td}>
                          <span className="block">{r.policy.carrier}</span>
                          <span className="block text-xs text-[var(--color-ink-500)]">{[r.policy.coverage ? COVERAGE_LABELS[r.policy.coverage] : null, r.policy.businessType === 'renewal' ? 'Renewal' : 'New business'].filter(Boolean).join(' · ')}</span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{formatShortDate(r.policy.boundDate)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {formatShortDate(r.policy.effectiveDate)} – {formatShortDate(r.policy.expirationDate)}
                        </td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.netPremiumCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.taxesCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.feesCents)}</td>
                        <td className={`${td} ${num} font-semibold`}>{formatCents(policyTotalCents(r.policy))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}

function describe(r: PolicyRow): string {
  return [r.policy.carrier, r.policy.coverage ? COVERAGE_LABELS[r.policy.coverage] : null, r.policy.businessType === 'renewal' ? 'Renewal' : 'New business'].filter(Boolean).join(' · ');
}

function PolicyLink({ row }: { row: PolicyRow }) {
  return (
    <span className="block">
      <Link to={`/accounts/${row.accountId}?tab=quotes&quote=${row.quoteId}`} className="font-medium text-[var(--color-brand-800)] hover:underline">
        {row.insured}
      </Link>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-500)]">
        {row.policy.policyNumber ?? <Badge tone="warning">Number to come</Badge>}
        {!row.marketBound && <Badge tone="warning">Market no longer Bound</Badge>}
      </span>
    </span>
  );
}

function Stat({ label, value, id, strong }: { label: string; value: string; id: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]">
      <dt className="text-xs text-[var(--color-ink-500)]">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? 'text-lg font-semibold text-[var(--color-ink-900)]' : 'text-base font-semibold text-[var(--color-ink-800)]'}`} data-total={id}>
        {value}
      </dd>
    </div>
  );
}
