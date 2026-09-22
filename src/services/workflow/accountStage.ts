import type { Account, AccountStage, MarketQuote, MissingItem } from '../../types';
import { AWAITING_CARRIER_STATUSES } from '../../types';

/**
 * The account's pipeline status as the system sees it, from checklist and quote state. Used
 * whenever the broker hasn't set one by hand, so every account always has a filterable status.
 */
export function deriveAccountStage(items: MissingItem[], quotes: MarketQuote[]): AccountStage {
  if (quotes.some((q) => q.status === 'bound')) return 'bound';
  if (quotes.some((q) => q.status === 'quoted')) return 'quoted';
  if (quotes.some((q) => AWAITING_CARRIER_STATUSES.includes(q.status))) return 'submitted';
  const active = items.filter((i) => i.status !== 'waived');
  if (active.length > 0 && active.every((i) => i.status === 'received')) return 'ready_to_submit';
  if (active.length > 0 || quotes.length > 0) return 'collecting_info';
  return 'new';
}

/** The status to show and filter on: the broker's manual choice, else the derived one. */
export function effectiveAccountStage(account: Account, items: MissingItem[], quotes: MarketQuote[]): { stage: AccountStage; manual: boolean } {
  if (account.stage) return { stage: account.stage, manual: true };
  return { stage: deriveAccountStage(items, quotes), manual: false };
}
