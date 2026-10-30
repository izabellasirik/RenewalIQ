import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchBrokerFeeShares, fetchBrokerFeeSplits, type BrokerFeeShare } from '../services/supabase/partnersRepo';
import { agentBrokerFeeShareCents } from '../services/workflow/policies';
import { useReferralSources } from './useReferralSources';

// The broker fee shares this user may see (an admin: everyone's; an agent: their own) and the recorded
// splits per policy (0081), shared by every policy row. Reloaded after an admin changes a share or decides on
// a new partner, and when the tab comes back into view (at most once a minute).
type State = { userId: string | null; at: number; shares: Record<string, BrokerFeeShare>; splits: Record<string, { feeCents: number; agentCents: number | null; pending: boolean; shortfallCents: number }> } | null;
let state: State = null;
let loadingFor: string | null = null;
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadBrokerFeeShares(userId: string | null = state?.userId ?? null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emit({ userId, at: Date.now(), shares: {}, splits: {} });
  loadingFor = userId;
  const [shares, splits] = await Promise.all([fetchBrokerFeeShares(), fetchBrokerFeeSplits(null, null)]);
  loadingFor = null;
  emit({
    userId,
    at: Date.now(),
    shares: shares.ok ? shares.data : {},
    splits: splits.ok ? Object.fromEntries(splits.data.map((s) => [`${s.accountId}:${s.policyId}`, { feeCents: s.brokerFeeCents, agentCents: s.agentCents, pending: s.partnerPending, shortfallCents: s.partnerShortfallCents }])) : {},
  });
}

/** What the commission line says about a policy's broker fee, for this viewer. */
export type BrokerFeeShareView =
  /** No broker fee, or not this viewer's to see. */
  | { kind: 'none' }
  /** shortfallCents: what the broker fee didn't cover of the referral partner's agreed amount, taken from the agent commission. */
  | { kind: 'amount'; cents: number; feeCents: number; shortfallCents: number }
  /** The agent has no broker fee share yet (an admin sets it on Team and Partners). */
  | { kind: 'no_share'; feeCents: number; shortfallCents: number }
  /** The client's referral partner was added under "Other" and awaits an admin's approval. */
  | { kind: 'pending_partner'; feeCents: number; partnerName: string };

/**
 * The account agent's share of a policy's broker fee, for the viewers who see the agent commission (the agent and
 * admins): the recorded split once the policy is saved, else worked out from the agent's share. `referral`: the
 * client's referral partner as chosen in the policy form, when it differs from the account's.
 */
export function useBrokerFeeShare(accountId: string): (policyId: string | null, feeCents: number | undefined, referral?: string) => BrokerFeeShareView {
  const me = useAccountsStore((s) => s.currentUserId);
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const sources = useReferralSources();
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
  useEffect(() => {
    if ((state?.userId ?? null) !== me && loadingFor !== me) void reloadBrokerFeeShares(me);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && state && Date.now() - state.at > 60_000 && !loadingFor) void reloadBrokerFeeShares(me);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [me]);
  const agentId = account?.assignedUserId ?? null;
  return (policyId, feeCents, referral) => {
    if (!feeCents || !agentId || (!isAdmin && agentId !== me)) return { kind: 'none' };
    const partner = sources.find((s) => s.id === (referral ?? account?.referralSource));
    if (partner?.status === 'pending') return { kind: 'pending_partner', feeCents, partnerName: partner.name };
    const recorded = policyId ? snapshot?.splits[`${accountId}:${policyId}`] : undefined;
    const same = recorded && recorded.feeCents === feeCents && !recorded.pending;
    const shortfallCents = same ? recorded.shortfallCents : 0;
    if (same && recorded.agentCents !== null && (recorded.agentCents > 0 || snapshot?.shares[agentId])) return { kind: 'amount', cents: recorded.agentCents, feeCents, shortfallCents };
    const cents = agentBrokerFeeShareCents(feeCents, snapshot?.shares[agentId]);
    return cents === null ? { kind: 'no_share', feeCents, shortfallCents } : { kind: 'amount', cents, feeCents, shortfallCents };
  };
}

/** Every recorded broker fee split this user may see, by "accountId:policyId" (Analytics → Policies & endorsements). */
export function useBrokerFeeSplits(): Record<string, { feeCents: number; agentCents: number | null; pending: boolean; shortfallCents: number }> {
  const me = useAccountsStore((s) => s.currentUserId);
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
  return snapshot?.splits ?? {};
}
