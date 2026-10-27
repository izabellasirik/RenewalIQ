import { useEffect, useSyncExternalStore } from 'react';
import { fetchPolicyCancellations, type PolicyCancellation } from '../services/supabase/ledgerRepo';

// One shared copy per account, so the market header and its policies show the same cancellations.
const cache = new Map<string, PolicyCancellation[]>();
const listeners = new Set<() => void>();
const loading = new Set<string>();
const notify = () => listeners.forEach((l) => l());

export async function reloadPolicyCancellations(accountId: string): Promise<void> {
  loading.add(accountId);
  const r = await fetchPolicyCancellations(accountId);
  loading.delete(accountId);
  cache.set(accountId, r.ok ? r.data : []);
  notify();
}

/** This account's cancellations that still count (not undone), newest first. */
export function usePolicyCancellations(accountId: string): PolicyCancellation[] {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache.get(accountId)
  );
  useEffect(() => {
    if (!cache.has(accountId) && !loading.has(accountId)) void reloadPolicyCancellations(accountId);
  }, [accountId]);
  return list ?? [];
}

/** How a policy / endorsement stands after its (not undone) cancellations. */
export function cancellationState(all: PolicyCancellation[], policyId: string) {
  const mine = all.filter((c) => c.policyId === policyId && !c.undoneAt && c.status === 'approved');
  const full = mine.find((c) => c.type === 'full');
  return { full, partial: full ? [] : mine.filter((c) => c.type === 'partial'), all: mine };
}
