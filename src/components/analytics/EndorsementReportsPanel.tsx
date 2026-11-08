import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Trash2, UploadCloud } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Modal } from '../ui';
import { DownloadButtons } from './DownloadButtons';
import { useAgentCommissionRates } from '../../hooks/useAgentCommission';
import { cancellationsReport, endorsementsReport } from '../../services/reports/analyticsReports';
import { inputClass, labelClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { formatShortDate } from '../../services/workflow/dates';
import { formatCents } from '../../services/workflow/policies';
import {
  DEFAULT_AGENCY_RATE,
  cancellationKey,
  commissionCents,
  daysInForce,
  displayName,
  endorsementKey,
  endorsementTotals,
  endorsementType,
  endorsementsBy,
  matchQqAgent,
  mergeReportRows,
  qqNameKey,
  parseQqReport,
  withRowKeys,
  type CancellationRow,
  type EndorsementRow,
} from '../../services/reports/qqReports';
import { addQqReport, deleteQqReport, fetchQqAgentLinks, fetchQqRates, fetchQqReports, setQqAgentLink, setQqRate, type QqReport } from '../../services/supabase/qqReportsRepo';
import type { Report } from '../../services/reports/report';
import { PeriodPicker, usePeriod } from './MoneyPanels';
import { cn } from '../../utils/cn';

const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 font-medium';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2';
const num = 'whitespace-nowrap text-right tabular-nums';
const signed = (cents: number) => (cents > 0 ? `+${formatCents(cents)}` : cents < 0 ? `−${formatCents(-cents)}` : formatCents(0));
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(llc|inc|corp|co|ltd)\b/g, '').trim();
const EARLY_DAYS = 90;
const LIST_STEP = 50;
/** Premiums (amounts added), cancellations / returns (negative amounts), or the no-charge ($0) changes. */
type AmountFilter = 'all' | 'premiums' | 'cancellations' | 'zero';
const AMOUNT_FILTERS: Record<AmountFilter, { label: string; test: (cents: number) => boolean }> = {
  all: { label: 'All amounts', test: () => true },
  premiums: { label: 'Premiums (+)', test: (c) => c > 0 },
  cancellations: { label: 'Cancellations / returns (−)', test: (c) => c < 0 },
  zero: { label: 'No charge ($0)', test: (c) => c === 0 },
};
const pct = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

function Stat({ label, value, tone, note }: { label: string; value: string; tone?: 'good' | 'bad'; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]">
      <dt className="text-xs text-[var(--color-ink-500)]">{label}</dt>
      <dd className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'good' ? 'text-[var(--color-success-600)]' : tone === 'bad' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-900)]')}>{value}</dd>
      {note && <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-400)]">{note}</p>}
    </div>
  );
}

/**
 * Analytics → Endorsement reports (admins): QQCatalyst Endorsements and Cancelled policies reports,
 * uploaded as PDFs, read in the browser and kept for the agency (0093) — totals, by agent, by type,
 * and the lists, for the chosen period and agent.
 */
export function EndorsementReportsPanel() {
  const agencyId = useAccountsStore((s) => s.agencyAccess?.agencyId ?? null);
  const accounts = useAccountsStore((s) => s.accounts);
  const members = useAccountsStore((s) => s.agencyMembers);
  const period = usePeriod();
  const [reports, setReports] = useState<QqReport[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [agent, setAgent] = useState('');
  const [sign, setSign] = useState<AmountFilter>('all');
  const [removing, setRemoving] = useState<QqReport | null>(null);
  const [shown, setShown] = useState(LIST_STEP);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [rateFor, setRateFor] = useState<{ rowKey: string; label: string; rate: number } | null>(null);
  const agentSplits = useAgentCommissionRates();
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const res = await fetchQqReports();
    const [r, l] = await Promise.all([fetchQqRates(), fetchQqAgentLinks()]);
    if (r.ok) setRates(r.data);
    if (l.ok) setLinks(l.data);
    if (res.ok) setReports(res.data);
    else {
      setReports([]);
      setMessage(res.message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(files: File[]) {
    if (!agencyId) return setMessage('Reports are kept for agencies signed in to the cloud.');
    setBusy(true);
    const notes: string[] = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        notes.push(`${file.name}: upload the report as a PDF.`);
        continue;
      }
      const { parsePdf } = await import('../../services/ingestion/parsePdf');
      const raw = await parsePdf(file);
      const parsed = parseQqReport(raw.layout ?? []);
      if (!parsed || parsed.rows.length === 0) {
        notes.push(`${file.name}: this doesn’t look like a QQCatalyst Endorsements or Cancelled policies report.`);
        continue;
      }
      const res = await addQqReport(agencyId, file.name, parsed);
      if (!res.ok) {
        notes.push(`${file.name}: ${res.message}`);
        continue;
      }
      const stated = parsed.recordsStated;
      notes.push(`${file.name}: ${parsed.rows.length} ${parsed.kind === 'endorsements' ? 'endorsements' : 'cancellations'} read${stated !== null && stated !== parsed.rows.length ? ` (the report says ${stated} — check it)` : ''}.`);
      setReports((cur) => [res.data, ...(cur ?? [])]);
    }
    setMessage(notes.join(' '));
    setBusy(false);
  }

  const inPeriod = (date: string) => (!period.from || date >= period.from) && (!period.to || date <= period.to);
  const accountAgent = useMemo(() => {
    const byName = new Map<string, string>();
    for (const a of accounts) {
      const name = members.find((m) => m.userId === a.assignedUserId)?.name;
      if (name) byName.set(normName(a.namedInsured), name);
    }
    return (insured: string) => byName.get(normName(insured)) ?? '';
  }, [accounts, members]);

  const allEndorsements = useMemo(() => withRowKeys(mergeReportRows((reports ?? []).filter((r) => r.kind === 'endorsements').map((r) => r.rows as EndorsementRow[]), endorsementKey)), [reports]);
  // The RenewalIQ agent behind a QQCatalyst name (a link an admin set, or matched by name — see matchQqAgent),
  // shown by their RenewalIQ name, with their split from Team and Partners.
  const agentIdOf = useCallback((qqAgent: string) => matchQqAgent(qqAgent, members, links), [members, links]);
  const agentLabel = useCallback((qqAgent: string) => {
    const id = agentIdOf(qqAgent);
    return (id && members.find((m) => m.userId === id)?.name) || displayName(qqAgent);
  }, [agentIdOf, members]);
  const splitOf = useCallback((qqAgent: string): number | null => {
    const id = agentIdOf(qqAgent);
    const rate = id ? agentSplits.rates[id] : undefined;
    return typeof rate === 'number' ? rate : null;
  }, [agentIdOf, agentSplits.rates]);
  const rateOf = (rowKey: string) => rates[rowKey] ?? DEFAULT_AGENCY_RATE;
  const allCancellations = useMemo(() => mergeReportRows((reports ?? []).filter((r) => r.kind === 'cancellations').map((r) => r.rows as CancellationRow[]), cancellationKey), [reports]);
  const agents = useMemo(() => [...new Set([...allEndorsements.map((r) => agentLabel(r.agent)), ...allCancellations.map((r) => accountAgent(r.insured))].filter(Boolean))].sort(), [allEndorsements, allCancellations, accountAgent, agentLabel]);

  const endorsements = allEndorsements.filter((r) => inPeriod(r.date) && (!agent || agentLabel(r.agent) === agent) && AMOUNT_FILTERS[sign].test(r.amountCents)).sort((a, b) => b.date.localeCompare(a.date));
  const cancellations = allCancellations.filter((r) => inPeriod(r.cancellationDate) && (!agent || accountAgent(r.insured) === agent)).sort((a, b) => b.cancellationDate.localeCompare(a.cancellationDate));
  const totals = endorsementTotals(endorsements);
  const money = (r: (typeof endorsements)[number]) => {
    const rate = rateOf(r.rowKey);
    const agencyCents = commissionCents(r.amountCents, rate);
    const split = splitOf(r.agent);
    return { rate, agencyCents, split, producerCents: split === null ? null : commissionCents(agencyCents, split) };
  };
  const agencyTotal = endorsements.reduce((n, r) => n + money(r).agencyCents, 0);
  const producerTotal = endorsements.reduce((n, r) => n + (money(r).producerCents ?? 0), 0);
  const agentMoney = (name: string) => {
    const rows = endorsements.filter((r) => agentLabel(r.agent) === name);
    return { agency: rows.reduce((n, r) => n + money(r).agencyCents, 0), producer: rows.some((r) => money(r).producerCents !== null) ? rows.reduce((n, r) => n + (money(r).producerCents ?? 0), 0) : null, split: rows[0] ? splitOf(rows[0].agent) : null, linked: rows[0] ? agentIdOf(rows[0].agent) : null, qqNames: [...new Set(rows.map((r) => r.agent))] };
  };
  const report = () =>
    endorsementsReport(
      endorsements.map((r) => ({ date: r.date, client: r.client, type: endorsementType(r.description, r.amountCents), description: r.description, agent: agentLabel(r.agent), amountCents: r.amountCents, ...money(r) })),
      period.from,
      period.to,
      [...(agent ? [`Agent: ${agent}`] : []), ...(sign !== 'all' ? [AMOUNT_FILTERS[sign].label] : [])]
    );
  const byAgent = endorsementsBy(endorsements, (r) => agentLabel(r.agent));
  const byType = endorsementsBy(endorsements, (r) => endorsementType(r.description, r.amountCents));
  const early = cancellations.filter((r) => daysInForce(r) <= EARLY_DAYS).length;
  const filterText = [...(agent ? [`Agent: ${agent}`] : []), ...(sign !== 'all' ? [AMOUNT_FILTERS[sign].label] : [])];
  /** Everything on the tab, as filtered: by agent, by type, the endorsements and the cancellations. */
  const fullReport = (): Report => {
    const list = report();
    const canc = cancellationsReport(cancellations.map((r) => ({ cancellationDate: r.cancellationDate, insured: r.insured, effectiveDate: r.effectiveDate, days: daysInForce(r), agent: accountAgent(r.insured) })), period.from, period.to, filterText);
    return {
      title: 'Endorsement report',
      subtitle: list.subtitle.slice(0, -1),
      columns: [{ header: 'Agent' }, { header: 'Endorsements', kind: 'count' }, { header: 'Added', kind: 'money' }, { header: 'Returned', kind: 'money' }, { header: 'Net premium', kind: 'money' }, { header: 'Agency commission', kind: 'money' }, { header: 'Producer commission', kind: 'money' }],
      rows: byAgent.map(({ key, totals: t }) => {
        const m = agentMoney(key);
        return [key, t.count, t.addedCents, t.returnedCents, t.netCents, m.agency, m.producer];
      }),
      totals: ['Total', totals.count, totals.addedCents, totals.returnedCents, totals.netCents, agencyTotal, producerTotal],
      fileBase: list.fileBase.replace(/^endorsements-/, 'endorsement-report-'),
      parts: [
        { title: 'By type', columns: [{ header: 'Type' }, { header: 'Count', kind: 'count' }, { header: 'Net premium', kind: 'money' }], rows: byType.map(({ key, totals: t }) => [key, t.count, t.netCents]), totals: ['Total', totals.count, totals.netCents] },
        { title: `Endorsements (${endorsements.length})`, columns: list.columns, rows: list.rows, totals: list.totals },
        ...(allCancellations.length ? [{ title: `Cancelled policies (${cancellations.length})`, columns: canc.columns, rows: canc.rows }] : []),
      ],
    };
  };
  const filtersActive = period.changed || !!agent || sign !== 'all';

  return (
    <>
      <Card>
        <CardHeader className="pb-3"><div><h3 className="text-sm font-semibold text-[var(--color-ink-900)]">QQCatalyst reports</h3><p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Upload the Endorsements or Cancelled policies report (PDF). RenewalIQ reads it and keeps it for the agency’s admins.</p></div></CardHeader>
        <CardBody>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void upload(Array.from(e.dataTransfer.files));
            }}
            className={cn('flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm', dragging ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-ink-200)]')}
            data-testid="qq-drop"
          >
            <UploadCloud size={22} className="text-[var(--color-ink-400)]" />
            <span className="text-[var(--color-ink-700)]">
              Drop the PDF here or{' '}
              <button type="button" className="cursor-pointer font-medium text-[var(--color-brand-700)] underline" onClick={() => input.current?.click()} disabled={busy}>
                browse
              </button>
            </span>
            {busy && <span className="text-xs text-[var(--color-ink-500)]">Reading…</span>}
            <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </div>
          {message && <p className="mt-2 text-sm text-[var(--color-ink-600)]" role="status">{message}</p>}
          {reports && reports.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="qq-reports">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-1.5 text-sm">
                  <FileText size={15} className="shrink-0 text-[var(--color-ink-400)]" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-[var(--color-ink-800)]">{r.kind === 'endorsements' ? 'Endorsements' : 'Cancelled policies'}</span>
                    <span className="text-[var(--color-ink-500)]"> · {r.period || r.fileName} · {r.rows.length} rows</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-[var(--color-ink-400)]">Uploaded {formatShortDate(r.uploadedAt.slice(0, 10))}</span>
                  <button type="button" aria-label={`Delete ${r.fileName}`} onClick={() => setRemoving(r)} className="cursor-pointer rounded p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-danger-600)]">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {reports && reports.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <PeriodPicker period={period} />
            <div>
              <label className={labelClass} htmlFor="qq-agent">Agent</label>
              <select id="qq-agent" className={inputClass} value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">All agents</option>
                {agents.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="qq-sign">Amount</label>
              <select id="qq-sign" className={inputClass} value={sign} onChange={(e) => setSign(e.target.value as AmountFilter)}>
                {(Object.keys(AMOUNT_FILTERS) as AmountFilter[]).map((k) => <option key={k} value={k}>{AMOUNT_FILTERS[k].label}</option>)}
              </select>
            </div>
          </div>
          <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--color-ink-500)]">The whole tab, as filtered:</span>
            <DownloadButtons report={fullReport} disabled={endorsements.length === 0 && cancellations.length === 0} testId="qq-full-download" />
          </div>
          {filtersActive && (
            <button type="button" className="-mt-2 w-fit cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline" onClick={() => { period.reset(); setAgent(''); setSign('all'); }}>
              Clear filters
            </button>
          )}

          <h2 className="mt-2 text-base font-semibold text-[var(--color-ink-900)]">Endorsements</h2>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="qq-totals">
            <Stat label="Endorsements" value={String(totals.count)} note={totals.noChargeCount ? `${totals.noChargeCount} at $0` : undefined} />
            <Stat label="Premium added" value={signed(totals.addedCents)} tone="good" />
            <Stat label="Premium returned" value={signed(totals.returnedCents)} tone={totals.returnedCents < 0 ? 'bad' : undefined} />
            <Stat label="Net premium" value={signed(totals.netCents)} />
            <Stat label="Agency commission" value={signed(agencyTotal)} note={`${pct(DEFAULT_AGENCY_RATE)} unless set on an endorsement`} />
            <Stat label="Producer commission" value={signed(producerTotal)} note="Agency commission × the agent’s split" />
          </dl>

          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader className="pb-3"><div><h3 className="text-sm font-semibold text-[var(--color-ink-900)]">By agent</h3></div></CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm" data-testid="qq-by-agent">
                  <thead className="text-xs text-[var(--color-ink-500)]">
                    <tr>
                      <th className={th}>Agent</th>
                      <th className={cn(th, 'text-right')}>Endorsements</th>
                      <th className={cn(th, 'text-right')}>Added</th>
                      <th className={cn(th, 'text-right')}>Returned</th>
                      <th className={cn(th, 'text-right')}>Net</th>
                      <th className={cn(th, 'text-right')}>Agency comm.</th>
                      <th className={cn(th, 'text-right')}>Producer comm.</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[var(--color-ink-50)] font-semibold" data-total-row>
                      <td className={td}>Total</td>
                      <td className={cn(td, num)}>{totals.count}</td>
                      <td className={cn(td, num, 'text-[var(--color-success-600)]')}>{signed(totals.addedCents)}</td>
                      <td className={cn(td, num, totals.returnedCents < 0 && 'text-[var(--color-danger-600)]')}>{signed(totals.returnedCents)}</td>
                      <td className={cn(td, num)}>{signed(totals.netCents)}</td>
                      <td className={cn(td, num)}>{signed(agencyTotal)}</td>
                      <td className={cn(td, num)}>{signed(producerTotal)}</td>
                    </tr>
                    {byAgent.map(({ key, totals: t }) => { const m = agentMoney(key); return (
                      <tr key={key}>
                        <td className={td}>
                          <button type="button" className="cursor-pointer text-left font-medium text-[var(--color-brand-800)] hover:underline" onClick={() => setAgent(key === agent ? '' : key)}>{key}</button>
                          {m.linked ? (
                            <span className="block text-[11px] text-[var(--color-ink-400)]">
                              {m.split === null ? 'Split not set in Team and Partners' : `Split ${pct(m.split)}`}
                              {m.qqNames.some((n) => displayName(n) !== key) && <> · QQ: {m.qqNames.map(displayName).join(', ')}</>}
                            </span>
                          ) : (
                            <select
                              aria-label={`RenewalIQ agent for ${key}`}
                              className="mt-0.5 block max-w-[180px] cursor-pointer rounded border border-[var(--color-ink-200)] bg-white px-1 py-0.5 text-[11px] text-[var(--color-brand-700)]"
                              value=""
                              onChange={async (e) => {
                                if (!agencyId || !e.target.value) return;
                                const userId = e.target.value;
                                for (const n of m.qqNames) {
                                  const res = await setQqAgentLink(agencyId, qqNameKey(n), userId);
                                  if (!res.ok) return setMessage(res.message);
                                }
                                setLinks((cur) => ({ ...cur, ...Object.fromEntries(m.qqNames.map((n) => [qqNameKey(n), userId])) }));
                              }}
                            >
                              <option value="">Link to RenewalIQ agent…</option>
                              {members.map((mm) => <option key={mm.userId} value={mm.userId}>{mm.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className={cn(td, num)}>{t.count}{t.noChargeCount ? <span className="ml-1 text-xs text-[var(--color-ink-400)]">({t.noChargeCount} at $0)</span> : null}</td>
                        <td className={cn(td, num, 'text-[var(--color-success-600)]')}>{signed(t.addedCents)}</td>
                        <td className={cn(td, num, t.returnedCents < 0 && 'text-[var(--color-danger-600)]')}>{signed(t.returnedCents)}</td>
                        <td className={cn(td, num, 'font-semibold')}>{signed(t.netCents)}</td>
                        <td className={cn(td, num)}>{signed(m.agency)}</td>
                        <td className={cn(td, num)}>{m.producer === null ? <span className="text-[var(--color-ink-400)]">—</span> : signed(m.producer)}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
            <Card className="lg:max-w-2xl">
              <CardHeader className="pb-3"><div><h3 className="text-sm font-semibold text-[var(--color-ink-900)]">By type</h3><p className="mt-0.5 text-xs text-[var(--color-ink-500)]">From each endorsement’s description.</p></div></CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm" data-testid="qq-by-type">
                  <thead className="text-xs text-[var(--color-ink-500)]">
                    <tr>
                      <th className={th}>Type</th>
                      <th className={cn(th, 'text-right')}>Count</th>
                      <th className={cn(th, 'text-right')}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[var(--color-ink-50)] font-semibold" data-total-row>
                      <td className={td}>Total</td>
                      <td className={cn(td, num)}>{totals.count}</td>
                      <td className={cn(td, num)}>{signed(totals.netCents)}</td>
                    </tr>
                    {byType.map(({ key, totals: t }) => (
                      <tr key={key}>
                        <td className={td}>{key}</td>
                        <td className={cn(td, num)}>{t.count}</td>
                        <td className={cn(td, num)}>{signed(t.netCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-wrap pb-3">
              <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">All endorsements ({endorsements.length})</h3>
              <DownloadButtons report={report} disabled={endorsements.length === 0} testId="qq-download" />
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              {endorsements.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--color-ink-500)]">No endorsements in this period.</p>
              ) : (
                <table className="w-full text-left text-sm" data-testid="qq-endorsements">
                  <thead className="text-xs text-[var(--color-ink-500)]">
                    <tr>
                      <th className={th}>Date</th>
                      <th className={th}>Client</th>
                      <th className={th}>Type</th>
                      <th className={th}>Description</th>
                      <th className={th}>Agent</th>
                      <th className={cn(th, 'text-right')}>Premium</th>
                      <th className={cn(th, 'text-right')}>Agency comm.</th>
                      <th className={cn(th, 'text-right')}>Producer comm.</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[var(--color-ink-50)] font-semibold" data-total-row>
                      <td className={td} colSpan={5}>Total ({endorsements.length}{endorsements.length > shown ? `, ${shown} shown` : ''})</td>
                      <td className={cn(td, num)}>{signed(totals.netCents)}</td>
                      <td className={cn(td, num)}>{signed(agencyTotal)}</td>
                      <td className={cn(td, num)}>{signed(producerTotal)}</td>
                    </tr>
                    {endorsements.slice(0, shown).map((r, i) => (
                      <tr key={`${endorsementKey(r)}-${i}`} className="align-top">
                        <td className={cn(td, 'whitespace-nowrap text-[var(--color-ink-700)]')}>{formatShortDate(r.date)}</td>
                        <td className={cn(td, 'min-w-[160px] text-[var(--color-ink-800)]')}>{r.client}</td>
                        <td className={cn(td, 'whitespace-nowrap text-[var(--color-ink-600)]')}>{endorsementType(r.description, r.amountCents)}</td>
                        <td className={cn(td, 'min-w-[220px] max-w-[360px] text-xs text-[var(--color-ink-600)]')}>
                          <span className="line-clamp-3 whitespace-pre-line" title={r.description}>{r.description}</span>
                        </td>
                        <td className={cn(td, 'whitespace-nowrap text-[var(--color-ink-700)]')}>{agentLabel(r.agent)}</td>
                        <td className={cn(td, num, 'font-semibold', r.amountCents > 0 ? 'text-[var(--color-success-600)]' : r.amountCents < 0 ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]')}>{signed(r.amountCents)}</td>
                        {(() => {
                          const m = money(r);
                          return (
                            <>
                              <td className={cn(td, num)} data-testid="qq-agency-comm">
                                {signed(m.agencyCents)}
                                <button
                                  type="button"
                                  onClick={() => setRateFor({ rowKey: r.rowKey, label: `${r.client} · ${formatShortDate(r.date)} · ${signed(r.amountCents)}`, rate: m.rate })}
                                  className={cn('mt-0.5 block w-full cursor-pointer text-right text-[11px] hover:underline', r.rowKey in rates ? 'font-medium text-[var(--color-brand-700)]' : 'text-[var(--color-ink-400)]')}
                                >
                                  {pct(m.rate)} · Set rate
                                </button>
                              </td>
                              <td className={cn(td, num)}>{m.producerCents === null ? <span className="text-[var(--color-ink-400)]">—</span> : signed(m.producerCents)}</td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {endorsements.length > shown && (
                <div className="px-4 py-3">
                  <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + LIST_STEP)}>Show more ({endorsements.length - shown})</Button>
                </div>
              )}
            </CardBody>
          </Card>

          <h2 className="mt-2 text-base font-semibold text-[var(--color-ink-900)]">Cancellations</h2>
          {allCancellations.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-500)]">Upload a Cancelled policies report to see cancellations.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Cancelled policies" value={String(cancellations.length)} />
                <Stat label={`Cancelled within ${EARLY_DAYS} days`} value={String(early)} tone={early ? 'bad' : undefined} note="of the policy start" />
              </dl>
              <div className="-mb-1 flex justify-end">
                <DownloadButtons
                  testId="qq-cancel-download"
                  disabled={cancellations.length === 0}
                  report={() => cancellationsReport(cancellations.map((r) => ({ cancellationDate: r.cancellationDate, insured: r.insured, effectiveDate: r.effectiveDate, days: daysInForce(r), agent: accountAgent(r.insured) })), period.from, period.to, agent ? [`Agent: ${agent}`] : [])}
                />
              </div>
              <Card>
                <CardBody className="overflow-x-auto p-0">
                  <table className="w-full text-left text-sm" data-testid="qq-cancellations">
                    <thead className="text-xs text-[var(--color-ink-500)]">
                      <tr>
                        <th className={th}>Cancelled on</th>
                        <th className={th}>Client</th>
                        <th className={th}>Policy start</th>
                        <th className={cn(th, 'text-right')}>Days in force</th>
                        <th className={th}>Agent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cancellations.map((r, i) => (
                        <tr key={`${cancellationKey(r)}-${i}`}>
                          <td className={cn(td, 'whitespace-nowrap')}>{formatShortDate(r.cancellationDate)}</td>
                          <td className={cn(td, 'text-[var(--color-ink-800)]')}>{r.insured}</td>
                          <td className={cn(td, 'whitespace-nowrap text-[var(--color-ink-600)]')}>{formatShortDate(r.effectiveDate)}</td>
                          <td className={cn(td, num, daysInForce(r) <= EARLY_DAYS && 'font-semibold text-[var(--color-danger-600)]')}>{daysInForce(r)}</td>
                          <td className={cn(td, 'text-[var(--color-ink-700)]')}>{accountAgent(r.insured) || <span className="text-[var(--color-ink-400)]" title="No RenewalIQ account with this name">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
      {reports && reports.length === 0 && !message && (
        <EmptyState icon={<FileText size={28} strokeWidth={1.5} />} title="No reports yet" description="Upload a QQCatalyst Endorsements or Cancelled policies report to see it here." />
      )}

      {rateFor && <RateDialog target={rateFor} onClose={() => setRateFor(null)} onSave={async (rate) => {
        if (!agencyId) return 'Rates are kept for agencies signed in to the cloud.';
        const res = await setQqRate(agencyId, rateFor.rowKey, rate);
        if (!res.ok) return res.message;
        setRates((cur) => {
          const next = { ...cur };
          if (rate === null) delete next[rateFor.rowKey];
          else next[rateFor.rowKey] = rate;
          return next;
        });
        return null;
      }} />}
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteQqReport(removing.id);
          if (res.ok) setReports((cur) => (cur ?? []).filter((r) => r.id !== removing.id));
          else setMessage(res.message);
          setRemoving(null);
        }}
        title="Delete this report?"
        description={`${removing?.fileName ?? ''} and the ${removing?.rows.length ?? 0} rows read from it are removed.`}
        confirmLabel="Delete"
      />
    </>
  );
}

/** Set the agency commission rate on one endorsement (or go back to the default 10%). */
function RateDialog({ target, onClose, onSave }: { target: { label: string; rate: number }; onClose: () => void; onSave: (rate: number | null) => Promise<string | null> }) {
  const [value, setValue] = useState(String(+(target.rate * 100).toFixed(2)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async (rate: number | null) => {
    setSaving(true);
    const err = await onSave(rate);
    setSaving(false);
    if (err) return setError(err);
    onClose();
  };
  const submit = () => {
    const n = Number(value.replace('%', '').trim());
    if (!value.trim() || !Number.isFinite(n) || n < 0 || n > 100) return setError('Enter a rate from 0 to 100%.');
    void save(+(n / 100).toFixed(4));
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Agency commission rate"
      footer={
        <>
          <Button variant="secondary" onClick={() => void save(null)} disabled={saving}>Back to {pct(DEFAULT_AGENCY_RATE)}</Button>
          <Button onClick={submit} disabled={saving}>Save rate</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--color-ink-600)]">{target.label}</p>
      <label className={labelClass} htmlFor="qq-rate">Rate (%)</label>
      <input id="qq-rate" inputMode="decimal" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
      {error && <p className="mt-2 text-sm text-[var(--color-danger-600)]" role="alert">{error}</p>}
    </Modal>
  );
}
