import { useCallback, useEffect, useState } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { addMoneyEntry, deleteMoneyEntry, deleteReceiptFiles, fetchMoneyEntries, updateMoneyEntry, uploadReceipt } from '../services/supabase/moneyRepo';
import type { MoneyEntry, MoneyFields, MoneyReceipt } from '../services/finance/money';

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

  /**
   * Saves the entry. With `files`: the receipts it keeps plus new files to upload — uploaded first,
   * removed again if the entry can't be saved; receipts taken off the entry are deleted once it's saved.
   */
  const save = async (fields: MoneyFields, id?: string, files?: { kept: MoneyReceipt[]; added: File[] }): Promise<string | null> => {
    if (!agencyId) return 'Income and expenses are kept for agencies.';
    const uploaded: MoneyReceipt[] = [];
    for (const file of files?.added ?? []) {
      const up = await uploadReceipt(agencyId, file);
      if (!up.ok) {
        await deleteReceiptFiles(uploaded.map((r) => r.path));
        return up.message;
      }
      uploaded.push(up.data);
    }
    const receipts = files ? [...files.kept, ...uploaded] : undefined;
    const res = id ? await updateMoneyEntry(id, fields, receipts) : await addMoneyEntry(agencyId, fields, receipts);
    if (!res.ok) {
      await deleteReceiptFiles(uploaded.map((r) => r.path));
      return res.message;
    }
    if (id && files) {
      const before = state.entries.find((e) => e.id === id)?.receipts ?? [];
      const keep = new Set(files.kept.map((r) => r.path));
      await deleteReceiptFiles(before.filter((r) => !keep.has(r.path)).map((r) => r.path));
    }
    setState((s) => ({ ...s, entries: id ? s.entries.map((e) => (e.id === id ? res.data : e)) : [res.data, ...s.entries] }));
    return null;
  };

  const remove = async (id: string): Promise<string | null> => {
    const receipts = state.entries.find((e) => e.id === id)?.receipts ?? [];
    const res = await deleteMoneyEntry(id);
    if (!res.ok) return res.message;
    await deleteReceiptFiles(receipts.map((r) => r.path));
    setState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
    return null;
  };

  return { ...state, reload, save, remove };
}
