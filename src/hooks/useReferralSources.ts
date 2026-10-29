import { useEffect, useSyncExternalStore } from 'react';
import { fetchReferralSourceNames, NO_REFERRAL, type ReferralSourceName } from '../services/supabase/partnersRepo';
import { isSupabaseConfigured } from '../services/supabase/client';

// One shared copy of the agency's referral sources (names only — 0081), reloaded after an admin changes them.
let cache: ReferralSourceName[] | null = null;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function reloadReferralSources(): Promise<void> {
  if (!isSupabaseConfigured) {
    cache = [];
    return notify();
  }
  loading = true;
  const r = await fetchReferralSourceNames();
  loading = false;
  cache = r.ok ? r.data : [];
  notify();
}

export function useReferralSources(): ReferralSourceName[] {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache
  );
  useEffect(() => {
    if (cache === null && !loading) void reloadReferralSources();
  }, []);
  return list ?? [];
}

/** "No referral", a source's name, or "Not set" for an account from before referral sources. */
export function referralLabel(value: string | undefined, sources: ReferralSourceName[]): string {
  if (!value) return 'Not set';
  if (value === NO_REFERRAL) return 'No referral';
  return sources.find((s) => s.id === value)?.name ?? 'Unknown partner';
}
