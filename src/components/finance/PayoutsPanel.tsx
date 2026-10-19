import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardBody, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { formatRate } from '../workspace/PoliciesSection';
import { DownloadButtons } from '../analytics/DownloadButtons';
import { DialogError, ReasonDialog } from './CommissionsPanel';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useLedger } from '../../hooks/useLedger';
import * as repo from '../../services/supabase/payoutRepo';
import { KIND_LABELS, describeSchedule, type LedgerStream } from '../../services/finance/ledger';
import {
  RUN_STATE_LABELS,
  agentBalances,
  baseCents,
  readyLines,
  runPeriodLabel,
  runState,
  runTotals,
  waitingReason,
  type CarriedAmount,
  type PayoutItem,
  type PayoutLine,
  type PayoutRun,
  type RunDetails,
  type RunState,
} from '../../services/finance/payouts';
import { formatCents, parseMoneyCents } from '../../services/workflow/policies';
import { formatShortDate, toLocalDateKey } from '../../services/workflow/dates';
import type { Report } from '../../services/reports/report';

const th = 'whitespace-nowrap border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 align-top text-sm text-[var(--color-ink-800)]';
const num = 'whitespace-nowrap text-right tabular-nums';
const money = (c: number) => <span className={c < 0 ? 'text-[var(--color-danger-600)]' : undefined}>{formatCents(c)}</span>;
const STATE_TONE: Record<RunState, 'neutral' | 'warning' | 'info' | 'success'> = { open: 'neutral', review: 'warning', approved: 'info', paid: 'success', closed: 'neutral' };

type Result = { ok: true } | { ok: false; message: string };
type Run = (action: () => Promise<Result>, done: string) => Promise<boolean>;

/**
 * Payouts (0065), for admins. Weekly runs pay policies (Monday–Sunday, the following Friday); monthly
 * runs pay endorsements. A run takes every verified record due by its payday that isn't paid yet; an admin
 * approves each agent's payout (or all the ready ones), marks it paid with the date, and sees each
 * agent's balance — one across both kinds of payout. The database works out every amount.
 */
export function PayoutsPanel() {
  const ledger = useLedger();
  const [stream, setStream] = useState<LedgerStream>('weekly');
  const [overview, setOverview] = useState<{ status: 'loading' | 'ready' | 'unavailable'; data: repo.PayoutOverview | null; message?: string }>({ status: 'loading', data: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await repo.fetchPayoutOverview();
    setOverview(res.ok ? { status: 'ready', data: res.data } : { status: 'unavailable', data: null, message: res.message });
    return res.ok ? res.data : null;
  }, []);
  const loadDetails = useCallback(async (runId: string | null) => {
    if (!runId) return setDetails(null);
    const res = await repo.fetchRunDetails(runId);
    if (res.ok) setDetails(res.data);
    else setNotice({ tone: 'bad', text: res.message });
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runs = useMemo(() => (overview.data?.runs ?? []).filter((r) => r.stream === stream), [overview.data, stream]);
  const openRun = runs.find((r) => !r.closedAt) ?? null;
  // Show the run picked, else the open run of this kind (or the latest).
  useEffect(() => {
    if (overview.status !== 'ready') return;
    const pick = selected && runs.some((r) => r.id === selected) ? selected : (openRun ?? runs[0])?.id ?? null;
    if (pick !== selected) setSelected(pick);
  }, [overview.status, runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useRef<string | null>(null);
  useEffect(() => {
    shown.current = selected;
    void loadDetails(selected);
  }, [selected, loadDetails]);

  const run: Run = async (action, done) => {
    const res = await action();
    if (!res.ok) {
      setNotice({ tone: 'bad', text: res.message });
      return false;
    }
    setNotice({ tone: 'good', text: done });
    await loadOverview();
    await loadDetails(shown.current);
    return true;
  };

  if (overview.status === 'loading') return <Card><CardBody className="pt-5 text-sm text-[var(--color-ink-500)]">Loading payouts…</CardBody></Card>;
  if (overview.status === 'unavailable' || !overview.data)
    return (
      <Card>
        <CardBody className="pt-5 text-sm text-[var(--color-ink-600)]" data-testid="payouts-unavailable">
          {overview.message ?? 'Payouts aren’t available right now.'}
        </CardBody>
      </Card>
    );

  const words = ledger.data ? describeSchedule(ledger.data.schedule) : null;
  const payouts = overview.data.payouts;
  return (
    <div className="flex flex-col gap-4" data-testid="payouts-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-ink-100)] text-sm" role="group" aria-label="Kind of payout">
          {(['weekly', 'monthly'] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`payout-stream-${s}`}
              aria-pressed={stream === s}
              onClick={() => (setStream(s), setNotice(null), setSelected(null))}
              className={`cursor-pointer px-3 py-1.5 ${stream === s ? 'bg-[var(--color-brand-800)] font-medium text-white' : 'bg-white text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'}`}
            >
              {s === 'weekly' ? 'Weekly · policies' : 'Monthly · endorsements'}
            </button>
          ))}
        </div>
        {words && <p className="text-xs text-[var(--color-ink-500)]">{stream === 'weekly' ? words.weekly : words.monthly} Paid on binding and verification — never waiting for the carrier.</p>}
      </div>
      {notice && (
        <p
          className={notice.tone === 'good' ? 'rounded-lg border border-[var(--color-success-600)]/25 bg-[var(--color-success-100)] px-3 py-2 text-sm text-[var(--color-success-600)]' : 'rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]'}
          role={notice.tone === 'good' ? 'status' : 'alert'}
          data-testid="payout-notice"
        >
          {notice.text}
        </p>
      )}
      <RunsList runs={runs} payouts={payouts} selected={selected} onOpen={setSelected} stream={stream} openRun={openRun} run={run} onStarted={setSelected} />
      {details && details.run.stream === stream && <RunDetail d={details} run={run} />}
      <BalancesSection overview={overview.data} run={run} />
    </div>
  );
}

// ─────────────────────────────── runs ───────────────────────────────

function RunsList({ runs, payouts, selected, onOpen, stream, openRun, run, onStarted }: { runs: PayoutRun[]; payouts: repo.PayoutOverview['payouts']; selected: string | null; onOpen: (id: string) => void; stream: LedgerStream; openRun: PayoutRun | null; run: Run; onStarted: (id: string) => void }) {
  const [first, setFirst] = useState('');
  const start = async () => {
    let id = '';
    const ok = await run(async () => {
      const res = await repo.createPayoutRun(stream, runs.length === 0 && first ? first : undefined);
      if (res.ok) id = res.data;
      return res.ok ? { ok: true } : res;
    }, 'Run started.');
    if (ok && id) onStarted(id);
  };
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{stream === 'weekly' ? 'Weekly policy payouts' : 'Monthly endorsement payouts'}</h3>
            <p className="text-xs text-[var(--color-ink-500)]">One open run at a time; the next one starts where the last ended.</p>
          </div>
          {!openRun && (
            <div className="flex flex-wrap items-end gap-2">
              {runs.length === 0 && (
                <div>
                  <label className={labelClass} htmlFor="first-run-start">First period (optional)</label>
                  <input id="first-run-start" type="date" className={inputClass} value={first} onChange={(e) => setFirst(e.target.value)} />
                </div>
              )}
              <Button size="sm" onClick={() => void start()} data-testid="start-run">
                {runs.length === 0 ? (first ? 'Start the first run' : 'Start with the last period that ended') : 'Start the next run'}
              </Button>
            </div>
          )}
        </div>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-600)]" data-testid="no-runs">No runs yet. Records stay verified and wait until a run pays them.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse" data-testid="payout-runs">
              <thead>
                <tr>
                  <th className={th}>Period</th>
                  <th className={th}>Payday</th>
                  <th className={th}>Status</th>
                  <th className={`${th} ${num}`}>Agents approved</th>
                  <th className={`${th} ${num}`}>To pay</th>
                  <th className={`${th} ${num}`}>Carried</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const mine = payouts.filter((p) => p.runId === r.id && p.status !== 'cancelled');
                  const state = runState(r, payouts);
                  return (
                    <tr key={r.id} data-run={r.id} className={selected === r.id ? 'bg-[var(--color-brand-50)]' : undefined}>
                      <td className={td}>{runPeriodLabel(r)}</td>
                      <td className={td}>{formatShortDate(r.payDate)}</td>
                      <td className={td}><Badge tone={STATE_TONE[state]}>{RUN_STATE_LABELS[state]}</Badge></td>
                      <td className={`${td} ${num}`}>{mine.length}</td>
                      <td className={`${td} ${num}`}>{formatCents(mine.reduce((s, p) => s + p.payCents, 0))}</td>
                      <td className={`${td} ${num}`}>{money(mine.reduce((s, p) => s + p.carriedCents, 0))}</td>
                      <td className={`${td} text-right`}>
                        <Button size="sm" variant={selected === r.id ? 'secondary' : 'ghost'} onClick={() => onOpen(r.id)}>{selected === r.id ? 'Shown' : 'Open'}</Button>
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
  );
}

type Dialog =
  | { kind: 'approve'; line: PayoutLine }
  | { kind: 'approve-all'; lines: PayoutLine[] }
  | { kind: 'paid'; line: PayoutLine }
  | { kind: 'adjust'; line: PayoutLine }
  | { kind: 'close' }
  | { kind: 'reason'; title: string; label: string; confirm: string; description?: string; onConfirm: (r: string) => Promise<boolean> };

function RunDetail({ d, run }: { d: RunDetails; run: Run }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const r = d.run;
  const totals = runTotals(d.lines);
  const ready = readyLines(d);
  const open = !r.closedAt;
  const reason = (title: string, label: string, confirm: string, onConfirm: (x: string) => Promise<boolean>, description?: string) => setDialog({ kind: 'reason', title, label, confirm, onConfirm, description });
  const report = (): Report => ({
    title: `Payouts — ${runPeriodLabel(r)}`,
    subtitle: [`Payday ${r.payDate}`, 'Agent commission = net × 10% × the agent’s split, as recorded'],
    columns: [{ header: 'Agent' }, { header: 'Status' }, { header: 'Record' }, { header: 'Account' }, { header: 'Date', kind: 'date' }, { header: 'Net', kind: 'money' }, { header: 'Split' }, { header: 'Agent commission', kind: 'money' }],
    rows: d.lines.flatMap((l) => [
      ...l.items.map((i) => [l.agentName, l.status, recordLabel(i), i.clientName, i.eventDate, i.netCents, i.agentRate === null ? '' : formatRate(i.agentRate), i.agentCents]),
      ...l.adjustments.map((a) => [l.agentName, l.status, `Adjustment: ${a.reason}`, '', a.createdAt.slice(0, 10), null, '', a.amountCents]),
      ...(l.recoveredCents ? [[l.agentName, l.status, 'Recovered from earlier balance', '', null, null, '', -l.recoveredCents]] : []),
      [l.agentName, l.status, l.payCents === 0 && l.carriedCents < 0 ? `To pay (carried ${formatCents(l.carriedCents)})` : 'To pay', '', null, null, '', l.payCents],
    ]),
    fileBase: `payouts-${r.stream}-${r.periodStart}`,
  });
  return (
    <Card data-testid="run-detail" data-run={r.id}>
      <CardBody className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-ink-900)]">{runPeriodLabel(r)}</h3>
            <p className="text-xs text-[var(--color-ink-500)]">
              Payday {formatShortDate(r.payDate)}
              {r.closedAt ? ` · closed ${formatShortDate(r.closedAt.slice(0, 10))}${r.closeNote ? ` — ${r.closeNote}` : ''}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButtons report={report} disabled={d.lines.length === 0} testId="run-download" />
            {open && r.periodOver && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'close' })} data-testid="close-run">Close run…</Button>
            )}
            {ready.length > 0 && (
              <Button size="sm" onClick={() => setDialog({ kind: 'approve-all', lines: ready })} data-testid="approve-all">Approve all ready ({ready.length})</Button>
            )}
          </div>
        </div>
        {open && !r.periodOver && (
          <p className="rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2 text-sm text-[var(--color-ink-600)]" data-testid="period-open">
            The period ends {formatShortDate(r.periodEnd)}. The amounts change as records are verified; payouts can be approved once it’s over.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="run-tiles">
          <Tile label="Commission in this run" cents={totals.commissionCents} />
          <Tile label="Cancellations & corrections" cents={totals.deductionsCents} />
          <Tile label="Adjustments" cents={totals.adjustmentsCents} />
          <Tile label="Recovered from earlier balances" cents={-totals.recoveredCents} />
          <Tile label={`To pay on ${formatShortDate(r.payDate)}`} cents={totals.payCents} strong testId="run-to-pay" />
          <Tile label="Carried to agents’ balances" cents={totals.carriedCents} />
        </div>
        {d.lines.length === 0 && <p className="text-sm text-[var(--color-ink-600)]" data-testid="run-empty">Nothing to pay in this run yet.</p>}
        {d.lines.map((l) => (
          <LineCard key={l.agent} line={l} d={d} setDialog={setDialog} reason={reason} run={run} />
        ))}
        <WaitingList d={d} reason={reason} run={run} />
      </CardBody>
      <RunDialogs dialog={dialog} d={d} run={run} onClose={() => setDialog(null)} />
    </Card>
  );
}

function Tile({ label, cents, strong, testId }: { label: string; cents: number; strong?: boolean; testId?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid={testId}>
      <p className="text-[11px] text-[var(--color-ink-500)]">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-lg font-semibold text-[var(--color-ink-900)]' : 'text-base font-medium text-[var(--color-ink-800)]'}`}>{money(cents)}</p>
    </div>
  );
}

const recordLabel = (i: Pick<PayoutItem, 'kind' | 'policyNumber' | 'originalPolicyNumber'>) =>
  `${KIND_LABELS[i.kind]} ${i.policyNumber ?? ''}${i.kind !== 'policy' && i.originalPolicyNumber && i.originalPolicyNumber !== i.policyNumber ? ` (of ${i.originalPolicyNumber})` : ''}`.trim();

const LINE_STATUS: Record<PayoutLine['status'], { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' }> = {
  draft: { label: 'Not approved', tone: 'warning' },
  approved: { label: 'Approved · not paid yet', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
};

function LineCard({ line: l, d, setDialog, reason, run }: { line: PayoutLine; d: RunDetails; setDialog: (x: Dialog) => void; reason: (title: string, label: string, confirm: string, onConfirm: (x: string) => Promise<boolean>, description?: string) => void; run: Run }) {
  const r = d.run;
  const draft = l.status === 'draft';
  const canAct = !r.closedAt;
  const st = draft && !r.periodOver ? { label: 'Open', tone: 'neutral' as const } : LINE_STATUS[l.status];
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-ink-100)]" data-testid={`payout-line-${l.agent}`} data-status={l.status}>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-ink-50)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-ink-900)]">{l.agentName}</span>
          <Badge tone={st.tone}>{st.label}</Badge>
          {l.lineCents < 0 && <Badge tone="danger">Negative: nothing to pay</Badge>}
        </div>
        <p className="text-right">
          <span className="block text-[11px] text-[var(--color-ink-500)]">To pay</span>
          <span className="text-lg font-semibold tabular-nums text-[var(--color-ink-900)]" data-field="pay">{formatCents(l.payCents)}</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Record</th>
              <th className={th}>Account</th>
              <th className={th}>Date</th>
              <th className={`${th} ${num}`}>Net premium</th>
              <th className={`${th} ${num}`}>10% base</th>
              <th className={`${th} ${num}`}>Split</th>
              <th className={`${th} ${num}`}>Agent commission</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {l.items.map((i) => (
              <tr key={i.transactionId} data-item={i.transactionId}>
                <td className={td}>
                  <span className="font-medium">{recordLabel(i)}</span>
                  {i.late && <Badge tone="info" className="ml-1.5">From an earlier period</Badge>}
                  {i.origin === 'historical' && <Badge tone="neutral" className="ml-1.5">Historical, reviewed</Badge>}
                </td>
                <td className={td}><Link to={`/accounts/${i.submissionId}?tab=quotes`} className="text-[var(--color-brand-800)] hover:underline">{i.clientName}</Link></td>
                <td className={`${td} whitespace-nowrap`}>{formatShortDate(i.eventDate)}{i.kind === 'cancellation' || i.kind === 'correction' ? <span className="block text-[11px] text-[var(--color-ink-500)]">approved {formatShortDate(i.payableFrom)}</span> : null}</td>
                <td className={`${td} ${num}`}>{money(i.netCents)}</td>
                <td className={`${td} ${num}`}>{money(baseCents(i.netCents))}</td>
                <td className={`${td} ${num}`}>{i.agentRate === null ? '—' : formatRate(i.agentRate)}</td>
                <td className={`${td} ${num} font-medium`}>{money(i.agentCents)}</td>
                <td className={`${td} text-right`}>
                  {draft && canAct && i.agentCents >= 0 && (
                    <Button size="sm" variant="ghost" onClick={() => reason('Hold this record out of this run', 'Reason', 'Hold', (x) => run(() => repo.holdPayoutRecord(r.id, i.transactionId, x), `${recordLabel(i)} held: it’s due again in the next run.`), 'It stays verified and is due again in the next run.')}>
                      Hold
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {l.adjustments.map((a) => (
              <tr key={a.id} data-adjustment={a.id}>
                <td className={td} colSpan={6}>Adjustment — {a.reason}</td>
                <td className={`${td} ${num} font-medium`}>{money(a.amountCents)}</td>
                <td className={`${td} text-right`}>
                  {draft && canAct && (
                    <Button size="sm" variant="ghost" onClick={() => reason('Void this adjustment', 'Reason', 'Void', (x) => run(() => repo.voidPayoutAdjustment(a.id, x), 'Adjustment voided.'))}>Void</Button>
                  )}
                </td>
              </tr>
            ))}
            <SumRow label="Records and adjustments" cents={l.lineCents} />
            {l.balanceBeforeCents < 0 && <SumRow label={`Recovered from earlier balance (owed ${formatCents(-l.balanceBeforeCents)})`} cents={-l.recoveredCents} />}
            {l.carriedCents < 0 && <SumRow label="Carried to the agent’s balance (recovered from later payouts)" cents={l.carriedCents} />}
            <SumRow label="To pay" cents={l.payCents} strong />
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-ink-100)] px-3 py-2">
        {draft && canAct && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'adjust', line: l })}>Add adjustment</Button>
            <Button size="sm" disabled={!r.periodOver} onClick={() => setDialog({ kind: 'approve', line: l })} data-testid="approve-line">
              {l.payCents === 0 && l.carriedCents < 0 ? `Approve: carry ${formatCents(l.carriedCents)}` : `Approve ${formatCents(l.payCents)}`}
            </Button>
          </>
        )}
        {l.status === 'approved' && (
          <>
            <span className="mr-auto text-xs text-[var(--color-ink-500)]">Approved {l.approvedAt ? formatShortDate(l.approvedAt.slice(0, 10)) : ''}. Locked.</span>
            {canAct && (
              <Button size="sm" variant="ghost" onClick={() => reason('Undo this approval', 'Reason', 'Undo approval', (x) => run(() => repo.cancelPayoutApproval(l.payoutId!, x), `Approval undone for ${l.agentName}: the records are back in this run.`), 'Only before it’s paid. The records go back into this run and anything it recovered is released.')}>
                Undo approval…
              </Button>
            )}
            {l.payCents > 0 ? (
              <Button size="sm" onClick={() => setDialog({ kind: 'paid', line: l })} data-testid="mark-paid">Mark paid…</Button>
            ) : (
              <span className="text-xs text-[var(--color-ink-600)]">Nothing to pay — the negative amount is on the agent’s balance.</span>
            )}
          </>
        )}
        {l.status === 'paid' && <span className="text-xs text-[var(--color-success-600)]" data-field="paid">Paid {l.paidOn ? formatShortDate(l.paidOn) : ''}{l.paidReference ? ` · ${l.paidReference}` : ''}</span>}
      </div>
    </div>
  );
}

function SumRow({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'bg-[var(--color-ink-50)]' : undefined}>
      <td className={`${td} ${strong ? 'font-semibold' : 'text-[var(--color-ink-600)]'}`} colSpan={6}>{label}</td>
      <td className={`${td} ${num} ${strong ? 'font-semibold' : ''}`}>{money(cents)}</td>
      <td className={td} />
    </tr>
  );
}

function WaitingList({ d, reason, run }: { d: RunDetails; reason: (title: string, label: string, confirm: string, onConfirm: (x: string) => Promise<boolean>, description?: string) => void; run: Run }) {
  if (d.waiting.length === 0) return null;
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3" data-testid="run-waiting">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Due by this payday, not payable yet ({d.waiting.length})</h4>
      <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Verified before the agent’s payout is approved, a record joins this run; later, the next open run. Never paid twice.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full border-collapse">
          <tbody>
            {d.waiting.map((w) => (
              <tr key={w.transactionId} data-waiting={w.transactionId}>
                <td className={td}>{recordLabel(w)} · <Link to={`/accounts/${w.submissionId}?tab=quotes`} className="text-[var(--color-brand-800)] hover:underline">{w.clientName}</Link></td>
                <td className={td}>{w.agentName}</td>
                <td className={`${td} whitespace-nowrap`}>{formatShortDate(w.eventDate)}</td>
                <td className={td} data-field="why">{waitingReason(w)}</td>
                <td className={`${td} ${num}`}>{money(w.agentCents)}</td>
                <td className={`${td} text-right`}>
                  {w.holdId && !d.run.closedAt && (
                    <Button size="sm" variant="ghost" onClick={() => reason('Release this hold', 'Reason', 'Release', (x) => run(() => repo.releasePayoutHold(w.holdId!, x), 'Released: it’s back in this run.'))}>Release</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────── dialogs ───────────────────────────────

function RunDialogs({ dialog, d, run, onClose }: { dialog: Dialog | null; d: RunDetails; run: Run; onClose: () => void }) {
  if (!dialog) return null;
  if (dialog.kind === 'reason') return <ReasonDialog {...dialog} onClose={onClose} />;
  if (dialog.kind === 'approve') return <ApproveDialog lines={[dialog.line]} d={d} run={run} onClose={onClose} />;
  if (dialog.kind === 'approve-all') return <ApproveDialog lines={dialog.lines} d={d} run={run} onClose={onClose} />;
  if (dialog.kind === 'paid') return <PaidDialog line={dialog.line} d={d} run={run} onClose={onClose} />;
  if (dialog.kind === 'adjust') return <AdjustDialog line={dialog.line} d={d} run={run} onClose={onClose} />;
  return <CloseDialog d={d} run={run} onClose={onClose} />;
}

function DialogShell({ title, subtitle, confirm, busy, onConfirm, onClose, children, testId }: { title: string; subtitle?: string; confirm: string; busy: boolean; onConfirm: () => void; onClose: () => void; children: ReactNode; testId: string }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={onConfirm}>{confirm}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid={testId}>{children}</div>
    </Modal>
  );
}

function ApproveDialog({ lines, d, run, onClose }: { lines: PayoutLine[]; d: RunDetails; run: Run; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const one = lines.length === 1 ? lines[0] : null;
  const total = lines.reduce((s, l) => s + l.payCents, 0);
  const go = async () => {
    setBusy(true);
    const ok = one
      ? await run(() => repo.approvePayout(d.run.id, one.agent, one.payCents, one.itemCount, note), `Approved: ${one.agentName}, ${formatCents(one.payCents)}.`)
      : await run(() => repo.approvePayoutRun(d.run.id, lines.map((l) => ({ agent: l.agent, payCents: l.payCents, items: l.itemCount })), note), `Approved ${lines.length} payouts, ${formatCents(total)} to pay.`);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <DialogShell
      title={one ? `Approve ${one.agentName}’s payout` : `Approve ${lines.length} payouts`}
      subtitle={`${runPeriodLabel(d.run)} · payday ${formatShortDate(d.run.payDate)}`}
      confirm={one ? (one.payCents === 0 && one.carriedCents < 0 ? `Approve: carry ${formatCents(one.carriedCents)}` : `Approve ${formatCents(one.payCents)}`) : `Approve ${formatCents(total)}`}
      busy={busy}
      onConfirm={() => void go()}
      onClose={onClose}
      testId="approve-dialog"
    >
      <table className="min-w-full border-collapse">
        <tbody>
          {lines.map((l) => (
            <tr key={l.agent}>
              <td className={td}>{l.agentName} · {l.itemCount} {l.itemCount === 1 ? 'record' : 'records'}{l.adjustments.length ? ` + ${l.adjustments.length} adjustment${l.adjustments.length === 1 ? '' : 's'}` : ''}</td>
              <td className={`${td} ${num}`}>
                {formatCents(l.payCents)}
                {l.recoveredCents > 0 && <span className="block text-[11px] text-[var(--color-ink-500)]">after {formatCents(l.recoveredCents)} recovered</span>}
                {l.carriedCents < 0 && <span className="block text-[11px] text-[var(--color-danger-600)]">{formatCents(l.carriedCents)} carried</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-[var(--color-ink-600)]">Approving locks these records and amounts. Only verified records without open questions are in them; anything verified later goes into the next run.</p>
      <div>
        <label className={labelClass} htmlFor="approve-note">Note (optional)</label>
        <input id="approve-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
    </DialogShell>
  );
}

function PaidDialog({ line, d, run, onClose }: { line: PayoutLine; d: RunDetails; run: Run; onClose: () => void }) {
  const today = toLocalDateKey(new Date());
  const [date, setDate] = useState(d.run.payDate <= today ? d.run.payDate : today);
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(''), [date, ref]);
  const go = async () => {
    if (!date) return setError('Enter the date it was paid.');
    if (date > today) return setError('The payment date can’t be in the future.');
    setBusy(true);
    const ok = await run(() => repo.markPayoutPaid(line.payoutId!, date, ref), `Marked paid: ${line.agentName}, ${formatCents(line.payCents)} on ${formatShortDate(date)}.`);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <DialogShell title={`Mark ${line.agentName}’s payout as paid`} subtitle={`${formatCents(line.payCents)} · ${runPeriodLabel(d.run)}`} confirm="Mark paid" busy={busy} onConfirm={() => void go()} onClose={onClose} testId="paid-dialog">
      <DialogError text={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="paid-on">Date paid</label>
          <input id="paid-on" type="date" className={inputClass} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="paid-ref">Payment reference (optional)</label>
          <input id="paid-ref" className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} placeholder="e.g. ACH batch number" />
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-600)]">A paid payout can’t be changed. A mistake is fixed with a correction or an adjustment in a later run.</p>
    </DialogShell>
  );
}

function AdjustDialog({ line, d, run, onClose }: { line: PayoutLine; d: RunDetails; run: Run; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(''), [amount, why]);
  const go = async () => {
    const cents = parseMoneyCents(amount);
    if (cents === null || Number.isNaN(cents) || cents === 0) return setError('Enter the adjustment, e.g. 25.00 or -25.00.');
    if (!why.trim()) return setError('Say why the payout is adjusted.');
    setBusy(true);
    const ok = await run(() => repo.addPayoutAdjustment(d.run.id, line.agent, cents, why.trim()), `Adjustment of ${formatCents(cents)} added to ${line.agentName}’s payout.`);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <DialogShell title={`Adjust ${line.agentName}’s payout`} subtitle={runPeriodLabel(d.run)} confirm="Add adjustment" busy={busy} onConfirm={() => void go()} onClose={onClose} testId="adjust-dialog">
      <DialogError text={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="adj-amount">Amount (+ or −, $)</label>
          <input id="adj-amount" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. -25.00" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="adj-reason">Reason (the agent sees it)</label>
          <input id="adj-reason" className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} />
        </div>
      </div>
    </DialogShell>
  );
}

function CloseDialog({ d, run, onClose }: { d: RunDetails; run: Run; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const waitingAgents = d.lines.filter((l) => l.status === 'draft' && l.itemCount > 0);
  const go = async () => {
    setBusy(true);
    const ok = await run(() => repo.closePayoutRun(d.run.id, note), 'Run closed. What wasn’t approved is due in the next run.');
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <DialogShell title="Close this run" subtitle={runPeriodLabel(d.run)} confirm="Close run" busy={busy} onConfirm={() => void go()} onClose={onClose} testId="close-dialog">
      {waitingAgents.length > 0 ? (
        <p className="text-sm text-[var(--color-ink-700)]">Not approved: {waitingAgents.map((l) => l.agentName).join(', ')}. Their records stay verified and go into the next run.</p>
      ) : (
        <p className="text-sm text-[var(--color-ink-700)]">Every agent’s payout is approved. Approved payouts can still be marked paid after closing.</p>
      )}
      <div>
        <label className={labelClass} htmlFor="close-note">{waitingAgents.length > 0 ? 'Why they wait for the next run' : 'Note (optional)'}</label>
        <input id="close-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
    </DialogShell>
  );
}

// ─────────────────────────────── balances ───────────────────────────────

function BalancesSection({ overview, run }: { overview: repo.PayoutOverview; run: Run }) {
  const members = useAccountsStore((s) => s.agencyMembers);
  const [writeOff, setWriteOff] = useState<CarriedAmount | null>(null);
  const balances = agentBalances(overview.balances).filter((b) => b.carried.length > 0);
  const payoutRun = (payoutId: string | null) => {
    const p = overview.payouts.find((x) => x.id === payoutId);
    return p ? overview.runs.find((r) => r.id === p.runId) : undefined;
  };
  const name = (id: string) => members.find((m) => m.userId === id)?.name ?? overview.payouts.find((p) => p.agentUserId === id)?.agentName ?? 'Agent';
  const from = (payoutId: string | null) => {
    const r = payoutRun(payoutId);
    return r ? `${runPeriodLabel(r)} (payday ${formatShortDate(r.payDate)})` : 'a payout';
  };
  return (
    <Card data-testid="agent-balances">
      <CardBody className="pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Agents’ commission balances</h3>
        <p className="text-xs text-[var(--color-ink-500)]">One balance per agent across weekly and monthly payouts. A payout that ends below zero carries the amount here; later payouts recover it, oldest first, never more than is left. Nothing is ever taken from an agent outside payouts.</p>
        {balances.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-600)]">No agent owes anything from earlier payouts.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {balances.map((b) => (
              <div key={b.agentUserId} className="rounded-lg border border-[var(--color-ink-100)] p-3" data-testid={`balance-${b.agentUserId}`}>
                <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <strong>{name(b.agentUserId)}</strong>
                  <span>{b.balanceCents < 0 ? <>Owes <strong className="tabular-nums text-[var(--color-danger-600)]" data-field="owed">{formatCents(-b.balanceCents)}</strong> from earlier payouts</> : <span className="text-[var(--color-success-600)]" data-field="owed">Nothing owed</span>}</span>
                </p>
                <ul className="mt-2 flex flex-col gap-2 text-sm">
                  {b.carried.map((c) => (
                    <li key={c.entry.id} className="border-t border-[var(--color-ink-50)] pt-2" data-carried={c.entry.id}>
                      <p className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <strong className="tabular-nums text-[var(--color-danger-600)]">{formatCents(c.entry.amountCents)}</strong> carried from {from(c.entry.payoutId)}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-[var(--color-ink-600)]" data-field="left">{c.leftCents > 0 ? `${formatCents(c.leftCents)} left` : 'Fully recovered'}</span>
                          {c.leftCents > 0 && <Button size="sm" variant="ghost" onClick={() => setWriteOff(c)}>Write off…</Button>}
                        </span>
                      </p>
                      {c.reductions.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-xs text-[var(--color-ink-600)]">
                          {c.reductions.map((x) => (
                            <li key={x.id}>{x.kind === 'recovered' ? `${formatCents(x.amountCents)} recovered in ${from(x.payoutId)}` : `${formatCents(x.amountCents)} written off — ${x.reason ?? ''}`}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardBody>
      {writeOff && <WriteOffDialog c={writeOff} who={name(writeOff.entry.agentUserId)} run={run} onClose={() => setWriteOff(null)} />}
    </Card>
  );
}

function WriteOffDialog({ c, who, run, onClose }: { c: CarriedAmount; who: string; run: Run; onClose: () => void }) {
  const [amount, setAmount] = useState((c.leftCents / 100).toFixed(2));
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(''), [amount, why]);
  const go = async () => {
    const cents = parseMoneyCents(amount);
    if (cents === null || Number.isNaN(cents) || cents <= 0) return setError('Enter the amount to write off.');
    if (cents > c.leftCents) return setError(`Only ${formatCents(c.leftCents)} is left of this amount.`);
    if (!why.trim()) return setError('Say why it’s written off.');
    setBusy(true);
    const ok = await run(() => repo.writeOffAgentBalance(c.entry.id, cents, why.trim()), `${formatCents(cents)} written off for ${who}.`);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <DialogShell title={`Write off ${who}’s balance`} subtitle={`${formatCents(c.leftCents)} left of ${formatCents(-c.entry.amountCents)} carried`} confirm="Write off" busy={busy} onConfirm={() => void go()} onClose={onClose} testId="write-off-dialog">
      <DialogError text={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="wo-amount">Amount ($)</label>
          <input id="wo-amount" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="wo-reason">Reason (kept in the audit)</label>
          <input id="wo-reason" className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} placeholder="e.g. Agreed with the agent: carrier error" />
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-600)]">The agency absorbs what’s written off; the rest is still recovered from later payouts.</p>
    </DialogShell>
  );
}
