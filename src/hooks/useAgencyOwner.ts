import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../services/supabase/client';
import { useAccountsStore } from '../state/useAccountsStore';

// The agency's Agency Owners (0086): the only ones who mark agents paid. One shared copy, reloaded after a change.
let cache: { agencyId: string; ownerIds: string[] } | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();
const NONE: string[] = [];

export async function reloadAgencyOwner(agencyId: string): Promise<void> {
  if (!supabase) return;
  loading = agencyId;
  const { data, error } = await supabase.from('agency_owners').select('user_id').eq('agency_id', agencyId);
  loading = null;
  cache = { agencyId, ownerIds: !error && data ? (data as { user_id: string }[]).map((r) => String(r.user_id)) : [] };
  listeners.forEach((l) => l());
}

/** The Agency Owners' user ids (none set, or before 0086: empty). */
export function useAgencyOwners(): string[] {
  const agencyId = useAccountsStore((s) => s.agencyAccess?.agencyId ?? null);
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache
  );
  useEffect(() => {
    if (agencyId && cache?.agencyId !== agencyId && loading !== agencyId) void reloadAgencyOwner(agencyId);
  }, [agencyId]);
  return snap && snap.agencyId === agencyId ? snap.ownerIds : NONE;
}
