import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Copy, History, Pencil, Trash2, X, ArchiveRestore, Archive as ArchiveIcon } from 'lucide-react';
import type { Account } from '../../types';
import { Card, CardBody, Badge, OverflowMenu, ConfirmDialog, type OverflowMenuItem } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, deriveSubmissionStatusLabel } from '../layout/WorkflowSteps';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { cn } from '../../utils/cn';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { effectiveAccountStage } from '../../services/workflow/accountStage';
import { StageBadge } from '../workspace/StageBadge';
import { agentLabel } from '../../services/agency/agentLabel';

export function AccountCard({ account, index, onOpenHistory }: { account: Account; index: number; onOpenHistory: () => void }) {
  const navigate = useNavigate();
  const renameAccount = useAccountsStore((s) => s.renameAccount);
  const duplicateAccount = useAccountsStore((s) => s.duplicateAccount);
  const archiveAccount = useAccountsStore((s) => s.archiveAccount);
  const restoreAccount = useAccountsStore((s) => s.restoreAccount);
  const deleteAccountPermanently = useAccountsStore((s) => s.deleteAccountPermanently);
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(account.namedInsured);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const steps = useWorkflowStatus(account.id);
  const status = deriveSubmissionStatusLabel(steps);
  const { items, quotes, followUps, effectiveDate, dotNumber, actions } = useAccountWorkflow(account.id);
  // Only something genuinely overdue earns the red flag — otherwise the card stays calm.
  const needsAttention = actions.now.some((a) => a.overdue);
  const { stage, manual } = effectiveAccountStage(account, items, quotes);
  // Checklist documents not in yet (missing or requested from the client).
  const missingDocuments = items.filter((i) => i.type === 'document' && (i.status === 'missing' || i.status === 'requested')).length;
  // The earliest follow-up still open: scheduled follow-ups, client requests, and markets.
  const nextFollowUp =
    [
      ...followUps.filter((f) => !f.doneAt).map((f) => f.dueDate),
      ...items.filter((i) => i.status === 'requested' && i.followUpDate).map((i) => i.followUpDate!),
      ...quotes.filter((q) => q.followUpDate && q.status !== 'declined' && q.status !== 'bound').map((q) => q.followUpDate!),
    ].sort()[0] ?? null;

  function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed) renameAccount(account.id, trimmed);
    setIsRenaming(false);
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAccountPermanently(account.id);
      if (!result.ok) {
        setDeleting(false);
        setDeleteError(result.message ?? "Something went wrong deleting this submission. It hasn't been removed — try again.");
        return;
      }
      setDeleteConfirmOpen(false);
      setDeleting(false);
    } catch {
      setDeleting(false);
      setDeleteError("Something went wrong deleting this submission. It hasn't been removed — try again.");
    }
  }

  const menuItems: OverflowMenuItem[] = account.archived
    ? [
        { key: 'restore', label: 'Restore', icon: <ArchiveRestore size={14} />, onSelect: () => restoreAccount(account.id) },
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
    : [
        { key: 'rename', label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setIsRenaming(true) },
        { key: 'duplicate', label: 'Duplicate for renewal', icon: <Copy size={14} />, onSelect: () => duplicateAccount(account.id) },
        { key: 'history', label: 'View history', icon: <History size={14} />, onSelect: onOpenHistory },
        { key: 'archive', label: 'Archive', icon: <ArchiveIcon size={14} />, onSelect: () => archiveAccount(account.id) },
        {
          key: 'delete',
          label: 'Delete submission',
          icon: <Trash2 size={14} />,
          tone: 'danger',
          onSelect: () => {
            setDeleteError(null);
            setDeleteConfirmOpen(true);
          },
        },
      ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.25 }}>
      <Card
        className="group relative cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]"
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
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <OverflowMenu items={menuItems} />
              <ChevronRight size={18} className="text-[var(--color-ink-400)] transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StageBadge stage={stage} title={manual ? 'Status set by broker' : 'Automatic status — set it on the account to override'} />
            {status.label === 'Extracting Documents' && <Badge tone="warning">Extracting…</Badge>}
            {needsAttention && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-danger-600)]" title="Something on this account is overdue">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger-500)]" />
                Action required
              </span>
            )}
          </div>
          <p className="mt-2 truncate text-sm text-[var(--color-ink-500)]">
            {account.state || '—'} · DOT {dotNumber || '—'} · Commercial Auto
          </p>

          <dl className="mt-3 flex flex-col gap-1 border-t border-[var(--color-ink-100)] pt-3 text-sm">
            <div className="flex gap-1">
              <dt className="text-[var(--color-ink-500)]">Renewal:</dt>
              <dd className="font-semibold text-[var(--color-ink-900)]">{effectiveDate ? formatShortDate(effectiveDate) : '—'}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-[var(--color-ink-500)]">Missing documents:</dt>
              <dd className="font-semibold text-[var(--color-ink-900)]">{missingDocuments > 0 ? missingDocuments : '—'}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-[var(--color-ink-500)]">Next follow-up:</dt>
              <dd className={cn('font-semibold', nextFollowUp && nextFollowUp < todayKey() ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-900)]')}>
                {nextFollowUp ? formatShortDate(nextFollowUp) : '—'}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={deleteConfirmOpen}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          title="Delete this submission?"
          description={`This will permanently remove ${account.namedInsured} and its associated submission data. This action cannot be undone.`}
          confirmLabel="Delete submission"
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
