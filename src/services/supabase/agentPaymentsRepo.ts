import { supabase } from './client';
import type { RepoResult } from './commissionRepo';

/**
 * What the agency paid its agents, row by row (0084): marked in Analytics → Policies & endorsements. Admins
 * record and undo payments; an agent reads only their own.
 */
export const MIGRATION_0084_MESSAGE = 'Marking payments needs database migration 0084_agent_payments.sql.';
const NOT_CONFIGURED = { ok: false as const, message: 'Cloud sign-in is not configured in this environment.' };
const missing = (m: string) => /agent_payments|record_agent_payments|schema cache|PGRST202|does not exist/i.test(m);
const fail = (m: string) => ({ ok: false as const, message: missing(m) ? MIGRATION_0084_MESSAGE : m, ...(missing(m) ? { missingMigration: true } : {}) });

export interface AgentPayment {
  id: string;
  accountId: string;
  /** The row: a policy's / endorsement's id, or "cx-<record id>" for a cancellation. */
  rowKey: string;
  agentUserId: string;
  commissionCents: number;
  brokerFeeCents: number;
  partnerShortfallCents: number;
  totalCents: number;
  paidOn: string;
  createdAt: string;
  undoneAt: string | null;
  undoReason: string | null;
}

export interface PaymentItem {
  accountId: string;
  rowKey: string;
  agentUserId: string;
  commissionCents: number;
  brokerFeeCents: number;
  partnerShortfallCents: number;
}

export async function fetchAgentPayments(): Promise<RepoResult<AgentPayment[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('agent_payments').select('*').order('paid_on', { ascending: false });
  if (error) return fail(error.message);
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      accountId: String(r.submission_id),
      rowKey: String(r.row_key),
      agentUserId: String(r.agent_user_id),
      commissionCents: Number(r.commission_cents ?? 0),
      brokerFeeCents: Number(r.broker_fee_cents ?? 0),
      partnerShortfallCents: Number(r.partner_shortfall_cents ?? 0),
      totalCents: Number(r.total_cents ?? 0),
      paidOn: String(r.paid_on),
      createdAt: String(r.created_at),
      undoneAt: (r.undone_at as string) ?? null,
      undoReason: (r.undo_reason as string) ?? null,
    })),
  };
}

export async function recordAgentPayments(paidOn: string, items: PaymentItem[]): Promise<RepoResult<number>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('record_agent_payments', {
    p_paid_on: paidOn,
    p_items: items.map((i) => ({ submission_id: i.accountId, row_key: i.rowKey, agent_user_id: i.agentUserId, commission_cents: i.commissionCents, broker_fee_cents: i.brokerFeeCents, partner_shortfall_cents: i.partnerShortfallCents })),
  });
  return error ? fail(error.message) : { ok: true, data: Number(data) };
}

export async function undoAgentPayment(id: string, reason: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('undo_agent_payment', { p_id: id, p_reason: reason });
  return error ? fail(error.message) : { ok: true, data: undefined };
}
