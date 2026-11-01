import { useEffect, useSyncExternalStore } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { isSupabaseConfigured } from '../services/supabase/client';
import { fetchBrokerFeeShares, fetchBrokerFeeSplits, fetchReferralSources, NO_REFERRAL, OTHER_REFERRAL, type BrokerFeeShare, type OtherReferral } from '../services/supabase/partnersRepo';
import { activePolicies, agentBrokerFeeShareCents, isFirstPolicy, policyReferralChoice, referralPartnerSplit } from '../services/workflow/policies';
import { useReferralSources } from './useReferralSources';
import { useOtherReferrals } from './useOtherReferrals';

// The broker fee shares this user may see (an admin: everyone's; an agent: their own) and the recorded
// splits per policy (0081), shared by every policy row. Reloaded after an admin changes a share or decides on
// a new partner, and when the tab comes back into view (at most once a minute).
// `partners`: the listed partners' agreed amounts, for admins only (agents can't read them; 0081).
type State = { userId: string | null; at: number; shares: Record<string, BrokerFeeShare>; partners: Record<string, { feeCents: number | null; active: boolean }>; splits: Record<string, { feeCents: number; agentCents: number | null; pending: boolean; shortfallCents: number }> } | null;
let state: State = null;
let loadingFor: string | null = null;
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export async function reloadBrokerFeeShares(userId: string | null = state?.userId ?? null): Promise<void> {
  if (!userId || !isSupabaseConfigured) return emit({ userId, at: Date.now(), shares: {}, partners: {}, splits: {} });
  loadingFor = userId;
  const [shares, splits, partners] = await Promise.all([fetchBrokerFeeShares(), fetchBrokerFeeSplits(null, null), fetchReferralSources()]);
  loadingFor = null;
  emit({
    userId,
    at: Date.now(),
    shares: shares.ok ? shares.data : {},
    partners: partners.ok ? Object.fromEntries(partners.data.map((r) => [r.id, { feeCents: r.partnerFeeCents, active: r.active }])) : {},
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
  ;

/** The policy form's own values: its bound date, and who gets a referral fee from this policy (0085). */
export type BrokerFeeShareForm = { boundDate?: string; referral?: string; other?: OtherReferral | null };

/**
 * The account agent's share of a policy's broker fee, for the viewers who see the agent commission (the agent and
 * admins): the recorded split once the policy is saved, else worked out the way the database does — the referral
 * partner chosen on the policy takes their amount off the broker fee first, and the agent's share is of the rest.
 */
export function useBrokerFeeShare(accountId: string): (policyId: string | null, feeCents: number | undefined, form?: BrokerFeeShareForm) => BrokerFeeShareView {
  const quotes = useAccountsStore((s) => s.quotes[accountId]);
  const others = useOtherReferrals();
  const sources = useReferralSources();
  const me = useAccountsStore((s) => s.currentUserId);
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
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
    const onVisible = () => {
      if (document.visibilityState === 'visible' && state && Date.now() - state.at > 60_000 && !loadingFor) void reloadBrokerFeeShares(me);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [me]);
  const agentId = account?.assignedUserId ?? null;
  return (policyId, feeCents, form) => {
    if (!feeCents || !agentId || (!isAdmin && agentId !== me)) return { kind: 'none' };
    const policies = (quotes ?? []).flatMap((q) => activePolicies(q));
    const saved = policyId ? policies.find((p) => p.id === policyId) : undefined;
    const savedChoice = saved ? policyReferralChoice(saved, policies, account?.referralSource) : undefined;
    const recorded = policyId ? snapshot?.splits[`${accountId}:${policyId}`] : undefined;
    const unchanged = !!saved && (!form?.boundDate || form.boundDate === saved.boundDate) && (form?.referral === undefined || form.referral === savedChoice);
    if (recorded && unchanged && recorded.feeCents === feeCents && !recorded.pending && recorded.agentCents !== null && (recorded.agentCents > 0 || snapshot?.shares[agentId]))
      return { kind: 'amount', cents: recorded.agentCents, feeCents, shortfallCents: recorded.shortfallCents };
    // Not saved yet (or changed in the form): worked out the way the database does (0085).
    const explicit = form?.referral !== undefined || !!saved?.referralPartner;
    const choice = form?.referral ?? savedChoice ?? (isFirstPolicy(policies, { id: null, boundDate: form?.boundDate }) ? account?.referralSource || NO_REFERRAL : NO_REFERRAL);
    let partner = 0;
    if (choice === OTHER_REFERRAL) {
      const other = form?.other ?? others[accountId];
      if (!other) return { kind: 'none' };
      partner = other.partnerFeeCents;
    } else if (choice && choice !== NO_REFERRAL) {
      const named = sources.find((x) => x.id === choice);
      const listed = named && named.partnerFeeCents !== undefined ? { feeCents: named.partnerFeeCents, active: named.active } : snapshot?.partners[choice];
      // The partner's amount isn't known here (before 0085, for an agent): shown once the policy is saved.
      if (!listed) return { kind: 'none' };
      partner = explicit || listed.active ? (listed.feeCents ?? 0) : 0;
    }
    const split = referralPartnerSplit(feeCents, partner);
    const cents = agentBrokerFeeShareCents(feeCents, snapshot?.shares[agentId], split.partnerCents);
    return cents === null ? { kind: 'no_share', feeCents, shortfallCents: split.shortfallCents } : { kind: 'amount', cents, feeCents, shortfallCents: split.shortfallCents };
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
