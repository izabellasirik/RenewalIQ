import { useCallback, useEffect, useState } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { addMoneyEntry, deleteMoneyEntry, fetchMoneyEntries, updateMoneyEntry } from '../services/supabase/moneyRepo';
import type { MoneyEntry, MoneyFields } from '../services/finance/money';

type State = { status: 'loading' | 'ready' | 'unavailable'; entries: MoneyEntry[]; message?: string };

/**
 * The agency's income and expenses, for its admins (the database shows them to no one else). Loaded
 * when an admin opens Analytics; add / change / delete go straight to the database and update the list.
 */
export function useMoneyEntries(enabled: boolean) {
  const agencyId = useAccountsStore((s) => s.agencyAccess?.agencyId ?? null);
  const [state, setState] = useState<State>({ status: 'loading', entries: [] });

  const reload = useCallback(async () => {
    if (!enabled || !agencyId || !isSupabaseConfigured) return setState({ status: 'unavailable', entries: [], message: 'Income and expenses are kept for agencies signed in to the cloud.' });
    const res = await fetchMoneyEntries();
    setState(res.ok ? { status: 'ready', entries: res.data } : { status: 'unavailable', entries: [], message: res.message });
  }, [enabled, agencyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (fields: MoneyFields, id?: string): Promise<string | null> => {
    if (!agencyId) return 'Income and expenses are kept for agencies.';
    const res = id ? await updateMoneyEntry(id, fields) : await addMoneyEntry(agencyId, fields);
    if (!res.ok) return res.message;
    setState((s) => ({ ...s, entries: id ? s.entries.map((e) => (e.id === id ? res.data : e)) : [res.data, ...s.entries] }));
    return null;
  };

  const remove = async (id: string): Promise<string | null> => {
    const res = await deleteMoneyEntry(id);
    if (!res.ok) return res.message;
    setState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
    return null;
  };

  return { ...state, reload, save, remove };
}
