import { supabase } from './client';
import type { RepoResult } from './commissionRepo';
import { toCancellation, toReceipt, toSchedule, toTransaction, type CarrierReceipt, type LedgerCancellation, type LedgerTransaction, type PayoutSchedule } from '../finance/ledger';

/**
 * Commission records (0064). Admins read the tables (the database shows them to admins only); agents
 * read their own commissions through my_commissions / account_commission_statuses, which never return
 * carrier rates or carrier commission. Every change is one of the database's functions — they check who
 * may do it, keep the history and write the audit.
 */

export const MIGRATION_0064_MESSAGE = 'Commission records need database migration 0064_commission_ledger.sql.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /commission_transactions|commission_cancellations|my_commissions|account_commission_statuses|finance_settings|Could not find the function public\.(verify|confirm|link|acknowledge|void|rerecord|correct|settle|record_carrier|set_finance|request_commission|withdraw|mark_cancellation|reject|approve|finance_)/i.test(e.message ?? '');
function fail(e: unknown, fallback: string): RepoResult<never> {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (isMissing(err)) return { ok: false, message: MIGRATION_0064_MESSAGE, missingMigration: true };
  return { ok: false, message: err.message || fallback };
}

export interface LedgerSnapshot {
  transactions: LedgerTransaction[];
  cancellations: LedgerCancellation[];
  receipts: CarrierReceipt[];
  schedule: PayoutSchedule;
  /** Historical policies / endorsements noted but not yet recorded (the backfill would record them). */
  historicalWaiting: number;
}

/** Everything an admin's commission screens show. */
export async function fetchLedger(): Promise<RepoResult<LedgerSnapshot>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const [t, c, r, s, h] = await Promise.all([
      supabase.from('commission_transactions').select('*').order('event_date', { ascending: false }).order('created_at', { ascending: false }).limit(5000),
      supabase.from('commission_cancellations').select('*').order('requested_at', { ascending: false }).limit(2000),
      supabase.from('commission_carrier_receipts').select('*').order('received_date', { ascending: false }).limit(5000),
      supabase.from('finance_settings').select('*').maybeSingle(),
      supabase.from('finance_historical_entries').select('policy_id', { count: 'exact', head: true }).is('backfilled_at', null),
    ]);
    for (const res of [t, c, r, s, h]) if (res.error) return fail(res.error, 'Could not load the commission records.');
    return {
      ok: true,
      data: {
        transactions: ((t.data ?? []) as Record<string, unknown>[]).map(toTransaction),
        cancellations: ((c.data ?? []) as Record<string, unknown>[]).map(toCancellation),
        receipts: ((r.data ?? []) as Record<string, unknown>[]).map(toReceipt),
        schedule: toSchedule(s.data as Record<string, unknown> | null),
        historicalWaiting: h.count ?? 0,
      },
    };
  } catch (err) {
    return fail(err, 'Could not load the commission records.');
  }
}

export interface MyCommission {
  id: string;
  kind: LedgerTransaction['kind'];
  submissionId: string;
  clientName: string;
  policyId: string | null;
  policyNumber: string | null;
  carrierName: string;
  eventDate: string;
  payableFrom: string;
  expectedPayDate: string | null;
  netCents: number;
  agentRate: number | null;
  agentCents: number | null;
  status: import('../finance/ledger').LedgerStatus;
  originalTransactionId: string | null;
}

/** The signed-in agent's own commissions (no carrier figures). */
export async function fetchMyCommissions(): Promise<RepoResult<MyCommission[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('my_commissions');
    if (res.error) return fail(res.error, 'Could not load your commissions.');
    return {
      ok: true,
      data: ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        kind: r.kind as MyCommission['kind'],
        submissionId: String(r.submission_id),
        clientName: String(r.client_name ?? ''),
        policyId: (r.policy_id as string) ?? null,
        policyNumber: (r.policy_number as string) ?? null,
        carrierName: String(r.carrier_name ?? ''),
        eventDate: String(r.event_date),
        payableFrom: String(r.payable_from),
        expectedPayDate: (r.expected_pay_date as string) ?? null,
        netCents: Number(r.net_cents ?? 0),
        agentRate: r.agent_rate === null || r.agent_rate === undefined ? null : Number(r.agent_rate),
        agentCents: r.agent_cents === null || r.agent_cents === undefined ? null : Number(r.agent_cents),
        status: r.status as MyCommission['status'],
        originalTransactionId: (r.original_transaction_id as string) ?? null,
      })),
    };
  } catch (err) {
    return fail(err, 'Could not load your commissions.');
  }
}

export interface AccountCommissionStatus {
  transactionId: string;
  policyId: string;
  kind: 'policy' | 'endorsement';
  status: import('../finance/ledger').LedgerStatus;
  flags: string[];
  expectedPayDate: string | null;
  agentCents: number | null;
}

/** Commission status of an account's policies — for its agent and the agency's admins (others get nothing). */
export async function fetchAccountCommissionStatuses(submissionId: string): Promise<RepoResult<AccountCommissionStatus[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('account_commission_statuses', { p_submission_id: submissionId });
    if (res.error) return fail(res.error, 'Could not load the commission status.');
    return {
      ok: true,
      data: ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
        transactionId: String(r.transaction_id),
        policyId: String(r.policy_id),
        kind: r.kind === 'endorsement' ? 'endorsement' : 'policy',
        status: r.status as AccountCommissionStatus['status'],
        flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
        expectedPayDate: (r.expected_pay_date as string) ?? null,
        agentCents: r.agent_cents === null || r.agent_cents === undefined ? null : Number(r.agent_cents),
      })),
    };
  } catch (err) {
    return fail(err, 'Could not load the commission status.');
  }
}

export interface MyCancellation {
  id: string;
  transactionId: string;
  submissionId: string;
  cancelType: 'full' | 'partial';
  effectiveDate: string;
  reason: string;
  status: LedgerCancellation['status'];
  requestedAt: string;
  decisionNote: string | null;
  returnedNetCents: number | null;
  agentAdjustmentCents: number | null;
}

export async function fetchMyCancellations(): Promise<RepoResult<MyCancellation[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('my_commission_cancellations');
    if (res.error) return fail(res.error, 'Could not load cancellation requests.');
    return {
      ok: true,
      data: ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        transactionId: String(r.transaction_id),
        submissionId: String(r.submission_id),
        cancelType: r.cancel_type === 'full' ? 'full' : 'partial',
        effectiveDate: String(r.effective_date),
        reason: String(r.reason ?? ''),
        status: r.status as MyCancellation['status'],
        requestedAt: String(r.requested_at ?? ''),
        decisionNote: (r.decision_note as string) ?? null,
        returnedNetCents: r.returned_net_cents === null || r.returned_net_cents === undefined ? null : Number(r.returned_net_cents),
        agentAdjustmentCents: r.agent_adjustment_cents === null || r.agent_adjustment_cents === undefined ? null : Number(r.agent_adjustment_cents),
      })),
    };
  } catch (err) {
    return fail(err, 'Could not load cancellation requests.');
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

export const verifyCommission = (id: string, reason?: string) => call('verify_commission', { p_id: id, p_reason: reason?.trim() || null }, 'Could not verify the commission.');
export const confirmHistoricalCommission = (id: string, agentUserId: string, agentRate: number, carrierRate: number, evidence: string) =>
  call('confirm_historical_commission', { p_id: id, p_agent_user_id: agentUserId, p_agent_rate: agentRate, p_carrier_rate: carrierRate, p_evidence: evidence }, 'Could not confirm the rates.');
export const linkCommissionEndorsement = (id: string, policyTransactionId: string) => call('link_commission_endorsement', { p_id: id, p_policy_transaction_id: policyTransactionId }, 'Could not link the endorsement.');
export const acknowledgeCommissionChanges = (id: string, note: string) => call('acknowledge_commission_changes', { p_id: id, p_note: note }, 'Could not save.');
export const voidCommission = (id: string, reason: string) => call('void_commission', { p_id: id, p_reason: reason }, 'Could not void the commission.');
export const rerecordCommission = (id: string, reason: string, currentAgent = false) => call<string>('rerecord_commission', { p_id: id, p_reason: reason, p_current_agent: currentAgent }, 'Could not record it again.');
export const correctCommission = (id: string, newNetCents: number, reason: string) => call<string>('correct_commission', { p_id: id, p_new_net_cents: newNetCents, p_reason: reason }, 'Could not add the correction.');
export const settleCommissionsOutside = (ids: string[], reason: string, confirmCount: number) => call<number>('settle_commissions_outside', { p_ids: ids, p_reason: reason, p_confirm_count: confirmCount }, 'Could not mark them settled.');
export const recordCarrierReceipt = (transactionId: string, amountCents: number, receivedDate: string, reference?: string, note?: string) =>
  call<string>('record_carrier_receipt', { p_transaction_id: transactionId, p_amount_cents: amountCents, p_received_date: receivedDate, p_reference: reference || null, p_note: note || null }, 'Could not record the receipt.');
export const voidCarrierReceipt = (id: string, reason: string) => call('void_carrier_receipt', { p_id: id, p_reason: reason }, 'Could not void the receipt.');
export const setPayoutSchedule = (s: PayoutSchedule, reason: string) =>
  call('set_finance_payout_schedule', { p_weekly_period_start_dow: s.weeklyPeriodStartDow, p_weekly_pay_dow: s.weeklyPayDow, p_monthly_pay_rule: s.monthlyPayRule, p_monthly_pay_dow: s.monthlyPayDow, p_monthly_pay_day: s.monthlyPayDay, p_reason: reason }, 'Could not save the schedule.');
export const requestCancellation = (transactionId: string, cancelType: 'full' | 'partial', effectiveDate: string, reason: string, expectedRefundCents: number | null, documentIds: string[]) =>
  call<string>('request_commission_cancellation', { p_transaction_id: transactionId, p_cancel_type: cancelType, p_effective_date: effectiveDate, p_reason: reason, p_expected_refund_cents: expectedRefundCents, p_document_ids: documentIds }, 'Could not send the request.');
export const withdrawCancellation = (id: string) => call('withdraw_commission_cancellation', { p_id: id }, 'Could not withdraw the request.');
export const markCancellationAwaiting = (id: string, note?: string) => call('mark_cancellation_awaiting_amount', { p_id: id, p_note: note || null }, 'Could not save.');
export const rejectCancellation = (id: string, note: string) => call('reject_commission_cancellation', { p_id: id, p_note: note }, 'Could not reject the request.');
export const approveCancellation = (id: string, returnedNetCents: number, carrierAdjustmentCents: number, note?: string, withoutProofReason?: string) =>
  call<string>('approve_commission_cancellation', { p_id: id, p_returned_net_cents: returnedNetCents, p_carrier_adjustment_cents: carrierAdjustmentCents, p_note: note || null, p_without_proof_reason: withoutProofReason || null }, 'Could not approve the cancellation.');
export const backfillPreview = () => call<Record<string, number>>('finance_backfill_preview', {}, 'Could not count the historical records.');
export const backfillHistorical = () => call<{ recorded: number; skipped: number }>('finance_backfill_historical', {}, 'Could not record the historical policies.');
