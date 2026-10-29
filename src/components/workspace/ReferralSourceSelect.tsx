import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { referralLabel, useReferralSources } from '../../hooks/useReferralSources';
import { NO_REFERRAL } from '../../services/supabase/partnersRepo';

/** "Referral: Safety ▾" in the account header — where the client came from (0081); "Not set" on older accounts. */
export function ReferralSourceSelect({ account }: { account: Account }) {
  const setReferral = useAccountsStore((s) => s.setAccountReferral);
  const sources = useReferralSources();
  const shown = sources.filter((s) => s.active || s.id === account.referralSource);
  return (
    <label className="inline-flex items-center gap-1.5" data-testid="account-referral">
      <span>Referral:</span>
      <select
        value={account.referralSource ?? ''}
        onChange={(e) => e.target.value && setReferral(account.id, e.target.value, referralLabel(e.target.value, sources))}
        className="cursor-pointer rounded-md border border-transparent bg-transparent py-0.5 pl-1 pr-6 text-sm font-medium text-[var(--color-ink-800)] hover:border-[var(--color-ink-200)]"
        aria-label="Referral source"
      >
        {!account.referralSource && <option value="">Not set</option>}
        <option value={NO_REFERRAL}>No referral</option>
        {shown.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
