import type { Account } from '../../types';

/** Filter values that aren't a broker. */
export const ALL_BROKERS = '__all__';
export const UNASSIGNED = '__unassigned__';
/** Today's Plate's earlier "Only accounts assigned to me": the account's assignee only, not accounts you help on. */
export const ASSIGNED_TO_ME = '__assigned_to_me__';

/**
 * Whether an account belongs under a broker filter — the same rule on Accounts and Today's Plate.
 *
 * In an agency (byAgent) a broker is an agency member's user id, and their accounts are the ones
 * assigned to them plus the ones they collaborate on. Outside an agency the lightweight assignment
 * has no directory, so a broker is the assigned name, compared case-insensitively.
 */
export function matchesBroker(
  account: Pick<Account, 'assignedUserId' | 'collaboratorIds' | 'assignedBroker'>,
  filter: string,
  ctx: { byAgent: boolean; myUserId?: string | null }
): boolean {
  if (filter === ALL_BROKERS) return true;
  if (filter === ASSIGNED_TO_ME) return !!ctx.myUserId && account.assignedUserId === ctx.myUserId;
  if (ctx.byAgent) {
    if (filter === UNASSIGNED) return !account.assignedUserId;
    return account.assignedUserId === filter || (account.collaboratorIds ?? []).includes(filter);
  }
  if (filter === UNASSIGNED) return !account.assignedBroker?.name;
  return account.assignedBroker?.name?.trim().toLowerCase() === filter;
}
