import { supabase } from './client';

/**
 * Agent commission rates (0058). The database decides who sees what: an agency admin reads every
 * rate in the agency, anyone else only their own; only admins can change a rate (through
 * set_agent_commission_rate, which also records the change in the history).
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string; missingMigration?: boolean };

export const MIGRATION_0058_MESSAGE = 'Commission rates need database migration 0058_agent_commission.sql.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /agent_commission|policy_number_taken|Could not find the function/i.test(e.message ?? '');
const fail = (e: { code?: string; message?: string } | unknown, fallback: string): RepoResult<never> => {
  const err = e as { code?: string; message?: string };
  if (err && isMissing(err)) return { ok: false, message: MIGRATION_0058_MESSAGE, missingMigration: true };
  return { ok: false, message: err?.message ?? fallback };
};

/** user id → rate (a fraction: 0.1 = 10%). */
export async function fetchAgentCommissionRates(): Promise<RepoResult<Record<string, number>>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agent_commission_rates').select('user_id, rate');
    if (res.error) return fail(res.error, 'Could not load commission rates.');
    return { ok: true, data: Object.fromEntries(((res.data ?? []) as { user_id: string; rate: number | string }[]).map((r) => [r.user_id, Number(r.rate)])) };
  } catch (err) {
    return fail(err, 'Could not load commission rates.');
  }
}

/** Sets a member's rate (0–1), or clears it with null. Admins only — the database refuses anyone else. */
export async function setAgentCommissionRate(userId: string, rate: number | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('set_agent_commission_rate', { p_user_id: userId, p_rate: rate });
    if (res.error) return fail(res.error, 'Could not save the commission rate.');
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not save the commission rate.');
  }
}

export const MIGRATION_0063_MESSAGE = 'Carrier commission % needs database migration 0063_carrier_commission_rates.sql.';
const isMissing0063 = (e: { code?: string; message?: string }) => e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /carrier_commission_rate/i.test(e.message ?? '');

export interface CarrierRateRow {
  id: number;
  carrierKey: string;
  carrierName: string;
  /** A fraction: 0.12 = 12%. */
  rate: number;
  /** The date it applies from (YYYY-MM-DD). */
  effectiveFrom: string;
  evidence: string | null;
  setAt: string;
  retiredAt: string | null;
  retiredReason: string | null;
}

/** Every carrier rate the agency has set, by date, retired ones included (history). Admins only — agents read nothing. */
export async function fetchCarrierRateRows(): Promise<RepoResult<CarrierRateRow[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('carrier_commission_rates').select('id, carrier_key, carrier_name, rate, effective_from, evidence, set_at, retired_at, retired_reason').order('carrier_key').order('effective_from', { ascending: false });
    if (res.error) return isMissing0063(res.error) ? { ok: false, message: MIGRATION_0063_MESSAGE, missingMigration: true } : { ok: false, message: res.error.message };
    return {
      ok: true,
      data: ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id),
        carrierKey: String(r.carrier_key),
        carrierName: String(r.carrier_name),
        rate: Number(r.rate),
        effectiveFrom: String(r.effective_from),
        evidence: (r.evidence as string) ?? null,
        setAt: String(r.set_at ?? ''),
        retiredAt: (r.retired_at as string) ?? null,
        retiredReason: (r.retired_reason as string) ?? null,
      })),
    };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? 'Could not load carrier commissions.' };
  }
}

/** Sets a carrier's commission % (0–1) from a date, with optional evidence. Records already made keep their rate. Admins only. */
export async function setCarrierCommissionRate(carrier: string, rate: number, effectiveFrom: string, evidence?: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('set_carrier_commission_rate', { p_carrier: carrier, p_rate: rate, p_effective_from: effectiveFrom, p_evidence: evidence?.trim() || null });
    if (res.error) return isMissing0063(res.error) ? { ok: false, message: MIGRATION_0063_MESSAGE, missingMigration: true } : { ok: false, message: res.error.message };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? 'Could not save the carrier commission.' };
  }
}

/** Retires a rate set by mistake (kept in the history, with the reason). Admins only. */
export async function retireCarrierCommissionRate(id: number, reason: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('retire_carrier_commission_rate', { p_id: id, p_reason: reason });
    if (res.error) return isMissing0063(res.error) ? { ok: false, message: MIGRATION_0063_MESSAGE, missingMigration: true } : { ok: false, message: res.error.message };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? 'Could not retire the rate.' };
  }
}

/**
 * Whether this policy number with this carrier is already recorded on another client of the agency —
 * including clients the signed-in broker can't open. Only yes / no. Null when it can't be checked
 * (offline, or 0058 not applied): the check on the clients this browser has still applies.
 */
export async function policyNumberTaken(carrier: string, policyNumber: string, accountId: string): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const res = await supabase.rpc('policy_number_taken', { p_carrier: carrier, p_policy_number: policyNumber, p_account_id: accountId });
    if (res.error) return null;
    return res.data === true;
  } catch {
    return null;
  }
}

/**
 * The carrier % (0–1) the assigned agent or an admin entered on one policy / endorsement (0073).
 * 'saved': kept for when it's recorded; 'applied': its unverified commission now uses it; 'locked': its
 * commission is already verified, so nothing changed.
 */
export async function enterPolicyCarrierRate(accountId: string, policyId: string, rate: number): Promise<RepoResult<'saved' | 'applied' | 'locked'>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('enter_policy_carrier_rate', { p_submission_id: accountId, p_policy_id: policyId, p_rate: rate });
    if (error) {
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) return { ok: false, message: 'Saving the carrier % needs database migration 0073.' };
      return { ok: false, message: error.message || 'The carrier % couldn’t be saved.' };
    }
    return { ok: true, data: data as 'saved' | 'applied' | 'locked' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'The carrier % couldn’t be saved.' };
  }
}
