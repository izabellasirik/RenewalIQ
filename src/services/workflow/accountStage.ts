import type { Account, AccountStage, MarketQuote, MissingItem } from '../../types';
import { AWAITING_CARRIER_STATUSES, MANUAL_ACCOUNT_STAGES } from '../../types';

/**
 * The account's pipeline status as the system sees it, from checklist and quote state. Used
 * whenever the broker hasn't set one by hand, so every account always has a filterable status.
 */
export function deriveAccountStage(items: MissingItem[], quotes: MarketQuote[], cancelled?: (policyId: string) => boolean): AccountStage {
  const bound = quotes.filter((q) => q.status === 'bound');
  // Bound while any bound market still has a policy in force (or none recorded); every policy fully
  // cancelled → Cancelled, unless other markets are still in play (then their status).
  const inForce = (q: MarketQuote) => {
    const policies = (q.policies ?? []).filter((p) => !p.removedAt && p.kind !== 'endorsement');
    return policies.length === 0 || !cancelled || policies.some((p) => !cancelled(p.id));
  };
  if (bound.some(inForce)) return 'bound';
  const allCancelled = bound.length > 0;
  if (quotes.some((q) => q.status === 'quoted')) return 'quoted';
  if (quotes.some((q) => AWAITING_CARRIER_STATUSES.includes(q.status))) return 'submitted';
  if (allCancelled) return 'cancelled';
  const active = items.filter((i) => i.status !== 'waived');
  if (active.length > 0 && active.every((i) => i.status === 'received')) return 'ready_to_submit';
  if (active.length > 0 || quotes.length > 0) return 'collecting_info';
  return 'new';
}

/** The status to show and filter on: the broker's manual choice, else the derived one. */
/**
 * When the account was bound, for a Bound status: the date the agent gave when setting Bound by hand,
 * else (automatic Bound) the latest bound market's date. Null when not Bound or no date is known.
 */
export function accountBoundDate(account: Pick<Account, 'stage' | 'boundDate'>, stage: AccountStage, quotes: Pick<MarketQuote, 'status' | 'boundDate'>[]): string | null {
  if (stage !== 'bound') return null;
  if (account.stage === 'bound' && account.boundDate) return account.boundDate;
  return quotes.filter((q) => q.status === 'bound' && q.boundDate).map((q) => q.boundDate!).sort().at(-1) ?? null;
}

export function effectiveAccountStage(account: Account, items: MissingItem[], quotes: MarketQuote[], cancelled?: (policyId: string) => boolean): { stage: AccountStage; manual: boolean } {
  // (A status this version doesn't know — e.g. one saved by an earlier preview — counts as automatic.)
  if (account.stage && MANUAL_ACCOUNT_STAGES.includes(account.stage)) return { stage: account.stage, manual: true };
  return { stage: deriveAccountStage(items, quotes, cancelled), manual: false };
}
