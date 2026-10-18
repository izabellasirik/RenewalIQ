import type { Account, MarketQuote } from '../../types';
import { addDays } from './dates';
import { isRenewalDue, resolveRenewals } from './renewals';

/**
 * The Accounts page's renewal filter:
 * - "due": renewals being worked — from their start-working date until a market is bound for them
 *   (overdue ones stay, so nothing drops off unhandled). The same renewals Today's Plate reminds about.
 * - "30" / "60" / "90": an open renewal whose renewal date is between today and that many days out.
 */
export type RenewalFilter = 'any' | 'due' | '30' | '60' | '90';
export const RENEWAL_FILTERS: RenewalFilter[] = ['any', 'due', '30', '60', '90'];

/** The renewal date that puts the account under the filter (soonest first), or null when it doesn't match. */
export function renewalFilterDate(
  account: Pick<Account, 'renewals' | 'businessType'>,
  effectiveDate: string | null,
  quotes: Pick<MarketQuote, 'status'>[],
  filter: RenewalFilter,
  today: string
): string | null {
  if (filter === 'any') return null;
  const resolved = resolveRenewals(account, effectiveDate, quotes);
  const dates =
    filter === 'due'
      ? resolved.filter((r) => isRenewalDue(r, today)).map((r) => r.renewalDate)
      : resolved
          .filter((r) => r.status === 'open' && r.renewalDate && r.renewalDate >= today && r.renewalDate <= addDays(today, Number(filter)))
          .map((r) => r.renewalDate);
  const found = dates.filter((d): d is string => !!d).sort();
  return found[0] ?? null;
}

/** "Bound in": markets marked Bound with a bound date in the chosen period. */
export type BoundFilter = 'any' | 'last_7_days' | 'this_month' | 'last_month' | 'custom';
export const BOUND_FILTERS: BoundFilter[] = ['any', 'last_7_days', 'this_month', 'last_month', 'custom'];

/** The inclusive date range for a "Bound in" choice; null for "any" or an incomplete custom range. */
export function boundRange(filter: BoundFilter, today: string, custom?: { from?: string; to?: string }): { from: string; to: string } | null {
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  switch (filter) {
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'this_month':
      return { from: monthStart(y, m), to: today };
    case 'last_month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: monthStart(py, pm), to: addDays(monthStart(y, m), -1) };
    }
    case 'custom': {
      const from = custom?.from;
      const to = custom?.to;
      if (!from && !to) return null;
      return { from: from ?? '0000-01-01', to: to ?? '9999-12-31' };
    }
    default:
      return null;
  }
}

/** The account's latest bound date in the range (most recent first), or null. Markets no longer Bound don't count. */
export function latestBoundIn(quotes: Pick<MarketQuote, 'status' | 'boundDate'>[], range: { from: string; to: string }): string | null {
  const dates = quotes
    .filter((q) => q.status === 'bound' && q.boundDate && q.boundDate >= range.from && q.boundDate <= range.to)
    .map((q) => q.boundDate as string)
    .sort();
  return dates.at(-1) ?? null;
}
