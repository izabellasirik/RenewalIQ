import { CheckCircle2, Clock, PackageCheck } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { formatShortDate } from '../../services/workflow/dates';
import { DocumentPreviewLink } from './DocumentPreviewLink';
import { DateInput } from './DateInput';
import { smallInputClass } from './formStyles';

/**
 * The details behind one grouped client follow-up (several items asked of the same person in one
 * email): what's still outstanding, what's already in, and one follow-up date for the lot.
 */
export function RequestGroupDialog({ accountId, itemIds, open, onClose }: { accountId: string; itemIds: string[]; open: boolean; onClose: () => void }) {
  const { account, items, contacts, documents } = useAccountWorkflow(accountId);
  const markItemReceived = useAccountsStore((s) => s.markItemReceived);
  const setItemsFollowUp = useAccountsStore((s) => s.setItemsFollowUp);
  const group = items.filter((i) => itemIds.includes(i.id));
  if (!account || group.length === 0) return null;

  const outstanding = group.filter((i) => i.status !== 'received' && i.status !== 'waived');
  const who = contacts.find((c) => c.id === group[0].requestedFromContactId)?.name;
  const requestedAt = group.map((i) => i.requestedAt).filter(Boolean).sort()[0];
  const followUp = outstanding[0]?.followUpDate ?? group[0].followUpDate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${group.length} documents requested${who ? ` from ${who}` : ''}`}
      subtitle={`${account.namedInsured}${requestedAt ? ` · Requested ${formatShortDate(requestedAt)}` : ''}`}
      footer={
        <>
          {outstanding.length > 1 && (
            <Button variant="secondary" size="sm" icon={<PackageCheck size={14} />} onClick={() => outstanding.forEach((i) => markItemReceived(accountId, i.id))}>
              Mark all {outstanding.length} received
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-700)]">
          Follow up on
          <DateInput value={followUp} onCommit={(v) => v && setItemsFollowUp(accountId, outstanding.map((i) => i.id), v)} className={smallInputClass} aria-label="Follow-up date for this request" />
          <span className="text-xs text-[var(--color-ink-400)]">applies to everything still outstanding</span>
        </label>
        <p className="text-xs font-medium text-[var(--color-ink-500)]">
          {group.length - outstanding.length} of {group.length} received
        </p>
        <ul className="flex flex-col gap-1.5">
          {group.map((i) => {
            const received = i.status === 'received';
            const doc = documents.find((d) => d.id === i.documentId);
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
                <div className="flex min-w-0 items-start gap-2">
                  {received ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-success-500)]" /> : <Clock size={15} className="mt-0.5 shrink-0 text-[var(--color-warning-500)]" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink-800)]">{i.label}</p>
                    <p className="text-xs text-[var(--color-ink-500)]">{received ? `Received ${i.receivedAt ? formatShortDate(i.receivedAt) : ''}` : i.status === 'waived' ? 'Waived' : 'Waiting on client'}</p>
                    {doc && <DocumentPreviewLink doc={doc} />}
                  </div>
                </div>
                {!received && i.status !== 'waived' && (
                  <Button size="sm" variant="secondary" icon={<PackageCheck size={13} />} onClick={() => markItemReceived(accountId, i.id)}>
                    Received
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
