import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { reloadOtherReferrals, useOtherReferrals } from '../../hooks/useOtherReferrals';
import { setOtherReferral } from '../../services/supabase/partnersRepo';
import { ReferralPicker } from '../referrals/ReferralPicker';

/** "Referral: Safety ▾" in the account header — where the client came from (0081); "Not set" on older accounts; "Other" with a name and amount for this client (0083). */
export function ReferralSourceSelect({ account }: { account: Account }) {
  const setReferral = useAccountsStore((s) => s.setAccountReferral);
  const other = useOtherReferrals()[account.id] ?? null;
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="account-referral">
      <span>Referral:</span>
      <ReferralPicker
        value={account.referralSource ?? ''}
        other={other}
        onChange={(v, label) => setReferral(account.id, v, label)}
        saveOther={async (o) => {
          const r = await setOtherReferral(account.id, o);
          if (r.ok) await reloadOtherReferrals();
          return r.ok ? { ok: true } : { ok: false, message: r.message };
        }}
        placeholder={account.referralSource ? undefined : 'Not set'}
        className="cursor-pointer rounded-md border border-transparent bg-transparent py-0.5 pl-1 pr-6 text-sm font-medium text-[var(--color-ink-800)] hover:border-[var(--color-ink-200)]"
        inputClassName="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)]"
        ariaLabel="Referral source"
      />
    </span>
  );
}
