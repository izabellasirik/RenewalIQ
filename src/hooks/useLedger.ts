import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchAccountCommissionStatuses, fetchLedger, fetchMyCancellations, fetchMyCommissions, type AccountCommissionStatus, type LedgerSnapshot, type MyCancellation, type MyCommission } from '../services/supabase/ledgerRepo';

/**
 * Commission records (0064) for the screens. Admins: the whole agency's records (loaded once per
 * sign-in and shared; reload() after an action). Agents: their own commissions only. Without 0064 every
 * hook says "unavailable" with the message, and the screens fall back to working the amounts out.
 */
type LedgerState = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; data: LedgerSnapshot | null; message?: string; missingMigration?: boolean };
let ledger: LedgerState = { status: 'idle', userId: null, data: null };
const ledgerListeners = new Set<() => void>();
const emitLedger = (next: LedgerState) => {
  ledger = next;
  for (const l of ledgerListeners) l();
};

export async function reloadLedger(userId: string | null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emitLedger({ status: 'unavailable', userId, data: null });
  emitLedger({ ...ledger, status: ledger.userId === userId && ledger.status === 'ready' ? 'ready' : 'loading', userId });
  const res = await fetchLedger();
  if (ledger.userId !== userId) return;
  emitLedger(res.ok ? { status: 'ready', userId, data: res.data } : { status: 'unavailable', userId, data: null, message: res.message, missingMigration: res.missingMigration });
}

/** The agency's commission records — admins only (an agent gets status 'unavailable'). */
export function useLedger(): LedgerState & { reload: () => Promise<void> } {
  const userId = useAccountsStore((s) => s.currentUserId);
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const snapshot = useSyncExternalStore(
    (l) => {
      ledgerListeners.add(l);
      return () => ledgerListeners.delete(l);
    },
    () => ledger
  );
  useEffect(() => {
    if (isAdmin && (ledger.userId !== userId || ledger.status === 'idle')) void reloadLedger(userId);
  }, [userId, isAdmin]);
  const reload = useCallback(() => reloadLedger(userId), [userId]);
  if (!isAdmin) return { status: 'unavailable', userId, data: null, reload };
  return { ...snapshot, reload };
}

type Mine = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; userId: string | null; commissions: MyCommission[]; cancellations: MyCancellation[]; message?: string };
let mine: Mine = { status: 'idle', userId: null, commissions: [], cancellations: [] };
const mineListeners = new Set<() => void>();
const emitMine = (next: Mine) => {
  mine = next;
  for (const l of mineListeners) l();
};

export async function reloadMyCommissions(userId: string | null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emitMine({ status: 'unavailable', userId, commissions: [], cancellations: [] });
  emitMine({ ...mine, status: mine.userId === userId && mine.status === 'ready' ? 'ready' : 'loading', userId });
  const [c, x] = await Promise.all([fetchMyCommissions(), fetchMyCancellations()]);
  if (mine.userId !== userId) return;
  if (!c.ok) return emitMine({ status: 'unavailable', userId, commissions: [], cancellations: [], message: c.message });
  emitMine({ status: 'ready', userId, commissions: c.data, cancellations: x.ok ? x.data : [] });
}

/** The signed-in agent's own commissions and cancellation requests (never carrier figures). */
export function useMyCommissions(enabled: boolean): Mine & { reload: () => Promise<void> } {
  const userId = useAccountsStore((s) => s.currentUserId);
  const snapshot = useSyncExternalStore(
    (l) => {
      mineListeners.add(l);
      return () => mineListeners.delete(l);
    },
    () => mine
  );
  useEffect(() => {
    if (enabled && (mine.userId !== userId || mine.status === 'idle')) void reloadMyCommissions(userId);
  }, [userId, enabled]);
  const reload = useCallback(() => reloadMyCommissions(userId), [userId]);
  return { ...snapshot, reload };
}

/** Commission status of one account's policies, for its agent and the agency's admins. Reloads when the account's markets change. */
export function useAccountCommissionStatuses(accountId: string): { status: 'loading' | 'ready' | 'unavailable'; byPolicy: Map<string, AccountCommissionStatus>; reload: () => void } {
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const quotes = useAccountsStore((s) => s.quotes[accountId]);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'unavailable'; byPolicy: Map<string, AccountCommissionStatus> }>({ status: 'loading', byPolicy: new Map() });
  const [tick, setTick] = useState(0);
  const policiesKey = JSON.stringify((quotes ?? []).map((q) => (q.policies ?? []).map((p) => [p.id, p.netPremiumCents, p.attachments?.length ?? 0, p.removedAt ?? ''])));
  useEffect(() => {
    if (!agencyAccess || !isSupabaseConfigured) {
      setState({ status: 'unavailable', byPolicy: new Map() });
      return;
    }
    let live = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ids = (quotes ?? []).flatMap((q) => (q.policies ?? []).filter((p) => !p.removedAt).map((p) => p.id));
    // The record is written by the database when the account is saved: give the save a moment, and look
    // once more if a policy on the account has no record yet (its save may still be on the way).
    const load = (again: boolean) =>
      void fetchAccountCommissionStatuses(accountId).then((res) => {
        if (!live) return;
        const byPolicy = res.ok ? new Map(res.data.map((r) => [r.policyId, r])) : new Map<string, AccountCommissionStatus>();
        setState(res.ok ? { status: 'ready', byPolicy } : { status: 'unavailable', byPolicy });
        if (again && res.ok && ids.some((id) => !byPolicy.has(id))) timers.push(setTimeout(() => load(false), 3000));
      });
    timers.push(setTimeout(() => load(true), 1200));
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
  }, [accountId, agencyAccess, policiesKey, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
