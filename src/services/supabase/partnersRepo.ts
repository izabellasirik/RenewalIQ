import { supabase } from './client';
import type { RepoResult } from './commissionRepo';

/**
 * Partnerships, referral sources and broker fee splits (0081). Everyone in the agency reads the source names
 * (to pick where a client came from); only admins read the agreed partner amounts, manage the list and set
 * each agent's broker fee share. broker_fee_splits returns an agent only their own policies and share.
 */
export const NO_REFERRAL = 'none';
export const MIGRATION_0081_MESSAGE = 'Partnerships and broker fees need database migration 0081_partners_broker_fees.sql.';
const NOT_CONFIGURED = { ok: false as const, message: 'Cloud sign-in is not configured in this environment.' };
const missing = (m: string) => /referral_source|broker_fee|schema cache|PGRST202|does not exist/i.test(m);
const fail = (m: string) => ({ ok: false as const, message: missing(m) ? MIGRATION_0081_MESSAGE : m, ...(missing(m) ? { missingMigration: true } : {}) });

export interface ReferralSourceName {
  id: string;
  name: string;
  active: boolean;
}
export interface ReferralSource extends ReferralSourceName {
  /** The partner's agreed amount, once per client (null: none). */
  partnerFeeCents: number | null;
}
export interface BrokerFeeShare {
  mode: 'amount' | 'percent';
  /** amount: cents; percent: 0–1. */
  value: number;
}
export interface BrokerFeeSplit {
  accountId: string;
  clientName: string;
  policyId: string;
  policyNumber: string | null;
  boundDate: string;
  brokerFeeCents: number;
  /** Admins only (null for agents). */
  partnerName: string | null;
  partnerCents: number | null;
  agentUserId: string | null;
  agentName: string | null;
  agentCents: number;
  /** Admins only (null for agents). */
  agencyCents: number | null;
}

export async function fetchReferralSourceNames(): Promise<RepoResult<ReferralSourceName[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('referral_source_names');
  if (error) return fail(error.message);
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), name: String(r.name), active: r.active !== false })) };
}

/** Admins: the partners with their agreed amounts. */
export async function fetchReferralSources(): Promise<RepoResult<ReferralSource[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('referral_sources').select('id, name, partner_fee_cents, active').order('active', { ascending: false }).order('name');
  if (error) return fail(error.message);
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), name: String(r.name), active: r.active !== false, partnerFeeCents: r.partner_fee_cents === null || r.partner_fee_cents === undefined ? null : Number(r.partner_fee_cents) })),
  };
}

export async function saveReferralSource(id: string | null, name: string, partnerFeeCents: number | null, active = true): Promise<RepoResult<string>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('save_referral_source', { p_id: id, p_name: name, p_partner_fee_cents: partnerFeeCents, p_active: active });
  return error ? fail(error.message) : { ok: true, data: String(data) };
}

/** Broker fee shares: every member's for an admin, an agent's own otherwise (keyed by user id). */
export async function fetchBrokerFeeShares(): Promise<RepoResult<Record<string, BrokerFeeShare>>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('agent_broker_fee_shares').select('user_id, mode, value');
  if (error) return fail(error.message);
  const out: Record<string, BrokerFeeShare> = {};
  for (const r of (data ?? []) as Record<string, unknown>[]) out[String(r.user_id)] = { mode: r.mode === 'percent' ? 'percent' : 'amount', value: Number(r.value) };
  return { ok: true, data: out };
}

export async function setAgentBrokerFeeShare(userId: string, share: BrokerFeeShare | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('set_agent_broker_fee_share', { p_user_id: userId, p_mode: share?.mode ?? null, p_value: share?.value ?? null });
  return error ? fail(error.message) : { ok: true, data: undefined };
}

export async function fetchBrokerFeeSplits(from: string | null, to: string | null): Promise<RepoResult<BrokerFeeSplit[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('broker_fee_splits', { p_from: from, p_to: to });
  if (error) return fail(error.message);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      accountId: String(r.submission_id),
      clientName: String(r.client_name ?? ''),
      policyId: String(r.policy_id),
      policyNumber: (r.policy_number as string) ?? null,
      boundDate: String(r.bound_date),
      brokerFeeCents: Number(r.broker_fee_cents),
      partnerName: (r.partner_name as string) ?? null,
      partnerCents: n(r.partner_cents),
      agentUserId: (r.agent_user_id as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
      agentCents: Number(r.agent_cents ?? 0),
      agencyCents: n(r.agency_cents),
    })),
  };
}
