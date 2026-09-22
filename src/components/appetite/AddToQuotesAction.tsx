import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import type { AppetiteRecord } from '../../types';
import { Button } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { EMPTY_QUOTES } from '../../utils/emptyArrays';

/**
 * The one bridge from market research to the account workflow: turns an appetite record into a
 * Markets & Quotes entry ("preparing") on an account. With `accountId` (Carrier Appetite) it targets
 * that account; without (Market Finder) the broker picks one.
 */
export function AddToQuotesAction({ record, accountId: fixedAccountId }: { record: AppetiteRecord; accountId?: string }) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const addQuote = useAccountsStore((s) => s.addQuote);
  const openAccounts = accounts.filter((a) => !a.archived);
  const [picked, setPicked] = useState(() => fixedAccountId ?? (openAccounts.some((a) => a.id === activeAccountId) ? activeAccountId! : (openAccounts[0]?.id ?? '')));
  const accountId = fixedAccountId ?? picked;
  const quotes = useAccountsStore((s) => (accountId ? s.quotes[accountId] : undefined)) ?? EMPTY_QUOTES;
  const existing = quotes.find((q) => q.appetiteRecordId === record.id || q.marketName.toLowerCase() === record.marketName.toLowerCase());

  if (!fixedAccountId && openAccounts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] p-3">
      <p className="text-xs font-medium text-[var(--color-ink-600)]">Add to an account's Markets & Quotes</p>
      <div className="flex flex-wrap items-center gap-2">
        {!fixedAccountId && (
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-ink-200)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
            aria-label="Account"
          >
            {openAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.namedInsured}
              </option>
            ))}
          </select>
        )}
        {existing ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-success-600)]">
            <Check size={14} /> In Markets & Quotes
            <Link to={`/accounts/${accountId}?tab=quotes&quote=${existing.id}`} className="font-medium text-[var(--color-brand-700)] hover:underline">
              View
            </Link>
          </span>
        ) : (
          <Button size="sm" icon={<Plus size={14} />} disabled={!accountId} onClick={() => addQuote(accountId, { marketName: record.marketName, appetiteRecordId: record.id })}>
            Add to Quotes
          </Button>
        )}
      </div>
    </div>
  );
}
