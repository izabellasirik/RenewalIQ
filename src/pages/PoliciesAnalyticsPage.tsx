import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, FileWarning, Paperclip, Pencil, Search } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, EmptyState, Tabs } from '../components/ui';
import { IncomeExpensesPanel, ProfitLossPanel } from '../components/analytics/MoneyPanels';
import { inputClass, labelClass } from '../components/workspace/formStyles';
import { formatRate } from '../components/workspace/PoliciesSection';
import { useAccountsStore } from '../state/useAccountsStore';
import { useAgentCommissionRates } from '../hooks/useAgentCommission';
import { useCarrierRates } from '../hooks/useCarrierRates';
import { useLedger, useMyCommissions } from '../hooks/useLedger';
import { CarrierRateDialog } from '../components/finance/CarrierRateDialog';
import { currentRecordsByPolicy } from '../services/finance/ledger';
import { useRememberedView } from '../hooks/useRememberedView';
import { aDateKey, aString, defined, oneOf } from '../services/preferences/viewPreferences';
import { policiesReport } from '../services/reports/analyticsReports';
import { DownloadButtons } from '../components/analytics/DownloadButtons';
import { formatShortDate } from '../services/workflow/dates';
import {
  DATE_PRESET_LABELS,
  POLICY_DATE_LABELS,
  agentCommissionCents,
  carrierCommissionCents,
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

/** The Policies & endorsements filters, remembered for each user (and clearable). */
interface PolicyView {
  type: KindFilter;
  date: PolicyDateField;
  from: string;
  to: string;
  agent: string;
  search: string;
}
const POLICY_VIEW_DEFAULTS: PolicyView = { type: 'all', date: 'boundDate', from: '', to: '', agent: ALL_AGENTS, search: '' };
const sanitizePolicyView = (saved: Record<string, unknown>): Partial<PolicyView> =>
  defined<PolicyView>({
    type: oneOf<KindFilter>(['all', 'policy', 'endorsement'])(saved.type),
    date: oneOf<PolicyDateField>(DATE_FIELDS)(saved.date),
    from: aDateKey(saved.from),
    to: aDateKey(saved.to),
    agent: aString(saved.agent),
    search: aString(saved.search),
  });
const URL_KEYS: Record<string, keyof PolicyView> = { type: 'type', date: 'date', from: 'from', to: 'to', agent: 'agent', q: 'search' };

function PoliciesPanel() {
  const accounts = useAccountsStore((s) => s.accounts);
  const quotes = useAccountsStore((s) => s.quotes);
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const members = useAccountsStore((s) => s.agencyMembers);
  const me = useAccountsStore((s) => s.currentUserId);
  const rates = useAgentCommissionRates();
  const isAdmin = agencyAccess?.role === 'admin';
  const [view, update, reset] = useRememberedView('analytics-policies', POLICY_VIEW_DEFAULTS, sanitizePolicyView);
  // A link with filters in it (?view=policies&from=…) sets them once; after that they're remembered.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const patch: Partial<PolicyView> = {};
    for (const [k, field] of Object.entries(URL_KEYS)) if (params.has(k)) (patch as Record<string, string>)[field] = params.get(k) ?? '';
    if (!Object.keys(patch).length) return;
    update({ ...POLICY_VIEW_DEFAULTS, ...sanitizePolicyView(patch as Record<string, unknown>) });
    const n = new URLSearchParams(params);
    for (const k of Object.keys(URL_KEYS)) n.delete(k);
    setParams(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { date: dateField, from, to, search } = view;
  const kind = view.type;
  const agent = isAdmin && (view.agent === ALL_AGENTS || members.some((m) => m.userId === view.agent)) ? view.agent : ALL_AGENTS;
  const filtersActive = kind !== 'all' || dateField !== 'boundDate' || !!from || !!to || !!agent || !!search;

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
  const carrier = useCarrierRates();
  // Commission records (0064): the frozen amounts and status of each policy — the agency's for an admin,
  // the agent's own for an agent. Without them (no 0064, or not recorded yet) the amounts are worked out.
  const ledger = useLedger();
  const mine = useMyCommissions(!!agencyAccess && !isAdmin);
  const records = useMemo(() => {
    const out = new Map<string, { agentCents: number | null; carrierCents?: number; carrierRate?: number }>();
    if (isAdmin && ledger.data) for (const [k, t] of currentRecordsByPolicy(ledger.data.transactions)) out.set(k, { agentCents: t.agentCents, carrierCents: t.carrierCents, carrierRate: t.carrierRate });
    if (!isAdmin) for (const c of mine.commissions) if (c.policyId) out.set(`${c.submissionId}|${c.policyId}`, { agentCents: c.agentCents });
    return out;
  }, [isAdmin, ledger.data, mine.commissions]);
  const recordOf = (r: PolicyRow) => records.get(`${r.accountId}|${r.policy.id}`);
  const commissionOf = (r: PolicyRow): number | null => {
    if (!agencyAccess) return null;
    // The recorded amount when there is one; otherwise (not recorded yet, e.g. an earlier policy) it's
    // worked out the same way: net × 10% × the assigned agent's split.
    const recorded = recordOf(r)?.agentCents;
    if (recorded !== undefined && recorded !== null) return recorded;
    if (!r.assignedUserId) return null;
    const rate = rates.rates[r.assignedUserId];
    return rate === undefined ? null : agentCommissionCents(r.policy.netPremiumCents, rate);
  };
  const carrierRateOf = (r: PolicyRow) => recordOf(r)?.carrierRate ?? carrier.rateOn(r.policy.carrier, r.policy.boundDate);
  const carrierCentsOf = (r: PolicyRow) => recordOf(r)?.carrierCents ?? carrierCommissionCents(r.policy.netPremiumCents, carrier.rateOn(r.policy.carrier, r.policy.boundDate));
  const [rateFor, setRateFor] = useState<PolicyRow | null>(null);
  const setDescription = useAccountsStore((s) => s.setPolicyDescription);
  const totals = useMemo(() => {
    const t = { policies: 0, endorsements: 0, net: 0, taxes: 0, fees: 0, carrier: 0, commission: 0, commissionMissing: 0, proofMissing: 0 };
    for (const r of rows) {
      if (entryKind(r.policy) === 'endorsement') t.endorsements++;
      else t.policies++;
      t.net += r.policy.netPremiumCents;
      t.taxes += r.policy.taxesCents;
      t.fees += r.policy.feesCents;
      t.carrier += carrierCentsOf(r);
      const c = commissionOf(r);
      if (c === null) t.commissionMissing++;
      else t.commission += c;
      if (!(r.policy.attachments ?? []).length) t.proofMissing++;
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rates.rates, carrier.rows, agencyAccess, records]);
  const agentName = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.name ?? 'Agent') : '');
  const report = () =>
    policiesReport(rows, {
      isAdmin,
      withCommission: !!agencyAccess,
      carrierRateOf,
      carrierCentsOf,
      commissionOf,
      agentNameOf: (r) => agentName(r.assignedUserId),
      filters: [kind !== 'all' ? `Show: ${kind === 'policy' ? 'Policies' : 'Endorsements'}` : '', agent ? `Agent: ${agentName(agent)}` : '', search ? `Search: “${search}”` : ''].filter(Boolean),
      dateField,
      from,
      to,
    });

  const myRate = me ? rates.rates[me] : undefined;
  const totalCell = 'border-b-2 border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-3 py-2 align-top text-sm font-semibold text-[var(--color-ink-900)]';
  return (
    <>
      {agencyAccess && !isAdmin && rates.status === 'ready' && (
        <p className="text-sm text-[var(--color-ink-600)]" data-testid="my-commission">
          Your agent commission: <strong className="text-[var(--color-ink-900)]">{myRate === undefined ? 'not set yet' : formatRate(myRate)}</strong> of 10% of the net premium, set by your agency admin.
        </p>
      )}
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.35fr_1fr_1fr_1fr_1fr]" data-testid="policy-filters">
            <div>
              <label className={labelClass} htmlFor="pf-type">Show</label>
              <select id="pf-type" className={inputClass} value={kind} onChange={(e) => update({ type: e.target.value as KindFilter })}>
                <option value="all">All</option>
                <option value="policy">Policies</option>
                <option value="endorsement">Endorsements</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-field">Date</label>
              <select id="pf-field" className={inputClass} value={dateField} onChange={(e) => update({ date: e.target.value as PolicyDateField })}>
                {DATE_FIELDS.map((f) => <option key={f} value={f}>{POLICY_DATE_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pf-preset">Period</label>
              <select id="pf-preset" className={inputClass} value={preset} onChange={(e) => e.target.value !== 'custom' && update(presetRange(e.target.value as DatePreset))}>
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
            {isAdmin && (
              <div>
                <label className={labelClass} htmlFor="pf-agent">Agent</label>
                <select id="pf-agent" className={inputClass} value={agent} onChange={(e) => update({ agent: e.target.value })}>
                  <option value={ALL_AGENTS}>All agents</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </div>
            )}
            <div className={isAdmin ? 'sm:col-span-2 lg:col-span-6' : 'sm:col-span-2 lg:col-span-1'}>
              <label className={labelClass} htmlFor="pf-search">Search</label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" aria-hidden />
                <input id="pf-search" className={`${inputClass} pl-9`} value={search} onChange={(e) => update({ search: e.target.value })} placeholder="Client, policy number, carrier, description or notes" />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--color-ink-500)]">
              {filtersActive ? 'Your filters are saved for next time.' : 'Filters you choose are saved for next time.'}
              {filtersActive && (
                <button type="button" onClick={reset} className="ml-2 cursor-pointer font-medium text-[var(--color-brand-700)] hover:underline" data-testid="policy-filters-clear">
                  Clear filters
                </button>
              )}
            </p>
            <DownloadButtons report={report} disabled={rows.length === 0} testId="policy-download" />
          </div>
        </CardBody>
      </Card>

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
                    <th className={th}>Bound date</th>
                    <th className={`${th} ${num}`}>Net</th>
                    <th className={`${th} ${num}`}>Taxes</th>
                    <th className={`${th} ${num}`}>Fees</th>
                    <th className={`${th} ${num}`}>Total</th>
                    {isAdmin && <th className={`${th} ${num} !whitespace-normal`}>Carrier commission</th>}
                    {agencyAccess && <th className={`${th} ${num} !whitespace-normal`}>Agent commission</th>}
                    <th className={th}>Description</th>
                    <th className={th}>Documents</th>
                  </tr>
                  <tr data-testid="policy-totals" className="tabular-nums">
                    <td className={totalCell}>
                      Totals
                      <span className="mt-0.5 block text-xs font-normal text-[var(--color-ink-600)]" data-total="count">
                        <span data-total="policies">{totals.policies}</span> {totals.policies === 1 ? 'policy' : 'policies'} · <span data-total="endorsements">{totals.endorsements}</span> {totals.endorsements === 1 ? 'endorsement' : 'endorsements'}
                      </span>
                    </td>
                    <td className={totalCell} />
                    <td className={`${totalCell} ${num}`} data-total="net">{formatCents(totals.net)}</td>
                    <td className={`${totalCell} ${num}`} data-total="taxes">{formatCents(totals.taxes)}</td>
                    <td className={`${totalCell} ${num}`} data-total="fees">{formatCents(totals.fees)}</td>
                    <td className={`${totalCell} ${num}`} data-total="total">{formatCents(totals.net + totals.taxes + totals.fees)}</td>
                    {isAdmin && <td className={`${totalCell} ${num}`} data-total="carrier">{formatCents(totals.carrier)}</td>}
                    {agencyAccess && (
                      <td className={`${totalCell} ${num}`} data-total="commission">
                        {formatCents(totals.commission)}
                        {totals.commissionMissing > 0 && <span className="block text-[11px] font-normal text-[var(--color-ink-500)]">{totals.commissionMissing} without an agent or split</span>}
                      </td>
                    )}
                    <td className={totalCell} />
                    <td className={totalCell} data-total="documents-missing">
                      {totals.proofMissing ? <span className="text-xs font-medium text-[var(--color-warning-600)]">{totals.proofMissing} missing</span> : <span className="text-xs font-normal text-[var(--color-ink-500)]">None missing</span>}
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = commissionOf(r);
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
                        <td className={`${td} whitespace-nowrap`} data-field="bound">{r.policy.boundDate ? formatShortDate(r.policy.boundDate) : '—'}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.netPremiumCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.taxesCents)}</td>
                        <td className={`${td} ${num}`}>{formatCents(r.policy.feesCents)}</td>
                        <td className={`${td} ${num} font-semibold`}>{formatCents(policyTotalCents(r.policy))}</td>
                        {isAdmin && (
                          <td className={`${td} ${num}`} data-field="carrier">
                            <CarrierCell row={r} rate={carrierRateOf(r)} cents={carrierCentsOf(r)} canEdit={carrier.status === 'ready'} onChange={() => setRateFor(r)} />
                          </td>
                        )}
                        {agencyAccess && (
                          <td className={`${td} ${num}`} data-field="commission">
                            {c === null ? <span className="text-xs text-[var(--color-ink-400)]">{r.assignedUserId ? 'No split set' : 'No agent assigned'}</span> : <span className="font-semibold">{formatCents(c)}</span>}
                          </td>
                        )}
                        <td className={`${td} min-w-[200px]`} data-field="description">
                          <DescriptionCell
                            text={r.policy.description ?? ''}
                            canEdit={isAdmin && !r.policy.removedAt}
                            label={`${r.insured} ${r.policy.policyNumber ?? r.policy.carrier}`}
                            onSave={(text) => setDescription(r.accountId, r.quoteId, r.policy.id, text)}
                          />
                        </td>
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
          {isAdmin && rows.length > 0 && carrier.status === 'unavailable' && carrier.message && (
            <p className="mt-3 text-xs text-[var(--color-warning-600)]" data-testid="carrier-rates-unavailable">
              {carrier.message} Until then every carrier uses 10%.
            </p>
          )}
          {isAdmin && rows.length > 0 && (
            <p className="mt-3 text-xs text-[var(--color-ink-500)]">
              Carrier commission = net × the carrier’s % on the bound date (10% until you set one). A new rate applies from its date to policies and endorsements recorded from then on; commissions already recorded keep their rate. The agent commission never depends on it: it’s always net × 10% × the agent’s split.
            </p>
          )}
          {rateFor && <CarrierRateDialog carrier={rateFor.policy.carrier} effectiveFrom={rateFor.policy.boundDate} onClose={() => setRateFor(null)} />}
        </CardBody>
      </Card>
      {!isAdmin && mine.commissions.some((c) => c.kind === 'cancellation' || c.kind === 'correction') && (
        <Card>
          <CardBody className="pt-4" data-testid="my-adjustments">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Cancellations and corrections on your commissions</h3>
            <p className="text-xs text-[var(--color-ink-500)]">Approved by your agency admin, with the original policy’s split. A negative amount is taken from your next payouts, never withdrawn.</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {mine.commissions
                .filter((c) => c.kind === 'cancellation' || c.kind === 'correction')
                .map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-ink-50)] py-1.5 last:border-b-0" data-adjustment={c.id}>
                    <span>
                      <strong>{c.kind === 'cancellation' ? 'Cancellation' : 'Correction'}</strong> — {c.clientName}, {c.policyNumber ?? c.carrierName} · {formatShortDate(c.eventDate)}
                    </span>
                    <span className="tabular-nums">
                      <strong>{c.agentCents === null ? '—' : formatCents(c.agentCents)}</strong>
                      {c.expectedPayDate && <span className="text-xs text-[var(--color-ink-500)]"> · with the payout of {formatShortDate(c.expectedPayDate)}</span>}
                    </span>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** A row's carrier commission: the % (as recorded, or in force on its bound date) and the amount; admins can set a new rate from here. */
function CarrierCell({ row, rate, cents, canEdit, onChange }: { row: PolicyRow; rate: number; cents: number; canEdit: boolean; onChange: () => void }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-sm tabular-nums text-[var(--color-ink-700)]" data-field="carrier-rate">{formatRate(rate)}</span>
      <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-800)]">{formatCents(cents)}</span>
      {canEdit && (
        <button type="button" onClick={onChange} className="cursor-pointer text-[11px] font-medium text-[var(--color-brand-700)] hover:underline" aria-label={`Set carrier commission % for ${row.policy.carrier}`}>
          Set rate
        </button>
      )}
    </div>
  );
}

/** A row's description: shown to everyone; an admin can write or change it here (300 characters at most). */
function DescriptionCell({ text, canEdit, label, onSave }: { text: string; canEdit: boolean; label: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="flex items-start gap-1.5">
        <span className={`text-xs ${text ? 'text-[var(--color-ink-700)]' : 'text-[var(--color-ink-400)]'}`} data-field="description-text">{text || '—'}</span>
        {canEdit && (
          <button type="button" onClick={() => setDraft(text)} className="shrink-0 cursor-pointer text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]" aria-label={`${text ? 'Edit' : 'Add'} description for ${label}`}>
            <Pencil size={12} aria-hidden />
          </button>
        )}
      </div>
    );
  }
  const save = () => {
    onSave(draft);
    setDraft(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        className={`${inputClass} min-h-[60px] text-xs`}
        value={draft}
        maxLength={300}
        autoFocus
        aria-label={`Description for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(null);
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex gap-1.5">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
      </div>
    </div>
  );
}
