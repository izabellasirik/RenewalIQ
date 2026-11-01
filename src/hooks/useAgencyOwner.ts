import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../services/supabase/client';
import { useAccountsStore } from '../state/useAccountsStore';

// The agency's Agency Owner (0086): the only one who marks agents paid. One shared copy, reloaded after it changes.
let cache: { agencyId: string; ownerId: string | null } | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();

export async function reloadAgencyOwner(agencyId: string): Promise<void> {
  if (!supabase) return;
  loading = agencyId;
  const { data, error } = await supabase.from('agency_owners').select('user_id').eq('agency_id', agencyId).maybeSingle();
  loading = null;
  cache = { agencyId, ownerId: !error && data ? String((data as { user_id: string }).user_id) : null };
  listeners.forEach((l) => l());
}

/** RenewalIQ founder only: make a member the Agency Owner (null: none). */
export async function setAgencyOwner(agencyId: string, userId: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Not connected.' };
  const { error } = await supabase.rpc('set_agency_owner', { p_agency_id: agencyId, p_user_id: userId });
  if (error) return { ok: false, message: error.message };
  await reloadAgencyOwner(agencyId);
  return { ok: true };
}

/** The Agency Owner's user id (null: none set, or before 0086). */
export function useAgencyOwner(): string | null {
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
  return snap && snap.agencyId === agencyId ? snap.ownerId : null;
}
