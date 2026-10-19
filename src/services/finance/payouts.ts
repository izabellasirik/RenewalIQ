import { toLocalDateKey } from '../workflow/dates';
import { FLAG_LABELS, STATUS_LABELS, type LedgerKind, type LedgerStatus, type LedgerStream } from './ledger';

/**
 * Payouts (0065), as the app reads them. The database decides what a run pays and works out every amount
 * (finance_run_line); what's here only maps the rows, adds up a run for its summary, picks the lines that
 * are ready to approve and follows each agent's balance. Agent commission only — never carrier figures.
 */

export interface PayoutRun {
  id: string;
  stream: LedgerStream;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  createdAt: string;
  closedAt: string | null;
  closeNote: string | null;
}

export type PayoutStatus = 'approved' | 'paid' | 'cancelled';

export interface PayoutSummary {
  id: string;
  runId: string;
  agentUserId: string;
  agentName: string;
  status: PayoutStatus;
  itemCount: number;
  recordsCents: number;
  adjustmentsCents: number;
  lineCents: number;
  balanceBeforeCents: number;
  recoveredCents: number;
  carriedCents: number;
  payCents: number;
  approvedAt: string;
  paidOn: string | null;
  paidReference: string | null;
}

export interface PayoutItem {
  transactionId: string;
  kind: LedgerKind;
  origin: 'recorded' | 'historical' | 'admin';
  clientName: string;
  submissionId: string;
  policyNumber: string | null;
  carrierName: string;
  eventDate: string;
  payableFrom: string;
  ownPayDate: string;
  /** Due by an earlier payday: verified late, or a cancellation / correction approved after its period. */
  late: boolean;
  netCents: number;
  agentRate: number | null;
  agentCents: number;
  originalPolicyNumber: string | null;
}

export interface PayoutAdjustment {
  id: string;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export type LineStatus = 'draft' | 'approved' | 'paid';

export interface PayoutLine {
  agent: string;
  agentName: string;
  status: LineStatus;
  payoutId: string | null;
  itemCount: number;
  recordsCents: number;
  adjustmentsCents: number;
  lineCents: number;
  balanceBeforeCents: number;
  recoveredCents: number;
  carriedCents: number;
  payCents: number;
  approvedAt: string | null;
  paidOn: string | null;
  paidReference: string | null;
  items: PayoutItem[];
  adjustments: PayoutAdjustment[];
}

export interface WaitingRecord extends PayoutItem {
  agent: string | null;
  agentName: string;
  status: LedgerStatus;
  flags: string[];
  holdId: string | null;
  holdReason: string | null;
}

export interface RunDetails {
  run: PayoutRun & { periodOver: boolean };
  lines: PayoutLine[];
  waiting: WaitingRecord[];
}

export type BalanceKind = 'carried' | 'recovered' | 'written_off';

export interface BalanceEntry {
  id: string;
  agentUserId: string;
  kind: BalanceKind;
  amountCents: number;
  payoutId: string | null;
  appliesTo: string | null;
  reason: string | null;
  createdAt: string;
  voidedAt: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export function toRun(r: Record<string, unknown>): PayoutRun {
  return {
    id: str(r.id),
    stream: r.stream === 'monthly' ? 'monthly' : 'weekly',
    periodStart: str(r.period_start ?? r.periodStart),
    periodEnd: str(r.period_end ?? r.periodEnd),
    payDate: str(r.pay_date ?? r.payDate),
    createdAt: str(r.created_at ?? r.createdAt),
    closedAt: strOrNull(r.closed_at ?? r.closedAt),
    closeNote: strOrNull(r.close_note ?? r.closeNote),
  };
}

export function toPayout(r: Record<string, unknown>): PayoutSummary {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    agentUserId: str(r.agent_user_id),
    agentName: str(r.agent_name),
    status: r.status === 'paid' ? 'paid' : r.status === 'cancelled' ? 'cancelled' : 'approved',
    itemCount: n(r.item_count),
    recordsCents: n(r.records_cents),
    adjustmentsCents: n(r.adjustments_cents),
    lineCents: n(r.line_cents),
    balanceBeforeCents: n(r.balance_before_cents),
    recoveredCents: n(r.recovered_cents),
    carriedCents: n(r.carried_cents),
    payCents: n(r.pay_cents),
    approvedAt: str(r.approved_at),
    paidOn: strOrNull(r.paid_on),
    paidReference: strOrNull(r.paid_reference),
  };
}

export function toBalanceEntry(r: Record<string, unknown>): BalanceEntry {
  return {
    id: str(r.id),
    agentUserId: str(r.agent_user_id),
    kind: r.kind === 'recovered' ? 'recovered' : r.kind === 'written_off' ? 'written_off' : 'carried',
    amountCents: n(r.amount_cents),
    payoutId: strOrNull(r.payout_id),
    appliesTo: strOrNull(r.applies_to),
    reason: strOrNull(r.reason),
    createdAt: str(r.created_at),
    voidedAt: strOrNull(r.voided_at),
  };
}

function toItem(r: Record<string, unknown>): PayoutItem {
  return {
    transactionId: str(r.transactionId),
    kind: (r.kind as LedgerKind) ?? 'policy',
    origin: r.origin === 'historical' ? 'historical' : r.origin === 'admin' ? 'admin' : 'recorded',
    clientName: str(r.clientName),
    submissionId: str(r.submissionId),
    policyNumber: strOrNull(r.policyNumber),
    carrierName: str(r.carrierName),
    eventDate: str(r.eventDate),
    payableFrom: str(r.payableFrom),
    ownPayDate: str(r.ownPayDate),
    late: r.late === true,
    netCents: n(r.netCents),
    agentRate: nOrNull(r.agentRate),
    agentCents: n(r.agentCents),
    originalPolicyNumber: strOrNull(r.originalPolicyNumber),
  };
}

export function toRunDetails(d: Record<string, unknown>): RunDetails {
  const run = (d.run ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(d.lines) ? (d.lines as Record<string, unknown>[]) : [];
  const waiting = Array.isArray(d.waiting) ? (d.waiting as Record<string, unknown>[]) : [];
  return {
    run: { ...toRun(run), periodOver: run.periodOver === true },
    lines: lines.map((l) => ({
      agent: str(l.agent),
      agentName: str(l.agentName) || 'Agent',
      status: l.status === 'paid' ? 'paid' : l.status === 'approved' ? 'approved' : 'draft',
      payoutId: strOrNull(l.payoutId),
      itemCount: n(l.itemCount),
      recordsCents: n(l.recordsCents),
      adjustmentsCents: n(l.adjustmentsCents),
      lineCents: n(l.lineCents),
      balanceBeforeCents: n(l.balanceBeforeCents),
      recoveredCents: n(l.recoveredCents),
      carriedCents: n(l.carriedCents),
      payCents: n(l.payCents),
      approvedAt: strOrNull(l.approvedAt),
      paidOn: strOrNull(l.paidOn),
      paidReference: strOrNull(l.paidReference),
      items: (Array.isArray(l.items) ? (l.items as Record<string, unknown>[]) : []).map(toItem),
      adjustments: (Array.isArray(l.adjustments) ? (l.adjustments as Record<string, unknown>[]) : []).map((a) => ({
        id: str(a.id),
        amountCents: n(a.amountCents),
        reason: str(a.reason),
        createdAt: str(a.createdAt),
      })),
    })),
    waiting: waiting.map((w) => ({
      ...toItem(w),
      agent: strOrNull(w.agent),
      agentName: str(w.agentName) || 'No agent',
      status: (w.status as LedgerStatus) ?? 'pending_verification',
      flags: Array.isArray(w.flags) ? (w.flags as string[]) : [],
      holdId: strOrNull(w.holdId),
      holdReason: strOrNull(w.holdReason),
    })),
  };
}

/** A run's summary: commission in it, what cancellations / corrections took off, adjustments, what earlier balances took, to pay, carried. */
export function runTotals(lines: PayoutLine[]): { commissionCents: number; deductionsCents: number; adjustmentsCents: number; recoveredCents: number; payCents: number; carriedCents: number } {
  let commission = 0;
  let deductions = 0;
  for (const l of lines)
    for (const i of l.items) {
      if (i.agentCents >= 0) commission += i.agentCents;
      else deductions += i.agentCents;
    }
  const sum = (f: (l: PayoutLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  return {
    commissionCents: commission,
    deductionsCents: deductions,
    adjustmentsCents: sum((l) => l.adjustmentsCents),
    recoveredCents: sum((l) => l.recoveredCents),
    payCents: sum((l) => l.payCents),
    carriedCents: sum((l) => l.carriedCents),
  };
}

/** The lines "Approve all ready" approves: not approved yet, with something in them, once the period is over. */
export function readyLines(d: RunDetails): PayoutLine[] {
  if (d.run.closedAt || !d.run.periodOver) return [];
  return d.lines.filter((l) => l.status === 'draft' && (l.itemCount > 0 || l.adjustmentsCents !== 0));
}

/** Why a record due in a run isn't in it. */
export function waitingReason(w: Pick<WaitingRecord, 'status' | 'flags' | 'holdReason'>): string {
  if (w.holdReason) return `Held: ${w.holdReason}`;
  if (w.flags.length > 0) return w.flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ');
  return STATUS_LABELS[w.status] ?? w.status;
}

export type RunState = 'open' | 'review' | 'approved' | 'paid' | 'closed';

export const RUN_STATE_LABELS: Record<RunState, string> = {
  open: 'Open · period in progress',
  review: 'Open · period over',
  approved: 'Approved · payments to mark',
  paid: 'Paid',
  closed: 'Closed',
};

/** Where a run stands, from its payouts (approved / paid) — the draft lines aren't stored. */
export function runState(run: PayoutRun, payouts: PayoutSummary[], today = toLocalDateKey(new Date())): RunState {
  const mine = payouts.filter((p) => p.runId === run.id && p.status !== 'cancelled');
  const toMark = mine.some((p) => p.status === 'approved' && p.payCents > 0);
  if (!run.closedAt) return today <= run.periodEnd ? 'open' : 'review';
  if (toMark) return 'approved';
  return mine.some((p) => p.status === 'paid') ? 'paid' : 'closed';
}

export interface CarriedAmount {
  entry: BalanceEntry;
  leftCents: number;
  reductions: BalanceEntry[];
}

export interface AgentBalance {
  agentUserId: string;
  /** What the agent owes from earlier payouts: 0 or negative. */
  balanceCents: number;
  carried: CarriedAmount[];
}

/** Each agent's commission balance (one across weekly and monthly payouts), from the balance entries. */
export function agentBalances(entries: BalanceEntry[]): AgentBalance[] {
  const live = entries.filter((e) => !e.voidedAt);
  const byAgent = new Map<string, AgentBalance>();
  for (const e of live) {
    const b = byAgent.get(e.agentUserId) ?? { agentUserId: e.agentUserId, balanceCents: 0, carried: [] };
    b.balanceCents += e.amountCents;
    byAgent.set(e.agentUserId, b);
  }
  for (const c of live.filter((e) => e.kind === 'carried').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const reductions = live.filter((e) => e.appliesTo === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    byAgent.get(c.agentUserId)!.carried.push({ entry: c, reductions, leftCents: -c.amountCents - reductions.reduce((s, r) => s + r.amountCents, 0) });
  }
  return [...byAgent.values()];
}

/** "Policies bound Sep 7 – 13" / "Endorsements in September 2026". */
export function runPeriodLabel(run: Pick<PayoutRun, 'stream' | 'periodStart' | 'periodEnd'>): string {
  const d = (k: string) => new Date(`${k}T12:00:00`);
  if (run.stream === 'monthly') return `Endorsements in ${d(run.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  const s = d(run.periodStart);
  const e = d(run.periodEnd);
  const sameMonth = s.getMonth() === e.getMonth();
  return `Policies bound ${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sameMonth ? e.getDate() : e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`;
}

