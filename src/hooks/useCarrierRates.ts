import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchCarrierRateRows, type CarrierRateRow } from '../services/supabase/commissionRepo';
import { carrierKey } from '../services/workflow/policies';
import { toLocalDateKey } from '../services/workflow/dates';

/**
 * Each carrier's commission % by date (0063) — what it pays the agency on the policies and endorsements
 * bound from that date. Only the agency's admins can read them (carrier agreements are confidential); a
 * carrier without a rate on a date has none (not set: no commission yet). Loaded once per sign-in and shared by every screen; reload()
 * after a change.
 */
type State = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; rows: CarrierRateRow[]; message?: string };
let state: State = { status: 'idle', userId: null, rows: [] };
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadCarrierRates(userId: string | null, enabled = true): Promise<void> {
  if (!userId || !isSupabaseConfigured || !enabled) return emit({ status: 'unavailable', userId, rows: [] });
  emit({ ...state, status: state.userId === userId && state.status === 'ready' ? 'ready' : 'loading', userId });
  const res = await fetchCarrierRateRows();
  if (state.userId !== userId) return;
  emit(res.ok ? { status: 'ready', userId, rows: res.data } : { status: 'unavailable', userId, rows: [], message: res.message });
}

/** The rate row in force for a carrier on a date (latest one starting on or before it, not retired) — same as carrier_rate_on(). */
export function carrierRateRowOn(rows: CarrierRateRow[], carrier: string, dateKey: string): CarrierRateRow | undefined {
  const k = carrierKey(carrier);
  let best: CarrierRateRow | undefined;
  for (const r of rows) {
    if (r.carrierKey !== k || r.retiredAt || r.effectiveFrom > dateKey) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.setAt > best.setAt)) best = r;
  }
  return best;
}

export function useCarrierRates(): State & { reload: () => Promise<void>; rateOn: (carrier: string, dateKey?: string) => number | null; isSet: (carrier: string, dateKey?: string) => boolean } {
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
  const today = toLocalDateKey(new Date());
  return {
    ...snapshot,
    reload: () => reloadCarrierRates(userId),
    rateOn: (carrier, dateKey) => carrierRateRowOn(snapshot.rows, carrier, dateKey || today)?.rate ?? null,
    isSet: (carrier, dateKey) => !!carrierRateRowOn(snapshot.rows, carrier, dateKey || today),
  };
}
