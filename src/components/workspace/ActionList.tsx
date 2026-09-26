import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, Check, ListChecks, Mail, PackageCheck, Send } from 'lucide-react';
import type { ActionItem } from '../../services/workflow/nextActions';
import { ACTION_KIND_META, workspaceHref } from './actionMeta';
import { useAccountsStore } from '../../state/useAccountsStore';
import { Button } from '../ui';
import { RequestItemsDialog } from './RequestItemsDialog';
import { ReceiveItemDialog } from './ReceiveItemDialog';
import { RequestGroupDialog } from './RequestGroupDialog';
import { smallInputClass } from './formStyles';
import { DateInput } from './DateInput';
import { cn } from '../../utils/cn';

/**
 * Derived actions with one-click resolutions where the resolution is unambiguous (mark sent,
 * reschedule a follow-up, draft the client request). Every button changes account state — the
 * action disappears because the state changed, never because a task was "checked off".
 */
export function ActionList({ actions, showAccount = false, emptyText }: { actions: ActionItem[]; showAccount?: boolean; emptyText?: string }) {
  const [request, setRequest] = useState<{ accountId: string; itemId: string } | null>(null);
  const [receive, setReceive] = useState<{ accountId: string; itemId: string } | null>(null);
  const [group, setGroup] = useState<{ accountId: string; itemIds: string[] } | null>(null);

  if (actions.length === 0) return emptyText ? <p className="text-sm text-[var(--color-ink-400)]">{emptyText}</p> : null;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {actions.map((a) => (
          <ActionRow key={a.id} action={a} showAccount={showAccount} onRequest={setRequest} onReceive={setReceive} onOpenGroup={setGroup} />
        ))}
      </ul>
      {request && <RequestItemsDialog accountId={request.accountId} itemIds={[request.itemId]} open onClose={() => setRequest(null)} />}
      {receive && <ReceiveItemDialog accountId={receive.accountId} itemId={receive.itemId} open onClose={() => setReceive(null)} />}
      {group && <RequestGroupDialog accountId={group.accountId} itemIds={group.itemIds} open onClose={() => setGroup(null)} />}
    </>
  );
}

function ActionRow({
  action,
  showAccount,
  onRequest,
  onReceive,
  onOpenGroup,
}: {
  action: ActionItem;
  showAccount: boolean;
  onRequest: (v: { accountId: string; itemId: string }) => void;
  onReceive: (v: { accountId: string; itemId: string }) => void;
  onOpenGroup: (v: { accountId: string; itemIds: string[] }) => void;
}) {
  const setItemsFollowUp = useAccountsStore((s) => s.setItemsFollowUp);
  const updateFollowUp = useAccountsStore((s) => s.updateFollowUp);
  const completeFollowUp = useAccountsStore((s) => s.completeFollowUp);
  const markActionDone = useAccountsStore((s) => s.markActionDone);
  const isGroup = (action.itemIds?.length ?? 0) > 1;
  const navigate = useNavigate();

  // The whole row opens the task — a grouped request opens its details, anything else its account at
  // the right tab. Clicks on the row's own buttons/inputs keep doing just their own thing.
  function openTask(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, select, label')) return;
    if (isGroup) onOpenGroup({ accountId: action.accountId, itemIds: action.itemIds! });
    else navigate(workspaceHref(action));
  }
  const markItemSentToCarrier = useAccountsStore((s) => s.markItemSentToCarrier);
  const updateMissingItem = useAccountsStore((s) => s.updateMissingItem);
  const updateQuote = useAccountsStore((s) => s.updateQuote);
  const [rescheduling, setRescheduling] = useState(false);
  const meta = ACTION_KIND_META[action.kind];
  const Icon = meta.icon;

  function reschedule(date: string) {
    if (!date) return;
    if (isGroup) setItemsFollowUp(action.accountId, action.itemIds!, date);
    else if (action.followUpId) updateFollowUp(action.accountId, action.followUpId, { dueDate: date });
    else if (action.kind === 'client_follow_up' && action.itemId) updateMissingItem(action.accountId, action.itemId, { followUpDate: date });
    else if (action.quoteId && !action.itemId) updateQuote(action.accountId, action.quoteId, { followUpDate: date });
    setRescheduling(false);
  }

  // Any market-level action (carrier follow-up, unsent submission, quote to present) can be (re)scheduled via the market's follow-up date.
  const canReschedule = isGroup || !!action.followUpId || (action.kind === 'client_follow_up' && action.itemId) || (!!action.quoteId && !action.itemId && action.kind !== 'ready_to_send');
  const carrierRequestPending = action.kind === 'action_required' && action.itemId && action.id.startsWith('carrier-req-');

  return (
    <li
      onClick={openTask}
      title={isGroup ? 'Open details' : 'Open'}
      className={cn('flex cursor-pointer flex-col gap-2 rounded-lg border bg-white px-3 py-2.5 transition-colors hover:border-[var(--color-brand-500)]/50 hover:bg-[var(--color-ink-50)] sm:flex-row sm:items-center', action.overdue ? 'border-[var(--color-danger-100)]' : 'border-[var(--color-ink-100)]')}>
      <div className="flex min-w-0 flex-1 gap-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.color)}>
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          {showAccount && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">{action.accountName}</p>}
          {isGroup ? (
            <button onClick={() => onOpenGroup({ accountId: action.accountId, itemIds: action.itemIds! })} className="text-left text-sm font-medium text-[var(--color-ink-900)] hover:text-[var(--color-brand-700)] hover:underline cursor-pointer">
              {action.title}
            </button>
          ) : (
            <p className="text-sm font-medium text-[var(--color-ink-900)]">{action.title}</p>
          )}
          <p className={cn('text-xs', action.overdue ? 'font-medium text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]')}>{action.detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-9 sm:pl-0">
        {action.kind === 'ready_to_send' && action.itemId && (
          <Button size="sm" icon={<Send size={13} />} onClick={() => markItemSentToCarrier(action.accountId, action.itemId!, action.quoteId)}>
            Mark sent
          </Button>
        )}
        {carrierRequestPending && (
          <Button size="sm" icon={<Mail size={13} />} onClick={() => onRequest({ accountId: action.accountId, itemId: action.itemId! })}>
            Request from client
          </Button>
        )}
        {isGroup && (
          <Button size="sm" variant="secondary" icon={<ListChecks size={13} />} onClick={() => onOpenGroup({ accountId: action.accountId, itemIds: action.itemIds! })}>
            Details
          </Button>
        )}
        {action.followUpId && (
          <Button size="sm" variant="secondary" icon={<Check size={13} />} onClick={() => completeFollowUp(action.accountId, action.followUpId!)}>
            Done
          </Button>
        )}
        {/* Every other task can be marked done too (it comes back if its date or wording changes). */}
        {!action.followUpId && action.kind !== 'ready_to_send' && (
          <Button size="sm" variant="secondary" icon={<Check size={13} />} onClick={() => markActionDone(action)} title="Mark this task done">
            Done
          </Button>
        )}
        {action.kind === 'client_follow_up' && action.itemId && (
          <Button size="sm" variant="secondary" icon={<PackageCheck size={13} />} onClick={() => onReceive({ accountId: action.accountId, itemId: action.itemId! })}>
            Received
          </Button>
        )}
        {canReschedule &&
          (rescheduling ? (
            <DateInput autoFocus className={smallInputClass} value={action.dueDate} onCommit={(v) => v && reschedule(v)} onBlur={() => setRescheduling(false)} aria-label="New follow-up date" />
          ) : (
            <Button size="sm" variant="ghost" icon={<CalendarClock size={13} />} onClick={() => setRescheduling(true)}>
              {action.dueDate ? 'Reschedule' : 'Set follow-up'}
            </Button>
          ))}
        <Link to={workspaceHref(action)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8">
          Open <ArrowRight size={12} />
        </Link>
      </div>
    </li>
  );
}
