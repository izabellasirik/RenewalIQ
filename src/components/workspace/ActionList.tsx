import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Mail, PackageCheck, Send } from 'lucide-react';
import type { ActionItem } from '../../services/workflow/nextActions';
import { ACTION_KIND_META, workspaceHref } from './actionMeta';
import { useAccountsStore } from '../../state/useAccountsStore';
import { Button } from '../ui';
import { RequestItemsDialog } from './RequestItemsDialog';
import { ReceiveItemDialog } from './ReceiveItemDialog';
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

  if (actions.length === 0) return emptyText ? <p className="text-sm text-[var(--color-ink-400)]">{emptyText}</p> : null;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {actions.map((a) => (
          <ActionRow key={a.id} action={a} showAccount={showAccount} onRequest={setRequest} onReceive={setReceive} />
        ))}
      </ul>
      {request && <RequestItemsDialog accountId={request.accountId} itemIds={[request.itemId]} open onClose={() => setRequest(null)} />}
      {receive && <ReceiveItemDialog accountId={receive.accountId} itemId={receive.itemId} open onClose={() => setReceive(null)} />}
    </>
  );
}

function ActionRow({
  action,
  showAccount,
  onRequest,
  onReceive,
}: {
  action: ActionItem;
  showAccount: boolean;
  onRequest: (v: { accountId: string; itemId: string }) => void;
  onReceive: (v: { accountId: string; itemId: string }) => void;
}) {
  const markItemSentToCarrier = useAccountsStore((s) => s.markItemSentToCarrier);
  const updateMissingItem = useAccountsStore((s) => s.updateMissingItem);
  const updateQuote = useAccountsStore((s) => s.updateQuote);
  const [rescheduling, setRescheduling] = useState(false);
  const meta = ACTION_KIND_META[action.kind];
  const Icon = meta.icon;

  function reschedule(date: string) {
    if (!date) return;
    if (action.kind === 'client_follow_up' && action.itemId) updateMissingItem(action.accountId, action.itemId, { followUpDate: date });
    else if (action.quoteId && !action.itemId) updateQuote(action.accountId, action.quoteId, { followUpDate: date });
    setRescheduling(false);
  }

  // Any market-level action (carrier follow-up, unsent submission, quote to present) can be (re)scheduled via the market's follow-up date.
  const canReschedule = (action.kind === 'client_follow_up' && action.itemId) || (!!action.quoteId && !action.itemId && action.kind !== 'ready_to_send');
  const carrierRequestPending = action.kind === 'action_required' && action.itemId && action.id.startsWith('carrier-req-');

  return (
    <li className={cn('flex flex-col gap-2 rounded-lg border bg-white px-3 py-2.5 sm:flex-row sm:items-center', action.overdue ? 'border-[var(--color-danger-100)]' : 'border-[var(--color-ink-100)]')}>
      <div className="flex min-w-0 flex-1 gap-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.color)}>
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          {showAccount && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">{action.accountName}</p>}
          <p className="text-sm font-medium text-[var(--color-ink-900)]">{action.title}</p>
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
