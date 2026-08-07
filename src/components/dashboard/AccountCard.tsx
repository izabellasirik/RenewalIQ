import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Clock, Copy, History, Pencil, Trash2, X, ArchiveRestore, Archive as ArchiveIcon } from 'lucide-react';
import type { Account } from '../../types';
import { Card, CardBody, Badge, OverflowMenu, type OverflowMenuItem } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, deriveSubmissionStatusLabel } from '../layout/WorkflowSteps';
import { formatDate } from '../../utils/dates';
import { EMPTY_DOCUMENTS, EMPTY_MATCH_RESULTS } from '../../utils/emptyArrays';

export function AccountCard({ account, index, onOpenHistory }: { account: Account; index: number; onOpenHistory: () => void }) {
  const navigate = useNavigate();
  const documents = useAccountsStore((s) => s.documents[account.id]) ?? EMPTY_DOCUMENTS;
  const matchResults = useAccountsStore((s) => s.matchResults[account.id]) ?? EMPTY_MATCH_RESULTS;
  const renameAccount = useAccountsStore((s) => s.renameAccount);
  const duplicateAccount = useAccountsStore((s) => s.duplicateAccount);
  const archiveAccount = useAccountsStore((s) => s.archiveAccount);
  const restoreAccount = useAccountsStore((s) => s.restoreAccount);
  const deleteAccountPermanently = useAccountsStore((s) => s.deleteAccountPermanently);

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(account.namedInsured);

  const steps = useWorkflowStatus(account.id);
  const status = deriveSubmissionStatusLabel(steps);
  const strongMatches = matchResults.filter((m) => m.verdict === 'strong_match').length;

  function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed) renameAccount(account.id, trimmed);
    setIsRenaming(false);
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
            if (window.confirm(`Permanently delete "${account.namedInsured}"? This cannot be undone.`)) {
              deleteAccountPermanently(account.id);
            }
          },
        },
      ]
    : [
        { key: 'rename', label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setIsRenaming(true) },
        { key: 'duplicate', label: 'Duplicate for renewal', icon: <Copy size={14} />, onSelect: () => duplicateAccount(account.id) },
        { key: 'history', label: 'View history', icon: <History size={14} />, onSelect: onOpenHistory },
        { key: 'archive', label: 'Archive', icon: <ArchiveIcon size={14} />, onSelect: () => archiveAccount(account.id) },
      ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.25 }}>
      <Card
        className="group relative cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]"
        onClick={() => !isRenaming && navigate(`/accounts/${account.id}/risk-profile`)}
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
                <p className="truncate font-semibold text-[var(--color-ink-900)]">{account.namedInsured}</p>
              )}
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{account.state} · Commercial Auto</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge tone={status.tone}>{status.label}</Badge>
              <OverflowMenu items={menuItems} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4 text-xs text-[var(--color-ink-500)]">
            <span>{documents.length} document{documents.length === 1 ? '' : 's'}</span>
            {matchResults.length > 0 && (
              <span>
                {strongMatches} strong match{strongMatches === 1 ? '' : 'es'}
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--color-ink-100)] pt-3 text-xs">
            <span className="flex items-center gap-1 text-[var(--color-ink-400)]">
              <Clock size={11} />
              Updated {formatDate(account.updatedAt)}
            </span>
            <span className="flex items-center gap-1 font-medium text-[var(--color-brand-700)] opacity-0 transition-opacity group-hover:opacity-100">
              Open <ArrowRight size={13} />
            </span>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
