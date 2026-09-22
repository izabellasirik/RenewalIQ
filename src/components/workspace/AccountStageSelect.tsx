import type { AccountStage } from '../../types';
import { ACCOUNT_STAGE_LABELS, ACCOUNT_STAGE_ORDER } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { deriveAccountStage } from '../../services/workflow/accountStage';
import { cn } from '../../utils/cn';

const AUTO = '__auto__';

/**
 * The account's pipeline status. "Automatic" follows the checklist and quotes; picking a status
 * pins it until the broker switches back to automatic.
 */
export function AccountStageSelect({ accountId, className }: { accountId: string; className?: string }) {
  const { account, items, quotes } = useAccountWorkflow(accountId);
  const setAccountStage = useAccountsStore((s) => s.setAccountStage);
  if (!account) return null;
  const derived = deriveAccountStage(items, quotes);

  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-[var(--color-ink-600)]', className)}>
      <span className="font-medium">Status</span>
      <select
        value={account.stage ?? AUTO}
        onChange={(e) => setAccountStage(accountId, e.target.value === AUTO ? null : (e.target.value as AccountStage))}
        className="cursor-pointer rounded-lg border border-[var(--color-ink-200)] bg-white px-2.5 py-1.5 text-sm font-medium text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
        aria-label="Client status"
      >
        <option value={AUTO}>Automatic — {ACCOUNT_STAGE_LABELS[derived]}</option>
        {ACCOUNT_STAGE_ORDER.map((s) => (
          <option key={s} value={s}>
            {ACCOUNT_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
