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
