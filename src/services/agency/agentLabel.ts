import type { Account } from '../../types';
import type { AgencyMember } from '../supabase/submissionsRepo';

/**
 * Who an account is assigned to, for display. In an agency the database's assigned agent (a user
 * id) is the truth; the free-text "assigned broker" label is only a fallback for accounts outside an
 * agency (local-only, or before 0011 / agency setup).
 */
export function agentLabel(account: Account, members: AgencyMember[], currentUserId: string | null): string | null {
  if (account.assignedUserId) {
    if (account.assignedUserId === currentUserId) {
      const me = members.find((m) => m.userId === currentUserId);
      return me ? `${me.name} (you)` : 'You';
    }
    return members.find((m) => m.userId === account.assignedUserId)?.name ?? account.assignedBroker?.name ?? 'Another agent';
  }
  if (account.agencyId) return null; // in an agency with nobody assigned
  return account.assignedBroker?.name ?? null;
}
