import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { useCancelledPolicies } from '../../hooks/usePolicyCancellations';
import { accountBoundDate, effectiveAccountStage } from '../../services/workflow/accountStage';
import { nextOpenRenewal, renewalLabelOn, resolveRenewals } from '../../services/workflow/renewals';
import { formatShortDate, toLocalDateKey, todayKey } from '../../services/workflow/dates';
import { agentLabel } from '../../services/agency/agentLabel';
import { StageBadge } from '../workspace/StageBadge';
import { RenewalBadge } from '../renewals/RenewalLabel';
import { referralLabel, useReferralSources } from '../../hooks/useReferralSources';
import { useOtherReferrals } from '../../hooks/useOtherReferrals';
import { useNoteSummaries } from '../../hooks/useNoteSummaries';
import { buildNotesText, notesHash } from '../../services/notes/notesSummary';

const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2.5 align-middle text-sm text-[var(--color-ink-800)] whitespace-nowrap';
// The client's name stays in view while the table scrolls sideways.
const sticky = 'sticky left-0 z-[1] bg-white group-hover:bg-[var(--color-ink-50)] shadow-[1px_0_0_var(--color-ink-100)]';
const muted = <span className="text-[var(--color-ink-400)]">—</span>;

/** Accounts as a table (the "Table" view): one row per account, the same accounts and order as the cards. Scrolls sideways for the rest. */
export function AccountsTable({ accounts, archivedAt }: { accounts: Account[]; archivedAt: Record<string, string> }) {
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const archived = accounts.some((a) => a.archived);
  // Every row is one line; a row opens to show its notes in full.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allOpen = accounts.length > 0 && accounts.every((a) => open.has(a.id));
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-2">
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => setOpen(allOpen ? new Set() : new Set(accounts.map((a) => a.id)))}
        className="cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline"
        data-testid="accounts-table-toggle-all"
      >
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
    </div>
    <div className="overflow-x-auto rounded-xl border border-[var(--color-ink-100)] bg-white [box-shadow:var(--shadow-card)]">
      <table className="min-w-full border-collapse" data-testid="accounts-table">
        <thead>
          <tr>
            {['Client', ...(isAgencyAdmin ? ['Agent'] : []), 'Status', 'Referral', 'Renewal', 'DOT #', 'State', 'Markets', 'Bound', 'Missing docs', 'Next follow-up', 'Notes summary', 'Latest note', 'Collaborators', 'Created', 'Updated', ...(archived ? ['Archived'] : [])].map((h, i) => (
              <th key={h} className={`${th} whitespace-nowrap ${i === 0 ? `sticky left-0 z-[1] bg-white shadow-[1px_0_0_var(--color-ink-100)]` : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} showAgent={isAgencyAdmin} archivedAt={archived ? (archivedAt[a.id] ?? '') : undefined} expanded={open.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

function AccountRow({ account, showAgent, archivedAt, expanded, onToggle }: { account: Account; showAgent: boolean; archivedAt?: string; expanded: boolean; onToggle: () => void }) {
  const navigate = useNavigate();
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const { items, quotes, followUps, effectiveDate, dotNumber } = useAccountWorkflow(account.id);
  const { byAccount } = useNoteSummaries();
  const cancelledFor = useCancelledPolicies();
  const { stage } = effectiveAccountStage(account, items, quotes, cancelledFor(account.id));
  const renewalLabel = renewalLabelOn(account, effectiveDate, quotes, todayKey()).on;
  const renewal = nextOpenRenewal(resolveRenewals(account, effectiveDate, quotes))?.renewalDate ?? effectiveDate;
  const sources = useReferralSources();
  const others = useOtherReferrals();
  const boundOn = accountBoundDate(account, stage, quotes);
  const missingDocuments = items.filter((i) => i.type === 'document' && (i.status === 'missing' || i.status === 'requested')).length;
  // The earliest follow-up still open: scheduled follow-ups, client requests, and markets.
  const nextFollowUp =
    [
      ...followUps.filter((f) => !f.doneAt).map((f) => f.dueDate),
      ...items.filter((i) => i.status === 'requested' && i.followUpDate).map((i) => i.followUpDate!),
      ...quotes.filter((q) => q.followUpDate && q.status !== 'declined' && q.status !== 'bound').map((q) => q.followUpDate!),
    ].sort()[0] ?? null;
  const markets = quotes.length ? `${quotes.length}${quotes.some((q) => q.status === 'bound') ? ` (${quotes.filter((q) => q.status === 'bound').length} bound)` : ''}` : null;
  const notes = [...(account.notes ?? []).map((n) => ({ at: n.createdAt, text: n.text })), ...quotes.flatMap((q) => q.notes.map((n) => ({ at: n.createdAt, text: `${q.marketName}: ${n.text}` })))];
  const latest = notes.sort((a, b) => b.at.localeCompare(a.at))[0];
  const summary = byAccount[account.id];
  const stale = !!summary && summary.notesHash !== notesHash(buildNotesText(account.notes, quotes));
  const collaborators = (account.collaboratorIds ?? []).map((id) => (id === currentUserId ? 'You' : (agencyMembers.find((m) => m.userId === id)?.name ?? 'Team member')));
  const day = (iso: string) => formatShortDate(toLocalDateKey(new Date(iso)));
  const open = () => navigate(`/accounts/${account.id}`);
  return (
    <tr className="group cursor-pointer hover:bg-[var(--color-ink-50)]" onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} tabIndex={0} data-testid="accounts-table-row">
      <td className={`${td} ${sticky} ${expanded ? 'align-top' : ''} font-semibold text-[var(--color-brand-800)]`}>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="-ml-1 cursor-pointer rounded p-0.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)]"
            aria-label={expanded ? `Collapse ${account.namedInsured}` : `Expand ${account.namedInsured}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {account.namedInsured}
        </span>
      </td>
      {showAgent && <td className={td}>{agentLabel(account, agencyMembers, currentUserId) ?? 'Unassigned'}</td>}
      <td className={td}>
        <span className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={stage} />
          {renewalLabel && <RenewalBadge />}
        </span>
      </td>
      <td className={td}>{account.referralSource ? referralLabel(account.referralSource, sources, others[account.id]) : <span className="text-[var(--color-ink-400)]">Not set</span>}</td>
      <td className={`${td} tabular-nums`}>{renewal ? formatShortDate(renewal) : '—'}</td>
      <td className={`${td} tabular-nums`}>{dotNumber || '—'}</td>
      <td className={td}>{account.state || muted}</td>
      <td className={`${td} tabular-nums`}>{markets ?? muted}</td>
      <td className={`${td} tabular-nums`}>{boundOn ? formatShortDate(boundOn) : muted}</td>
      <td className={`${td} tabular-nums`}>{missingDocuments || muted}</td>
      <td className={`${td} tabular-nums ${nextFollowUp && nextFollowUp < todayKey() ? 'text-[var(--color-danger-600)]' : ''}`}>{nextFollowUp ? formatShortDate(nextFollowUp) : muted}</td>
      <td className={`${td} ${expanded ? '!whitespace-normal align-top' : ''}`} data-testid="table-notes-summary">
        {summary ? (
          <span className="block w-80">
            <span className={`${expanded ? '' : 'block truncate'} ${stale ? 'text-[var(--color-ink-500)]' : ''}`} title={summary.summary}>
              {stale && <span className="mr-1 text-xs font-medium text-[var(--color-warning-600)]">Notes updated ·</span>}
              {summary.summary}
            </span>
          </span>
        ) : (
          muted
        )}
      </td>
      <td className={`${td} ${expanded ? '!whitespace-normal align-top' : ''}`}>
        {latest ? (
          <span className="block w-72">
            <span className={expanded ? '' : 'block truncate'} title={latest.text}>
              <span className="mr-1 text-xs text-[var(--color-ink-400)]">{day(latest.at)}</span>
              {latest.text}
            </span>
          </span>
        ) : (
          muted
        )}
      </td>
      <td className={td}>{collaborators.length ? collaborators.join(', ') : muted}</td>
      <td className={`${td} tabular-nums`}>{day(account.createdAt)}</td>
      <td className={`${td} tabular-nums`}>{day(account.updatedAt)}</td>
      {archivedAt !== undefined && <td className={`${td} tabular-nums`}>{archivedAt ? formatShortDate(toLocalDateKey(new Date(archivedAt))) : '—'}</td>}
    </tr>
  );
}
