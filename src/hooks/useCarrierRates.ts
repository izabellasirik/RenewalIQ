import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchCarrierCommissionRates } from '../services/supabase/commissionRepo';
import { DEFAULT_CARRIER_RATE, carrierKey } from '../services/workflow/policies';

/**
 * Each carrier's commission % (0063) — what it pays the agency on every policy and endorsement written
 * with it. Only the agency's admins can read them (carrier agreements are confidential); a carrier without
 * one uses 10%. Loaded once per sign-in and shared by every screen; reload() after a change.
 */
type State = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; rates: Record<string, number>; message?: string };
let state: State = { status: 'idle', userId: null, rates: {} };
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadCarrierRates(userId: string | null, enabled = true): Promise<void> {
  if (!userId || !isSupabaseConfigured || !enabled) return emit({ status: 'unavailable', userId, rates: {} });
  emit({ ...state, status: state.userId === userId && state.status === 'ready' ? 'ready' : 'loading', userId });
  const res = await fetchCarrierCommissionRates();
  if (state.userId !== userId) return;
  emit(res.ok ? { status: 'ready', userId, rates: res.data } : { status: 'unavailable', userId, rates: {}, message: res.message });
}

export function useCarrierRates(): State & { reload: () => Promise<void>; rateOf: (carrier: string) => number; isSet: (carrier: string) => boolean } {
  const userId = useAccountsStore((s) => s.currentUserId);
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if (isAdmin && (state.userId !== userId || state.status === 'idle')) void reloadCarrierRates(userId);
  }, [userId, isAdmin]);
  return {
    ...snapshot,
    reload: () => reloadCarrierRates(userId),
    rateOf: (carrier) => snapshot.rates[carrierKey(carrier)] ?? DEFAULT_CARRIER_RATE,
    isSet: (carrier) => carrierKey(carrier) in snapshot.rates,
  };
}
