import { useNavigate } from 'react-router-dom';
import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { useCancelledPolicies } from '../../hooks/usePolicyCancellations';
import { effectiveAccountStage } from '../../services/workflow/accountStage';
import { nextOpenRenewal, renewalLabelOn, resolveRenewals } from '../../services/workflow/renewals';
import { formatShortDate, toLocalDateKey, todayKey } from '../../services/workflow/dates';
import { agentLabel } from '../../services/agency/agentLabel';
import { StageBadge } from '../workspace/StageBadge';
import { RenewalBadge } from '../renewals/RenewalLabel';

const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2.5 align-middle text-sm text-[var(--color-ink-800)]';

/** Accounts as a table (the "Table" view): one row per account, the same accounts and order as the cards. */
export function AccountsTable({ accounts, archivedAt }: { accounts: Account[]; archivedAt: Record<string, string> }) {
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const archived = accounts.some((a) => a.archived);
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-ink-100)] bg-white [box-shadow:var(--shadow-card)]">
      <table className="min-w-full border-collapse" data-testid="accounts-table">
        <thead>
          <tr>
            {['Client', ...(isAgencyAdmin ? ['Agent'] : []), 'Status', 'Renewal', 'DOT #', ...(archived ? ['Archived'] : [])].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} showAgent={isAgencyAdmin} archivedAt={archived ? (archivedAt[a.id] ?? '') : undefined} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({ account, showAgent, archivedAt }: { account: Account; showAgent: boolean; archivedAt?: string }) {
  const navigate = useNavigate();
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const { items, quotes, effectiveDate, dotNumber } = useAccountWorkflow(account.id);
  const cancelledFor = useCancelledPolicies();
  const { stage } = effectiveAccountStage(account, items, quotes, cancelledFor(account.id));
  const renewalLabel = renewalLabelOn(account, effectiveDate, quotes, todayKey()).on;
  const renewal = nextOpenRenewal(resolveRenewals(account, effectiveDate, quotes))?.renewalDate ?? effectiveDate;
  const open = () => navigate(`/accounts/${account.id}`);
  return (
    <tr className="cursor-pointer hover:bg-[var(--color-ink-50)]" onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} tabIndex={0} data-testid="accounts-table-row">
      <td className={`${td} font-semibold text-[var(--color-brand-800)]`}>{account.namedInsured}</td>
      {showAgent && <td className={td}>{agentLabel(account, agencyMembers, currentUserId) ?? 'Unassigned'}</td>}
      <td className={td}>
        <span className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={stage} />
          {renewalLabel && <RenewalBadge />}
        </span>
      </td>
      <td className={`${td} tabular-nums`}>{renewal ? formatShortDate(renewal) : '—'}</td>
      <td className={`${td} tabular-nums`}>{dotNumber || '—'}</td>
      {archivedAt !== undefined && <td className={`${td} tabular-nums`}>{archivedAt ? formatShortDate(toLocalDateKey(new Date(archivedAt))) : '—'}</td>}
    </tr>
  );
}
