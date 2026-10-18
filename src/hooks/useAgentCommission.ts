import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchAgentCommissionRates } from '../services/supabase/commissionRepo';
import { agentCommissionCents } from '../services/workflow/policies';

/**
 * The agency's agent commission rates, as the database lets this user see them (an admin: everyone's;
 * an agent: their own). Loaded once per sign-in and shared by every screen; reload() after a change.
 */
type RatesState = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; rates: Record<string, number>; message?: string };
let state: RatesState = { status: 'idle', userId: null, rates: {} };
const listeners = new Set<() => void>();
const emit = (next: RatesState) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadAgentCommissionRates(userId: string | null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emit({ status: 'unavailable', userId, rates: {} });
  emit({ ...state, status: state.userId === userId && state.status === 'ready' ? 'ready' : 'loading', userId });
  const res = await fetchAgentCommissionRates();
  if (state.userId !== userId) return;
  emit(res.ok ? { status: 'ready', userId, rates: res.data } : { status: 'unavailable', userId, rates: {}, message: res.message });
}

export function useAgentCommissionRates(): RatesState & { reload: () => Promise<void> } {
  const userId = useAccountsStore((s) => s.currentUserId);
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if (state.userId !== userId || state.status === 'idle') void reloadAgentCommissionRates(userId);
  }, [userId]);
  return { ...snapshot, reload: () => reloadAgentCommissionRates(userId) };
}

/** What the commission line on a policy / endorsement says, for this viewer. */
export type CommissionView =
  | { kind: 'hidden' }
  | { kind: 'no_agent' }
  | { kind: 'no_rate'; agentName: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'amount'; agentName: string; rate: number; cents: (netCents: number, carrierRate?: number) => number };

/**
 * The agent is the account's assigned broker. Only that agent and the agency's admins see the
 * commission; anyone else helping on the account sees nothing at all. Outside an agency there are no
 * agency rates, so nothing shows.
 */
export function useAgentCommission(accountId: string): CommissionView {
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const members = useAccountsStore((s) => s.agencyMembers);
  const me = useAccountsStore((s) => s.currentUserId);
  const rates = useAgentCommissionRates();
  if (!account || !agencyAccess || !me) return { kind: 'hidden' };
  const isAdmin = agencyAccess.role === 'admin';
  const agentId = account.assignedUserId ?? null;
  if (!isAdmin && agentId !== me) return { kind: 'hidden' };
  if (!agentId) return { kind: 'no_agent' };
  if (rates.status === 'unavailable') return { kind: 'unavailable', message: rates.message ?? 'Commission rates aren’t available.' };
  const agentName = members.find((m) => m.userId === agentId)?.name ?? 'the assigned agent';
  const rate = rates.rates[agentId];
  if (rate === undefined) return rates.status === 'ready' ? { kind: 'no_rate', agentName } : { kind: 'hidden' };
  return { kind: 'amount', agentName, rate, cents: (net, carrierRate) => agentCommissionCents(net, rate, carrierRate) };
}
