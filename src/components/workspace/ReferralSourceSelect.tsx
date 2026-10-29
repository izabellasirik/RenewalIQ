import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useReferralSources } from '../../hooks/useReferralSources';
import { ReferralPicker } from '../referrals/ReferralPicker';

/** "Referral: Safety ▾" in the account header — where the client came from (0081); "Not set" on older accounts; "Other" to add a new partner (0083). */
export function ReferralSourceSelect({ account }: { account: Account }) {
  const setReferral = useAccountsStore((s) => s.setAccountReferral);
  const pending = useReferralSources().find((s) => s.id === account.referralSource)?.status === 'pending';
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="account-referral">
      <span>Referral:</span>
      <ReferralPicker
        value={account.referralSource ?? ''}
        onChange={(v, label) => setReferral(account.id, v, label)}
        accountId={account.id}
        placeholder={account.referralSource ? undefined : 'Not set'}
        className="cursor-pointer rounded-md border border-transparent bg-transparent py-0.5 pl-1 pr-6 text-sm font-medium text-[var(--color-ink-800)] hover:border-[var(--color-ink-200)]"
        inputClassName="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)]"
        ariaLabel="Referral source"
      />
      {pending && <span className="text-xs font-medium text-[var(--color-warning-600)]">Awaiting approval</span>}
    </span>
  );
}
