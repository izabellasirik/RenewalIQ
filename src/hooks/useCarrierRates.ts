import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchPolicyCarrierRates } from '../services/supabase/commissionRepo';
import { DEFAULT_CARRIER_RATE, carrierRateKey } from '../services/workflow/policies';

/**
 * Each policy's carrier commission % (0060), as the database lets this user see them: an admin all the
 * agency's, an agent those on accounts assigned to them. A policy without one uses 10%. Loaded once per
 * sign-in and shared by every screen; reload() after a change.
 */
type State = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; rates: Record<string, number>; message?: string };
let state: State = { status: 'idle', userId: null, rates: {} };
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadCarrierRates(userId: string | null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emit({ status: 'unavailable', userId, rates: {} });
  emit({ ...state, status: state.userId === userId && state.status === 'ready' ? 'ready' : 'loading', userId });
  const res = await fetchPolicyCarrierRates();
  if (state.userId !== userId) return;
  emit(res.ok ? { status: 'ready', userId, rates: res.data } : { status: 'unavailable', userId, rates: {}, message: res.message });
}

export function useCarrierRates(): State & { reload: () => Promise<void>; rateOf: (accountId: string, policyId: string) => number; isSet: (accountId: string, policyId: string) => boolean } {
  const userId = useAccountsStore((s) => s.currentUserId);
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if (state.userId !== userId || state.status === 'idle') void reloadCarrierRates(userId);
  }, [userId]);
  return {
    ...snapshot,
    reload: () => reloadCarrierRates(userId),
    rateOf: (accountId, policyId) => snapshot.rates[carrierRateKey(accountId, policyId)] ?? DEFAULT_CARRIER_RATE,
    isSet: (accountId, policyId) => carrierRateKey(accountId, policyId) in snapshot.rates,
  };
}
