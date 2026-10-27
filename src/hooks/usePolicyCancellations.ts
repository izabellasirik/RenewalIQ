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
  if (allFull) void reloadAll();
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

// Every account's full cancellations (what this user may see), for account statuses on lists.
let allFull: Set<string> | null = null;
let allLoading = false;
async function reloadAll() {
  allLoading = true;
  const r = await fetchPolicyCancellations();
  allLoading = false;
  allFull = new Set((r.ok ? r.data : []).filter((c) => c.type === 'full' && !c.undoneAt && c.status === 'approved').map((c) => `${c.accountId}|${c.policyId}`));
  notify();
}

/** (accountId) → (policyId) → fully cancelled? Used to show an account as Cancelled when nothing is in force. */
export function useCancelledPolicies(): (accountId: string) => (policyId: string) => boolean {
  const set = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => allFull
  );
  useEffect(() => {
    if (!allFull && !allLoading) void reloadAll();
  }, []);
  return (accountId) => (policyId) => !!set?.has(`${accountId}|${policyId}`);
}
