import { useEffect, useSyncExternalStore } from 'react';
import { fetchOtherReferrals, type OtherReferral } from '../services/supabase/partnersRepo';
import { isSupabaseConfigured } from '../services/supabase/client';

// One shared copy of the clients' "Other" referral partners (0083), by account id; reloaded after one is set or
// an admin decides on one.
let cache: Record<string, OtherReferral> | null = null;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function reloadOtherReferrals(): Promise<void> {
  if (!isSupabaseConfigured) {
    cache = {};
    return notify();
  }
  loading = true;
  const r = await fetchOtherReferrals();
  loading = false;
  cache = r.ok ? r.data : {};
  notify();
}

export function useOtherReferrals(): Record<string, OtherReferral> {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache
  );
  useEffect(() => {
    if (cache === null && !loading) void reloadOtherReferrals();
  }, []);
  return list ?? {};
}
