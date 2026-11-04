import { supabase } from './client';

// What the agency paid its referral partners, policy by policy (0091). Owners and admins only.
export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

export interface PartnerPayment {
  id: string;
  accountId: string;
  policyId: string;
  partnerName: string;
  /** The amount, as totalCents so the shared paid / not paid logic (agentPay.payStatus) reads it. */
  totalCents: number;
  paidOn: string;
  createdAt: string;
  undoneAt: string | null;
}

export interface PartnerPaymentItem {
  accountId: string;
  policyId: string;
  partnerName: string;
  amountCents: number;
}

export async function fetchPartnerPayments(): Promise<RepoResult<PartnerPayment[]>> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment.' };
  const { data, error } = await supabase.from('partner_payments').select('*').order('paid_on', { ascending: false });
  if (error) return { ok: false, message: /partner_payments/.test(error.message) ? 'Paying partners needs database migration 0091.' : error.message };
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      accountId: String(r.submission_id),
      policyId: String(r.policy_id),
      partnerName: String(r.partner_name),
      totalCents: Number(r.amount_cents),
      paidOn: String(r.paid_on),
      createdAt: String(r.created_at),
      undoneAt: (r.undone_at as string) ?? null,
    })),
  };
}

export async function recordPartnerPayments(paidOn: string, items: PartnerPaymentItem[]): Promise<RepoResult<number>> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment.' };
  const { data, error } = await supabase.rpc('record_partner_payments', {
    p_paid_on: paidOn,
    p_items: items.map((i) => ({ submission_id: i.accountId, policy_id: i.policyId, partner_name: i.partnerName, amount_cents: i.amountCents })),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: Number(data) };
}

export async function undoPartnerPayment(id: string): Promise<RepoResult> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment.' };
  const { error } = await supabase.rpc('undo_partner_payment', { p_id: id, p_reason: 'Undone' });
  return error ? { ok: false, message: error.message } : { ok: true, data: undefined };
}
