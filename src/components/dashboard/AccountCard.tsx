import { useState } from 'react';
import { useCancelledPolicies } from '../../hooks/usePolicyCancellations';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Users, Copy, History, Pencil, Trash2, X, ArchiveRestore, Archive as ArchiveIcon } from 'lucide-react';
import type { Account } from '../../types';
import { Card, CardBody, Badge, OverflowMenu, ConfirmDialog, type OverflowMenuItem } from '../ui';
import { selectCanManageArchive, useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, deriveSubmissionStatusLabel } from '../layout/WorkflowSteps';
import { formatShortDate, toLocalDateKey, todayKey } from '../../services/workflow/dates';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { accountBoundDate, effectiveAccountStage } from '../../services/workflow/accountStage';
import { nextOpenRenewal, renewalLabelOn, resolveRenewals } from '../../services/workflow/renewals';
import { StageBadge } from '../workspace/StageBadge';
import { RenewalBadge } from '../renewals/RenewalLabel';
import { agentLabel } from '../../services/agency/agentLabel';
import { NotesSummary } from './NotesSummary';

/** `archivedAt`: in the archived view, when it was archived (shown on the card). */
export function AccountCard({ account, index, onOpenHistory, archivedAt }: { account: Account; index: number; onOpenHistory: () => void; archivedAt?: string }) {
  const navigate = useNavigate();
  const renameAccount = useAccountsStore((s) => s.renameAccount);
  const duplicateAccount = useAccountsStore((s) => s.duplicateAccount);
  const archiveAccount = useAccountsStore((s) => s.archiveAccount);
  const restoreAccount = useAccountsStore((s) => s.restoreAccount);
  const deleteAccountPermanently = useAccountsStore((s) => s.deleteAccountPermanently);
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const canManageArchive = useAccountsStore(selectCanManageArchive);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  // Team members helping on the account (0026), shown to everyone who can see the card.
  const collaborators = (account.collaboratorIds ?? []).map((id) => (id === currentUserId ? 'You' : (agencyMembers.find((m) => m.userId === id)?.name ?? 'Team member')));

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(account.namedInsured);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const steps = useWorkflowStatus(account.id);
  const status = deriveSubmissionStatusLabel(steps);
  const { items, quotes, effectiveDate, dotNumber, actions } = useAccountWorkflow(account.id);
  // Red only for what needs working now: a renewal within 7 days (as on Today's Plate). Other overdue
  // tasks are on Today's Plate without turning every card red.
  const needsAttention = actions.now.some((a) => a.urgent);
  const cancelledFor = useCancelledPolicies();
  const { stage, manual } = effectiveAccountStage(account, items, quotes, cancelledFor(account.id));
  const renewalLabel = renewalLabelOn(account, effectiveDate, quotes, todayKey()).on;
  const boundOn = accountBoundDate(account, stage, quotes);
  // The soonest open renewal (another policy's may come before the account's own); else the effective date.
  const shownDate = nextOpenRenewal(resolveRenewals(account, effectiveDate, quotes))?.renewalDate ?? effectiveDate;
  const newVenture = account.businessType === 'new_venture' && !account.renewals?.length;

  function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed) renameAccount(account.id, trimmed);
    setIsRenaming(false);
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAccountPermanently(account.id, { archiveFirst: !account.archived });
      if (!result.ok) {
        setDeleting(false);
        setDeleteError(result.message ?? "Something went wrong deleting this account. It hasn't been removed — try again.");
        return;
      }
      setDeleteConfirmOpen(false);
      setDeleting(false);
    } catch {
      setDeleting(false);
      setDeleteError("Something went wrong deleting this account. It hasn't been removed — try again.");
    }
  }

  // Archived: only an admin (or a broker outside any agency) can restore or delete — an agent's
  // archived account has no actions; the database enforces the same rule.
  const menuItems: OverflowMenuItem[] = account.archived
    ? canManageArchive
      ? [
          { key: 'restore', label: 'Restore account', icon: <ArchiveRestore size={14} />, onSelect: () => restoreAccount(account.id) },
          {
            key: 'delete',
            label: 'Delete permanently',
            icon: <Trash2 size={14} />,
            tone: 'danger',
            onSelect: () => {
              setDeleteError(null);
              setDeleteConfirmOpen(true);
            },
          },
        ]
      : []
    : [
        { key: 'rename', label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setIsRenaming(true) },
        { key: 'duplicate', label: 'Duplicate for renewal', icon: <Copy size={14} />, onSelect: () => duplicateAccount(account.id) },
        { key: 'history', label: 'View history', icon: <History size={14} />, onSelect: onOpenHistory },
        { key: 'archive', label: 'Archive account', icon: <ArchiveIcon size={14} />, onSelect: () => setArchiveConfirmOpen(true) },
        // Admins (and brokers outside an agency) can delete an active account outright.
        ...(canManageArchive
          ? [
              {
                key: 'delete',
                label: 'Delete permanently',
                icon: <Trash2 size={14} />,
                tone: 'danger' as const,
                onSelect: () => {
                  setDeleteError(null);
                  setDeleteConfirmOpen(true);
                },
              },
            ]
          : []),
      ];

  return (
    <motion.div className="h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.25 }}>
      <Card
        className="group relative h-full cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]"
        onClick={() => !isRenaming && navigate(`/accounts/${account.id}`)}
        role="link"
        tabIndex={0}
        aria-label={`Open ${account.namedInsured}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isRenaming && e.target === e.currentTarget) navigate(`/accounts/${account.id}`);
        }}
      >
        <CardBody className="pt-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                    className="w-full rounded-md border border-[var(--color-brand-500)] px-2 py-1 text-sm outline-none"
                  />
                  <button onClick={commitRename} className="shrink-0 rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
                    <Check size={13} />
                  </button>
                  <button onClick={() => setIsRenaming(false)} className="shrink-0 rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <p className="truncate text-lg font-semibold text-[var(--color-ink-900)]">{account.namedInsured}</p>
              )}
              {isAgencyAdmin && <p className="mt-0.5 truncate text-xs text-[var(--color-ink-500)]">Agent: {agentLabel(account, agencyMembers, currentUserId) ?? 'Unassigned'}</p>}
              {account.archived && archivedAt && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--color-ink-500)]" data-testid="card-archived-on">
                  <ArchiveIcon size={12} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
                  Archived {formatShortDate(toLocalDateKey(new Date(archivedAt)))}
                </p>
              )}
              {collaborators.length > 0 && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--color-ink-500)]" data-testid="card-collaborators">
                  <Users size={12} className="shrink-0 text-[var(--color-ink-400)]" />
                  <span className="truncate">Collaborators: {collaborators.join(', ')}</span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {menuItems.length > 0 && <OverflowMenu items={menuItems} />}
              <ChevronRight size={18} className="text-[var(--color-ink-400)] transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {renewalLabel && <RenewalBadge className="py-1.5" />}
            <StageBadge stage={stage} className="px-3 py-1.5 text-sm" title={manual ? 'Status set by an agent' : 'Automatic status — set it on the account to override'} />
            {boundOn && (
              <span className="text-xs font-medium text-[var(--color-ink-600)]" data-testid="card-bound-date">
                {formatShortDate(boundOn)}
              </span>
            )}
            {status.label === 'Extracting Documents' && <Badge tone="warning">Extracting…</Badge>}
            {needsAttention && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-danger-600)]" title="A renewal is within 7 days">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger-500)]" />
                Action required
              </span>
            )}
          </div>


          {/* Renewal and DOT on one line; below it, the notes summary. */}
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--color-ink-100)] pt-3 text-sm">
            <p className="text-[var(--color-ink-500)]">
              {newVenture ? 'Effective' : 'Renewal'}: <span className="font-semibold text-[var(--color-ink-900)]" data-testid="card-renewal">{shownDate ? formatShortDate(shownDate) : '—'}</span>
            </p>
            <p className="text-right text-[var(--color-ink-500)]">
              DOT # <span className="font-semibold text-[var(--color-ink-900)]">{dotNumber || '—'}</span>
            </p>
          </div>
          <NotesSummary account={account} quotes={quotes} />
        </CardBody>
      </Card>

      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={archiveConfirmOpen}
          onCancel={() => setArchiveConfirmOpen(false)}
          onConfirm={() => {
            archiveAccount(account.id);
            setArchiveConfirmOpen(false);
          }}
          title={`Archive ${account.namedInsured}?`}
          description={archiveConfirmText(canManageArchive)}
          confirmLabel="Archive account"
          variant="default"
        />
        <ConfirmDialog
          open={deleteConfirmOpen}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          title={`Permanently delete ${account.namedInsured}?`}
          description="This will permanently remove this account and its related data and cannot be undone."
          typeToConfirm={account.namedInsured}
          confirmLabel="Delete permanently"
          confirming={deleting}
        />
        {deleteError && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-4 py-2.5 text-sm text-[var(--color-danger-700)] shadow-lg">
            {deleteError}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** The archive confirmation's wording — agents are told who can bring it back. */
export function archiveConfirmText(canManageArchive: boolean): string {
  return canManageArchive
    ? 'It will be removed from active views. You can restore it from Archived.'
    : 'It will be removed from active views, but your agency admin can restore it.';
}
