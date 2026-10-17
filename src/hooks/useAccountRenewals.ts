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
