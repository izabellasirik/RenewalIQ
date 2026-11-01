import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '../ui';
import { DownloadButtons } from './DownloadButtons';
import { brokerFeesReport } from '../../services/reports/analyticsReports';
import { useRememberedView } from '../../hooks/useRememberedView';
import { aString } from '../../services/preferences/viewPreferences';
import { useAccountsStore } from '../../state/useAccountsStore';
import { inputClass, labelClass } from '../workspace/formStyles';
import { PeriodPicker, usePeriod } from './MoneyPanels';
import { fetchBrokerFeeSplits, type BrokerFeeSplit } from '../../services/supabase/partnersRepo';
import { formatCents } from '../../services/workflow/policies';
import { formatDateWithYear } from '../../services/workflow/dates';

const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 text-sm text-[var(--color-ink-800)]';
const num = `${td} text-right tabular-nums`;
const FILTERS = { partner: '', agent: '' };
const sanitizeFilters = (v: Record<string, unknown>) => ({ partner: aString(v.partner), agent: aString(v.agent) });

function Tile({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-ink-900)]">{formatCents(cents)}</p>
      {hint && <p className="text-xs text-[var(--color-ink-500)]">{hint}</p>}
    </div>
  );
}

/**
 * Analytics → Broker fees (0081): broker fees on policies bound in the period, split partner (once per client)
 * → agent → agency. Admins: what's owed to each partner and each agent. An agent: their own share only.
 */
export function BrokerFeesPanel({ admin }: { admin: boolean }) {
  const period = usePeriod();
  const [rows, setRows] = useState<BrokerFeeSplit[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setRows(null);
    void fetchBrokerFeeSplits(period.from || null, period.to || null).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data);
      else {
        setRows([]);
        setError(r.message);
      }
    });
    return () => {
      live = false;
    };
  }, [period.from, period.to]);

  // Partner and Agent filters, remembered for this user; Clear resets them.
  const [filters, setFilters, clearFilters] = useRememberedView('broker-fees-filters', FILTERS, sanitizeFilters);
  const partnerNames = useMemo(() => [...new Set((rows ?? []).map((r) => r.partnerName).filter((n): n is string => !!n))].sort(), [rows]);
  const agentNames = useMemo(() => [...new Set((rows ?? []).map((r) => r.agentName).filter((n): n is string => !!n))].sort(), [rows]);
  const shown = useMemo(
    () => (rows ?? []).filter((r) => (!filters.partner || r.partnerName === filters.partner) && (!filters.agent || r.agentName === filters.agent)),
    [rows, filters.partner, filters.agent]
  );
  const filterText = [filters.partner ? `Partner: ${filters.partner}` : '', filters.agent ? `Agent: ${filters.agent}` : ''].filter(Boolean);

  const totals = useMemo(() => {
    const list = shown;
    const sum = (f: (r: BrokerFeeSplit) => number) => list.reduce((n, r) => n + f(r), 0);
    const group = (key: (r: BrokerFeeSplit) => string | null, cents: (r: BrokerFeeSplit) => number) => {
      const m = new Map<string, { cents: number; count: number }>();
      for (const r of list) {
        const k = key(r);
        const c = cents(r);
        if (!k || c <= 0) continue;
        const cur = m.get(k) ?? { cents: 0, count: 0 };
        m.set(k, { cents: cur.cents + c, count: cur.count + 1 });
      }
      return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cents - a.cents);
    };
    return {
      fees: sum((r) => r.brokerFeeCents),
      partners: sum((r) => r.partnerCents ?? 0),
      agents: sum((r) => r.agentCents ?? 0),
      pending: list.filter((r) => r.partnerPending).length,
      agency: sum((r) => r.agencyCents ?? 0),
      byPartner: group((r) => r.partnerName, (r) => r.partnerCents ?? 0),
      byAgent: group((r) => r.agentName, (r) => r.agentCents ?? 0),
    };
  }, [shown]);

  return (
    <div className="flex flex-col gap-4" data-testid="broker-fees">
      <Card>
        <CardBody className="pt-4">
          <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[200px_170px_170px_1fr]">
            <PeriodPicker period={period} />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {admin && (
              <div>
                <label className={labelClass} htmlFor="bf-partner">Partner</label>
                <select id="bf-partner" value={filters.partner} onChange={(e) => setFilters({ partner: e.target.value })} className={`${inputClass} w-48`}>
                  <option value="">All partners</option>
                  {partnerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {admin && (
              <div>
                <label className={labelClass} htmlFor="bf-agent">Agent</label>
                <select id="bf-agent" value={filters.agent} onChange={(e) => setFilters({ agent: e.target.value })} className={`${inputClass} w-48`}>
                  <option value="">All agents</option>
                  {agentNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {(filters.partner || filters.agent) && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
            )}
            <div className="ml-auto">
              <DownloadButtons testId="broker-fees-download" disabled={rows === null} report={() => brokerFeesReport(shown, admin, period.from, period.to, filterText)} />
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            Broker fees on policies bound in this period. {admin ? 'The referral partner’s amount comes off first, the agent gets their share of the rest, the agency keeps what’s left.' : 'Your share, as agreed with your agency.'}
          </p>
        </CardBody>
      </Card>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      {rows !== null && totals.pending > 0 && (
        <p className="rounded-lg border border-[var(--color-warning-500)]/40 bg-[var(--color-warning-100)] px-3 py-2 text-sm text-[var(--color-ink-800)]" data-testid="broker-fees-pending">
          {totals.pending === 1 ? '1 policy isn’t split yet' : `${totals.pending} policies aren’t split yet`}: the client’s referral partner is new and {admin ? 'needs your approval in Admin Review, with the agreed amount.' : 'an admin needs to approve it and set the agreed amount.'}
        </p>
      )}
      {rows === null ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : admin ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Broker fees" cents={totals.fees} hint={`${shown.length} polic${shown.length === 1 ? 'y' : 'ies'}`} />
            <Tile label="Owed to partners" cents={totals.partners} />
            <Tile label="Owed to agents" cents={totals.agents} />
            <Tile label="Agency keeps" cents={totals.agency} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <OwedTable title="Owed to partners" rows={totals.byPartner} countLabel="clients" empty="No partner shares in this period." />
            <OwedTable title="Owed to agents" rows={totals.byAgent} countLabel="policies" empty="No agent shares in this period." />
          </div>
          <SplitsTable rows={shown} admin />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Your broker fee share" cents={totals.agents} hint={`${shown.length} polic${shown.length === 1 ? 'y' : 'ies'}`} />
          </div>
          <SplitsTable rows={shown} admin={false} />
        </>
      )}
    </div>
  );
}

function OwedTable({ title, rows, countLabel, empty }: { title: string; rows: { name: string; cents: number; count: number }[]; countLabel: string; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{title}</h3>
      </CardHeader>
      <CardBody className="overflow-x-auto pt-0">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-ink-500)]">{empty}</p>
        ) : (
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={`${th} text-right`}>{countLabel}</th>
                <th className={`${th} text-right`}>Owed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className={td}>{r.name}</td>
                  <td className={num}>{r.count}</td>
                  <td className={`${num} font-semibold`}>{formatCents(r.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function SplitsTable({ rows, admin }: { rows: BrokerFeeSplit[]; admin: boolean }) {
  // The client opens on Markets & Quotes, at the market that holds the policy.
  const quotes = useAccountsStore((s) => s.quotes);
  const policyLink = (r: BrokerFeeSplit) => {
    const q = (quotes[r.accountId] ?? []).find((x) => (x.policies ?? []).some((p) => p.id === r.policyId));
    return `/accounts/${r.accountId}?tab=quotes${q ? `&quote=${q.id}` : ''}`;
  };
  const sum = (f: (r: BrokerFeeSplit) => number) => rows.reduce((n, r) => n + f(r), 0);
  const total = 'border-t-2 border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-900)]';
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Policies with a broker fee</h3>
      </CardHeader>
      <CardBody className="overflow-x-auto pt-0">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-ink-500)]">No broker fees on policies bound in this period. Add one on a policy in Markets & Quotes.</p>
        ) : (
          <table className="min-w-full border-collapse" data-testid="broker-fee-rows">
            <thead>
              <tr>
                {['Bound', 'Client', 'Policy', 'Broker fee', ...(admin ? ['Partner', 'Agent', 'Agency'] : ['Your share'])].map((h, i) => (
                  <th key={h} className={i >= 3 ? `${th} text-right` : th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.accountId}|${r.policyId}`}>
                  <td className={td}>{formatDateWithYear(r.boundDate)}</td>
                  <td className={td}>
                    <Link to={policyLink(r)} className="font-medium text-[var(--color-brand-800)] hover:underline">{r.clientName}</Link>
                  </td>
                  <td className={td}>{r.policyNumber ?? '—'}</td>
                  <td className={num}>{formatCents(r.brokerFeeCents)}</td>
                  {r.partnerPending ? (
                    <td className={`${num} text-[var(--color-warning-600)]`} colSpan={admin ? 3 : 1}>
                      Waiting for partner approval
                    </td>
                  ) : admin ? (
                    <>
                      <td className={num}>{r.partnerCents ? `${formatCents(r.partnerCents)} · ${r.partnerName}` : '—'}</td>
                      <td className={num}>
                        {r.agentCents ? `${formatCents(r.agentCents)} · ${r.agentName}` : '—'}
                        {r.partnerShortfallCents > 0 && (
                          <span className="block text-[11px] text-[var(--color-ink-500)]" title="The broker fee didn’t cover the partner’s agreed amount; the rest comes out of the agent commission.">
                            − {formatCents(r.partnerShortfallCents)} from {r.agentName ?? 'the agent'}’s commission to the partner
                          </span>
                        )}
                      </td>
                      <td className={`${num} font-semibold`}>{formatCents(r.agencyCents ?? 0)}</td>
                    </>
                  ) : (
                    <td className={`${num} font-semibold`}>
                      {formatCents(r.agentCents ?? 0)}
                      {r.partnerShortfallCents > 0 && <span className="block text-[11px] font-normal text-[var(--color-ink-500)]">− {formatCents(r.partnerShortfallCents)} from your commission to the referral partner</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="broker-fee-totals">
                <td className={total} colSpan={3}>Total · {rows.length} {rows.length === 1 ? 'policy' : 'policies'}</td>
                <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.brokerFeeCents))}</td>
                {admin ? (
                  <>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.partnerCents ?? 0))}</td>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agentCents ?? 0))}</td>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agencyCents ?? 0))}</td>
                  </>
                ) : (
                  <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agentCents ?? 0))}</td>
                )}
              </tr>
            </tfoot>
            <tfoot>
              <tr data-testid="broker-fee-totals">
                <td className={total} colSpan={3}>Total · {rows.length} {rows.length === 1 ? 'policy' : 'policies'}</td>
                <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.brokerFeeCents))}</td>
                {admin ? (
                  <>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.partnerCents ?? 0))}</td>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agentCents ?? 0))}</td>
                    <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agencyCents ?? 0))}</td>
                  </>
                ) : (
                  <td className={`${total} text-right tabular-nums`}>{formatCents(sum((r) => r.agentCents ?? 0))}</td>
                )}
              </tr>
            </tfoot>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
