import { useEffect, useSyncExternalStore } from 'react';
import { fetchNoteSummaries, type NoteSummary } from '../services/supabase/noteSummariesRepo';
import { isSupabaseConfigured } from '../services/supabase/client';

// One shared copy of the saved notes summaries (0082) for every card; a new summary replaces its account's.
// `available` is false outside the cloud or before 0082, and the cards then show no summary block.
type State = { byAccount: Record<string, NoteSummary>; available: boolean } | null;
let cache: State = null;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function reloadNoteSummaries(): Promise<void> {
  if (!isSupabaseConfigured) {
    cache = { byAccount: {}, available: false };
    return notify();
  }
  loading = true;
  const r = await fetchNoteSummaries();
  loading = false;
  cache = r.ok ? { byAccount: Object.fromEntries(r.data.map((s) => [s.accountId, s])), available: true } : { byAccount: {}, available: !r.missingMigration };
  notify();
}

export function putNoteSummary(s: NoteSummary): void {
  cache = { byAccount: { ...(cache?.byAccount ?? {}), [s.accountId]: s }, available: true };
  notify();
}

export function useNoteSummaries(): { byAccount: Record<string, NoteSummary>; available: boolean; loaded: boolean } {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache
  );
  useEffect(() => {
    if (cache === null && !loading) void reloadNoteSummaries();
  }, []);
  return { byAccount: state?.byAccount ?? {}, available: state?.available ?? false, loaded: state !== null };
}
