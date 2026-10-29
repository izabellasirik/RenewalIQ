import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchBrokerFeeShares, fetchBrokerFeeSplits, type BrokerFeeShare } from '../services/supabase/partnersRepo';
import { agentBrokerFeeShareCents } from '../services/workflow/policies';

// The broker fee shares this user may see (an admin: everyone's; an agent: their own) and the recorded
// splits per policy (0081), loaded once per sign-in and shared by every policy row.
type State = { userId: string | null; shares: Record<string, BrokerFeeShare>; splits: Record<string, { feeCents: number; agentCents: number }> } | null;
let state: State = null;
let loadingFor: string | null = null;
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadBrokerFeeShares(userId: string | null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emit({ userId, shares: {}, splits: {} });
  loadingFor = userId;
  const [shares, splits] = await Promise.all([fetchBrokerFeeShares(), fetchBrokerFeeSplits(null, null)]);
  loadingFor = null;
  emit({
    userId,
    shares: shares.ok ? shares.data : {},
    splits: splits.ok ? Object.fromEntries(splits.data.map((s) => [`${s.accountId}:${s.policyId}`, { feeCents: s.brokerFeeCents, agentCents: s.agentCents }])) : {},
  });
}

/**
 * The account agent's share of a policy's broker fee, for the viewers who see the agent commission (the
 * agent and admins): the recorded split once the policy is saved, else worked out from the agent's share.
 * null: no broker fee, no share set, or not this viewer's to see.
 */
export function useBrokerFeeShare(accountId: string): (policyId: string | null, feeCents: number | undefined) => number | null {
  const me = useAccountsStore((s) => s.currentUserId);
  const agentId = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId)?.assignedUserId ?? null);
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if ((state?.userId ?? null) !== me && loadingFor !== me) void reloadBrokerFeeShares(me);
  }, [me]);
  return (policyId, feeCents) => {
    if (!feeCents || !agentId || (!isAdmin && agentId !== me)) return null;
    const recorded = policyId ? snapshot?.splits[`${accountId}:${policyId}`] : undefined;
    if (recorded && recorded.feeCents === feeCents) return recorded.agentCents;
    return agentBrokerFeeShareCents(feeCents, snapshot?.shares[agentId]);
  };
}
