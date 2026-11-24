import { useEffect, useSyncExternalStore } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase/client';
import { useAccountsStore } from '../state/useAccountsStore';

/**
 * Where the agency's carrier commission and agent payouts come from in Analytics (0097):
 * 'policies' — worked out from the policies and endorsements (the default); 'statements' — from the
 * weekly income & expense statements the agency imports. Shared by every Analytics tab.
 */
export type CommissionSource = 'policies' | 'statements';
type State = { agencyId: string | null; source: CommissionSource; loaded: boolean; available: boolean };
let state: State = { agencyId: null, source: 'policies', loaded: false, available: true };
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

async function load(agencyId: string | null) {
  if (!agencyId || !isSupabaseConfigured || !supabase) return emit({ agencyId, source: 'policies', loaded: true, available: false });
  const { data, error } = await supabase.rpc('agency_commission_source');
  emit({ agencyId, source: data === 'statements' ? 'statements' : 'policies', loaded: true, available: !error });
}

export function useCommissionSource() {
  const agencyId = useAccountsStore((s) => s.agencyAccess?.agencyId ?? null);
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if (state.agencyId !== agencyId || !state.loaded) void load(agencyId);
  }, [agencyId]);
  const set = async (source: CommissionSource): Promise<string | null> => {
    if (!supabase) return 'Cloud sign-in is not configured.';
    const { error } = await supabase.rpc('set_agency_commission_source', { p_source: source });
    if (error) return /set_agency_commission_source/.test(error.message) || error.code === 'PGRST202' ? 'This setting needs database migration 0097_commission_source.sql.' : error.message;
    emit({ ...state, source });
    return null;
  };
  return { source: snap.source, loaded: snap.loaded, available: snap.available, set };
}
