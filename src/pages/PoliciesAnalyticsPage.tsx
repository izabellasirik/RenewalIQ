import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, FileWarning, Paperclip, Search } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Card, CardBody, EmptyState, Tabs } from '../components/ui';
import { IncomeExpensesPanel, ProfitLossPanel } from '../components/analytics/MoneyPanels';
import { inputClass, labelClass } from '../components/workspace/formStyles';
import { formatRate } from '../components/workspace/PoliciesSection';
import { useAccountsStore } from '../state/useAccountsStore';
import { useAgentCommissionRates } from '../hooks/useAgentCommission';
import { formatShortDate } from '../services/workflow/dates';
import {
  DATE_PRESET_LABELS,
  POLICY_DATE_LABELS,
  agentCommissionCents,
  entryKind,
  filterPolicies,
  formatCents,
  policyRows,
  policyTotalCents,
  presetRange,
  type DatePreset,
  type PolicyDateField,
  type PolicyRow,
} from '../services/workflow/policies';

const th = 'whitespace-nowrap border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 align-top text-sm text-[var(--color-ink-800)]';
const num = 'whitespace-nowrap text-right tabular-nums';
const DATE_FIELDS = Object.keys(POLICY_DATE_LABELS) as PolicyDateField[];
const PRESETS = Object.keys(DATE_PRESET_LABELS) as DatePreset[];
type KindFilter = 'all' | 'policy' | 'endorsement';
const ALL_AGENTS = '';

/**
 * Analytics: the money on bound and endorsed markets. Every policy and endorsement recorded in Markets
 * & Quotes, with their net, taxes, fees and totals, the agent commission, and whether the proof
 * document is there — filtered by bound / endorsed, effective or expiration date, and searchable.
 * An agency admin sees every client; an agent sees only the clients assigned to them (and only
 * their own commission). Reads what the app already has; commission comes from the agency's rates,
 * which the database shows only to admins and to each agent for themselves. The filter lives in the URL.
 */
export function PoliciesAnalyticsPage() {
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const isAdmin = agencyAccess?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const view = isAdmin ? (['pl', 'policies', 'money'].includes(params.get('view') ?? '') ? (params.get('view') as string) : 'pl') : 'policies';
  return (
    <PageContainer
      title="Analytics"
      description={
        isAdmin
          ? 'The agency’s money: profit and loss, the policies and endorsements written, and the income and expenses you record.'
          : 'The policies and endorsements of the clients assigned to you, and your commission on them.'
      }
    >
      {isAdmin && (
        <Tabs
          items={[
            { key: 'pl', label: 'Profit & loss' },
            { key: 'policies', label: 'Policies & endorsements' },
            { key: 'money', label: 'Income & expenses' },
          ]}
          active={view}
          onChange={(key) => setParams(new URLSearchParams(key === 'pl' ? {} : { view: key }), { replace: true })}
        />
      )}
      {view === 'pl' && <ProfitLossPanel />}
      {view === 'money' && <IncomeExpensesPanel />}
      {view === 'policies' && <PoliciesPanel />}
    </PageContainer>
  );
}

function PoliciesPanel() {
  const accounts = useAccountsStore((s) => s.accounts);
  const quotes = useAccountsStore((s) => s.quotes);
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const members = useAccountsStore((s) => s.agencyMembers);
  const me = useAccountsStore((s) => s.currentUserId);
  const rates = useAgentCommissionRates();
  const isAdmin = agencyAccess?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const dateField = (DATE_FIELDS as string[]).includes(params.get('date') ?? '') ? (params.get('date') as PolicyDateField) : 'boundDate';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const kind = (['policy', 'endorsement'].includes(params.get('type') ?? '') ? params.get('type') : 'all') as KindFilter;
  const agent = isAdmin ? (params.get('agent') ?? ALL_AGENTS) : ALL_AGENTS;
  const [search, setSearch] = useState('');

  // An agent's analytics are their own clients' (the ones assigned to them).
  const all = useMemo(() => policyRows(accounts, quotes).filter((r) => !agencyAccess || isAdmin || r.assignedUserId === me), [accounts, quotes, agencyAccess, isAdmin, me]);
  const rows = useMemo(
    () =>
      filterPolicies(all, { dateField, from, to, search })
        .filter((r) => kind === 'all' || entryKind(r.policy) === kind)
        .filter((r) => !agent || r.assignedUserId === agent),
    [all, dateField, from, to, search, kind, agent]
  );
  const preset = PRESETS.find((p) => p !== 'all' && presetRange(p).from === from && presetRange(p).to === to) ?? (from || to ? 'custom' : 'all');
  const commissionOf = (r: PolicyRow): number | null => {
    if (!agencyAccess || !r.assignedUserId) return null;
    const rate = rates.rates[r.assignedUserId];
    return rate === undefined ? null : agentCommissionCents(r.policy.netPremiumCents, rate);
  };
  const totals = useMemo(() => {
    const t = { policies: 0, endorsements: 0, net: 0, taxes: 0, fees: 0, commission: 0, commissionMissing: 0, proofMissing: 0 };
    for (const r of rows) {
      if (entryKind(r.policy) === 'endorsement') t.endorsements++;
      else t.policies++;
      t.net += r.policy.netPremiumCents;
      t.taxes += r.policy.taxesCents;
      t.fees += r.policy.feesCents;
      const c = commissionOf(r);
      if (c === null) t.commissionMissing++;
      else t.commission += c;
      if (!(r.policy.attachments ?? []).length) t.proofMissing++;
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rates.rates, agencyAccess]);
  const agentName = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.name ?? 'Agent') : null);

  // Two quick changes (From, then To) can land before the URL re-renders: build on the latest one.
  const latest = useRef(params);
  latest.current = params;
  const update = (patch: Record<string, string>) => {
    const n = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v);
      else n.delete(k);
    }
    latest.current = n;
    setParams(n, { replace: true });
  };

  const myRate = me ? rates.rates[me] : undefined;
  return (
    <>
      {agencyAccess && !isAdmin && rates.status === 'ready' && (
        <p className="text-sm text-[var(--color-ink-600)]" data-testid="my-commission">
          Your agent commission: <strong className="text-[var(--color-ink-900)]">{myRate === undefined ? 'not set yet' : formatRate(myRate)}</strong> of the net amount (set by your agency admin).
        </p>
      )}
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.35fr_1fr_1fr_1fr_1fr]" data-testid="policy-filters">
            <div>
              <label className={labelClass} htmlFor="pf-type">Show</label>
              <select id="pf-type" className={inputClass} value={kind} onChange={(e) => update({ type: e.target.value === 'all' ? '' : e.target.value })}>
                <option value="all">All</option>
                <option value="policy">Policies</option>
                <option value="endorsement">Endorsements</option>
              </select>
            </div>
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
            <div className={isAdmin ? 'sm:col-span-2 lg:col-span-6 lg:order-last' : 'sm:col-span-2 lg:col-span-1'}>
              <label className={labelClass} htmlFor="pf-search">Search</label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" aria-hidden />
                <input id="pf-search" className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client, policy number, carrier or notes" />
              </div>
            </div>
            {isAdmin && (
              <div>
                <label className={labelClass} htmlFor="pf-agent">Agent</label>
                <select id="pf-agent" className={inputClass} value={agent} onChange={(e) => update({ agent: e.target.value })}>
                  <option value={ALL_AGENTS}>All agents</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="policy-totals">
        <Stat label="Policies" value={String(totals.policies)} id="policies" />
        <Stat label="Endorsements" value={String(totals.endorsements)} id="endorsements" />
        <Stat label="Net amount" value={formatCents(totals.net)} id="net" />
        <Stat label="Taxes" value={formatCents(totals.taxes)} id="taxes" />
        <Stat label="Fees" value={formatCents(totals.fees)} id="fees" />
        <Stat label="Total" value={formatCents(totals.net + totals.taxes + totals.fees)} id="total" strong />
        {agencyAccess && <Stat label={isAdmin ? 'Agent commission' : 'Your commission'} value={formatCents(totals.commission)} id="commission" strong note={totals.commissionMissing ? `${totals.commissionMissing} without a rate or agent` : undefined} />}
        <Stat label="Missing Documents" value={String(totals.proofMissing)} id="documents-missing" note={totals.proofMissing ? 'policies / endorsements without a document' : undefined} />
      </dl>

      <Card>
        <CardBody className="pt-2">
          {all.length === 0 ? (
            <EmptyState
              icon={<BarChart3 size={26} strokeWidth={1.5} />}
              title="Nothing recorded yet"
              description="When a market is marked Bound or Endorsed in an account’s Markets & Quotes, its policy or endorsement shows here with its premium, taxes, fees and agent commission."
            />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-ink-500)]" data-testid="policies-none">Nothing matches these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse" data-testid="policy-table">
                <thead>
                  <tr>
                    <th className={th}>Client / policy</th>
                    <th className={th}>Bound / endorsed</th>
                    <th className={`${th} ${num}`}>Net</th>
                    <th className={`${th} ${num}`}>Taxes</th>
                    <th className={`${th} ${num}`}>Fees</th>
                    <th className={`${th} ${num}`}>Total</th>
                    {agencyAccess && <th className={`${th} ${num}`}>Agent commission</th>}
                    <th className={th}>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = commissionOf(r);
                    const rate = r.assignedUserId ? rates.rates[r.assignedUserId] : undefined;
                    const endorsement = entryKind(r.policy) === 'endorsement';
                    return (
                      <tr key={r.policy.id} data-row={r.policy.id} data-kind={endorsement ? 'endorsement' : 'policy'}>
                        <td className={`${td} min-w-[220px]`}>
                          <Link to={`/accounts/${r.accountId}?tab=quotes&quote=${r.quoteId}`} className="block font-medium text-[var(--color-brand-800)] hover:underline">{r.insured}</Link>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
                            <span className="font-medium">{r.policy.policyNumber ?? 'Number to come'}</span>
                            <span className={endorsement ? 'rounded-full bg-[var(--color-info-100)] px-1.5 py-0.5 text-[11px] text-[var(--color-info-600)]' : 'rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-600)]'}>
                              {endorsement ? 'Endorsement' : r.policy.businessType === 'renewal' ? 'Renewal' : 'New business'}
                            </span>
                            {!r.marketBound && <Badge tone="warning">{endorsement ? 'Market no longer Endorsed' : 'Market no longer Bound'}</Badge>}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-ink-500)]">
                            {r.policy.carrier}
                            {r.policy.carrier !== r.marketName ? ` via ${r.marketName}` : ''}
                          </span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {formatShortDate(r.policy.boundDate)}
                          {(r.policy.effectiveDate || r.policy.expirationDate) && (
                            <span className="block text-xs text-[var(--color-ink-500)]">
                              Term {formatShortDate(r.policy.effectiveDate)} – {formatShortDate(r.policy.expirationDate)}
                            </span>
                          )}
                        </td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.netPremiumCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.taxesCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.feesCents)}</td>
                        <td className={`${td} ${num} font-semibold`}>{formatCents(policyTotalCents(r.policy))}</td>
                        {agencyAccess && (
                          <td className={`${td} ${num}`} data-field="commission">
                            {c === null ? (
                              <span className="text-xs text-[var(--color-ink-400)]">{r.assignedUserId ? 'No rate set' : 'No agent assigned'}</span>
                            ) : (
                              <>
                                <span className="font-semibold">{formatCents(c)}</span>
                                <span className="block text-xs text-[var(--color-ink-500)]">{agentName(r.assignedUserId)}, {formatRate(rate!)}</span>
                              </>
                            )}
                          </td>
                        )}
                        <td className={`${td} whitespace-nowrap`} data-field="documents">
                          {(r.policy.attachments ?? []).length ? (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-600)]" title={r.policy.attachments!.map((a) => (a.description ? `${a.name} — ${a.description}` : a.name)).join('\n')}>
                              <Paperclip size={12} aria-hidden /> {r.policy.attachments!.length}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-warning-600)]"><FileWarning size={12} aria-hidden /> Missing</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

    </>
  );
}

function Stat({ label, value, id, strong, note }: { label: string; value: string; id: string; strong?: boolean; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]">
      <dt className="text-xs text-[var(--color-ink-500)]">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? 'text-lg font-semibold text-[var(--color-ink-900)]' : 'text-base font-semibold text-[var(--color-ink-800)]'}`} data-total={id}>
        {value}
      </dd>
      {note && <p className="mt-0.5 text-[11px] text-[var(--color-ink-400)]">{note}</p>}
    </div>
  );
}
