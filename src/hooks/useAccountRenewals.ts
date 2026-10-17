import { useMemo } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { useAccountWorkflow } from './useAccountWorkflow';
import { canManageRenewals, resolveRenewals, type RenewalViewer } from '../services/workflow/renewals';

/** Who's looking, for renewal permissions (assigned broker / admin) and reminders. */
export function useRenewalViewer(): RenewalViewer {
  const role = useAccountsStore((s) => s.agencyAccess?.role ?? null);
  const userId = useAccountsStore((s) => s.currentUserId);
  return useMemo(() => ({ role: role === 'admin' || role === 'agent' ? role : null, userId }), [role, userId]);
}

/** An account's renewals, resolved (see renewals.ts), and whether this user can change them. */
export function useAccountRenewals(accountId: string) {
  const { account, quotes, effectiveDate } = useAccountWorkflow(accountId);
  const ownerId = useAccountsStore((s) => s.accountOwners[accountId] ?? null);
  const viewer = useRenewalViewer();
  const renewals = useMemo(() => (account ? resolveRenewals(account, effectiveDate, quotes) : []), [account, effectiveDate, quotes]);
  const canManage = !!account && canManageRenewals(account, { ...viewer, ownerId });
  return { account, quotes, effectiveDate, renewals, canManage };
}

/**
 * The account tracks renewals and this user isn't its assigned broker or an admin: its renewal date
 * (the Renewal / effective date) is theirs to set, not this user's — the database keeps it as it is
 * either way (0054), so it's shown read-only here.
 */
export function useRenewalDatesLocked(accountId: string): boolean {
  const { account, canManage } = useAccountRenewals(accountId);
  return !!account && (account.businessType !== undefined || (account.renewals?.length ?? 0) > 0) && !canManage;
}
