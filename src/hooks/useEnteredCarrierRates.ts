import { useEffect, useSyncExternalStore } from 'react';
import { fetchEnteredCarrierRates } from '../services/supabase/commissionRepo';

// The carrier % entered on each policy / endorsement of an account (0073), by policy id. One shared copy per
// account; reloaded after a % is saved, so the commission line can show the amount before it's recorded.
const cache = new Map<string, Map<string, number>>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const EMPTY = new Map<string, number>();

export async function reloadEnteredCarrierRates(accountId: string): Promise<void> {
  loading.add(accountId);
  const r = await fetchEnteredCarrierRates(accountId);
  loading.delete(accountId);
  cache.set(accountId, new Map(r.ok ? [...r.data].map(([key, v]) => [key.slice(accountId.length + 1), v.rate]) : []));
  listeners.forEach((l) => l());
}

export function useEnteredCarrierRates(accountId: string): Map<string, number> {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache.get(accountId) ?? EMPTY
  );
  useEffect(() => {
    if (!cache.has(accountId) && !loading.has(accountId)) void reloadEnteredCarrierRates(accountId);
  }, [accountId]);
  return snap;
}
