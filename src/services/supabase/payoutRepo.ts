import { supabase } from './client';
import type { RepoResult } from './commissionRepo';
import { toBalanceEntry, toPayout, toRun, toRunDetails, type BalanceEntry, type PayoutRun, type PayoutSummary, type RunDetails } from '../finance/payouts';
import type { LedgerKind, LedgerStream } from '../finance/ledger';

/**
 * Payouts (0065). Admins read the runs, payouts and balances (the database shows them to admins only);
 * agents read their own through my_payouts / my_payout_lines / my_commission_balance (agent commission
 * only). Every change is one of the database's functions — it works out the amounts, checks who may do
 * it, keeps the history and writes the audit.
 */

export const MIGRATION_0065_MESSAGE = 'Payouts need database migration 0065_commission_payouts.sql.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' ||
  /(relation|table)\b[^\n]*\b(finance_payout|finance_agent_balance)|Could not find the function public\.(my_payouts|my_payout_lines|my_commission_balance|payout_run_details|create_payout_run|close_payout_run|approve_payout|mark_payout_paid|cancel_payout_approval|add_payout_adjustment|void_payout_adjustment|hold_payout_record|release_payout_hold|write_off_agent_balance)/i.test(e.message ?? '');
function fail(e: unknown, fallback: string): RepoResult<never> {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (isMissing(err)) return { ok: false, message: MIGRATION_0065_MESSAGE, missingMigration: true };
  return { ok: false, message: err.message || fallback };
}

export interface PayoutOverview {
  runs: PayoutRun[];
  payouts: PayoutSummary[];
  balances: BalanceEntry[];
}

/** The agency's runs, approved / paid payouts and commission balances (admins). */
export async function fetchPayoutOverview(): Promise<RepoResult<PayoutOverview>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const [r, p, b] = await Promise.all([
      supabase.from('finance_payout_runs').select('*').order('period_start', { ascending: false }).limit(500),
      supabase.from('finance_payouts').select('*').order('approved_at', { ascending: false }).limit(5000),
      supabase.from('finance_agent_balance_entries').select('*').order('created_at', { ascending: true }).limit(5000),
    ]);
    for (const res of [r, p, b]) if (res.error) return fail(res.error, 'Could not load the payouts.');
    return {
      ok: true,
      data: {
        runs: ((r.data ?? []) as Record<string, unknown>[]).map(toRun),
        payouts: ((p.data ?? []) as Record<string, unknown>[]).map(toPayout),
        balances: ((b.data ?? []) as Record<string, unknown>[]).map(toBalanceEntry),
      },
    };
  } catch (err) {
    return fail(err, 'Could not load the payouts.');
  }
}

async function call<T = void>(fn: string, args: Record<string, unknown>, fallback: string): Promise<RepoResult<T>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc(fn, args);
    if (res.error) return fail(res.error, fallback);
    return { ok: true, data: res.data as T };
  } catch (err) {
    return fail(err, fallback);
  }
}

export async function fetchRunDetails(runId: string): Promise<RepoResult<RunDetails>> {
  const res = await call<Record<string, unknown>>('payout_run_details', { p_run: runId }, 'Could not load the payout run.');
  return res.ok ? { ok: true, data: toRunDetails(res.data ?? {}) } : res;
}

export const createPayoutRun = (stream: LedgerStream, periodStart?: string) => call<string>('create_payout_run', { p_stream: stream, p_period_start: periodStart || null }, 'Could not start the run.');
export const closePayoutRun = (runId: string, note?: string) => call('close_payout_run', { p_run: runId, p_note: note?.trim() || null }, 'Could not close the run.');
export const approvePayout = (runId: string, agent: string, payCents: number, items: number, note?: string) =>
  call<string>('approve_payout', { p_run: runId, p_agent: agent, p_expected_pay_cents: payCents, p_expected_items: items, p_note: note?.trim() || null }, 'Could not approve the payout.');
export const approvePayoutRun = (runId: string, lines: { agent: string; payCents: number; items: number }[], note?: string) =>
  call<number>('approve_payout_run', { p_run: runId, p_lines: lines, p_note: note?.trim() || null }, 'Could not approve the payouts.');
export const markPayoutPaid = (payoutId: string, paidOn: string, reference?: string) => call('mark_payout_paid', { p_payout: payoutId, p_paid_on: paidOn, p_reference: reference?.trim() || null }, 'Could not mark it paid.');
export const cancelPayoutApproval = (payoutId: string, reason: string) => call('cancel_payout_approval', { p_payout: payoutId, p_reason: reason }, 'Could not undo the approval.');
export const addPayoutAdjustment = (runId: string, agent: string, amountCents: number, reason: string) =>
  call<string>('add_payout_adjustment', { p_run: runId, p_agent: agent, p_amount_cents: amountCents, p_reason: reason }, 'Could not add the adjustment.');
export const voidPayoutAdjustment = (id: string, reason: string) => call('void_payout_adjustment', { p_id: id, p_reason: reason }, 'Could not void the adjustment.');
export const holdPayoutRecord = (runId: string, transactionId: string, reason: string) => call<string>('hold_payout_record', { p_run: runId, p_transaction_id: transactionId, p_reason: reason }, 'Could not hold it.');
export const releasePayoutHold = (holdId: string, reason: string) => call('release_payout_hold', { p_hold: holdId, p_reason: reason }, 'Could not release it.');
export const writeOffAgentBalance = (carriedId: string, amountCents: number, reason: string) =>
  call<string>('write_off_agent_balance', { p_carried: carriedId, p_amount_cents: amountCents, p_reason: reason }, 'Could not write it off.');

// ───────────────────────────── the signed-in agent's own ─────────────────────────────

export interface MyPayout {
  id: string;
  stream: LedgerStream;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: 'approved' | 'paid';
  itemCount: number;
  recordsCents: number;
  adjustmentsCents: number;
  balanceBeforeCents: number;
  recoveredCents: number;
  carriedCents: number;
  payCents: number;
  approvedAt: string;
  paidOn: string | null;
}

export interface MyPayoutLine {
  lineType: 'record' | 'adjustment';
  kind: LedgerKind | null;
  clientName: string | null;
  policyNumber: string | null;
  eventDate: string | null;
  netCents: number | null;
  agentRate: number | null;
  agentCents: number;
  late: boolean;
  reason: string | null;
}

export interface MyBalanceEntry {
  id: string;
  kind: 'carried' | 'recovered' | 'written_off';
  amountCents: number;
  createdAt: string;
  appliesTo: string | null;
  reason: string | null;
  payoutId: string | null;
  stream: LedgerStream | null;
  periodStart: string | null;
  periodEnd: string | null;
  payDate: string | null;
  leftCents: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function fetchMyPayouts(): Promise<RepoResult<MyPayout[]>> {
  const res = await call<Record<string, unknown>[]>('my_payouts', {}, 'Could not load your payouts.');
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data ?? []).map((r) => ({
      id: String(r.id),
      stream: r.stream === 'monthly' ? 'monthly' : 'weekly',
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      payDate: String(r.pay_date),
      status: r.status === 'paid' ? 'paid' : 'approved',
      itemCount: num(r.item_count),
      recordsCents: num(r.records_cents),
      adjustmentsCents: num(r.adjustments_cents),
      balanceBeforeCents: num(r.balance_before_cents),
      recoveredCents: num(r.recovered_cents),
      carriedCents: num(r.carried_cents),
      payCents: num(r.pay_cents),
      approvedAt: String(r.approved_at ?? ''),
      paidOn: strOrNull(r.paid_on),
    })),
  };
}

export async function fetchMyPayoutLines(payoutId: string): Promise<RepoResult<MyPayoutLine[]>> {
  const res = await call<Record<string, unknown>[]>('my_payout_lines', { p_payout: payoutId }, 'Could not load the payout.');
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data ?? []).map((r) => ({
      lineType: r.line_type === 'adjustment' ? 'adjustment' : 'record',
      kind: (r.kind as LedgerKind) ?? null,
      clientName: strOrNull(r.client_name),
      policyNumber: strOrNull(r.policy_number),
      eventDate: strOrNull(r.event_date),
      netCents: numOrNull(r.net_cents),
      agentRate: numOrNull(r.agent_rate),
      agentCents: num(r.agent_cents),
      late: r.late === true,
      reason: strOrNull(r.reason),
    })),
  };
}

export async function fetchMyBalance(): Promise<RepoResult<MyBalanceEntry[]>> {
  const res = await call<Record<string, unknown>[]>('my_commission_balance', {}, 'Could not load your balance.');
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data ?? []).map((r) => ({
      id: String(r.id),
      kind: r.kind === 'recovered' ? 'recovered' : r.kind === 'written_off' ? 'written_off' : 'carried',
      amountCents: num(r.amount_cents),
      createdAt: String(r.created_at ?? ''),
      appliesTo: strOrNull(r.applies_to),
      reason: strOrNull(r.reason),
      payoutId: strOrNull(r.payout_id),
      stream: r.stream === 'monthly' ? 'monthly' : r.stream === 'weekly' ? 'weekly' : null,
      periodStart: strOrNull(r.period_start),
      periodEnd: strOrNull(r.period_end),
      payDate: strOrNull(r.pay_date),
      leftCents: numOrNull(r.left_cents),
    })),
  };
}
