import { Bell, Check } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, WorkflowStepsBar } from './WorkflowSteps';
import { relativeTime } from '../../utils/dates';

export function TopBar() {
  const { accountId } = useParams();
  const location = useLocation();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const steps = useWorkflowStatus(account?.id);
  const activeKey = steps.find((s) => location.pathname.startsWith(s.path))?.key ?? '';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-ink-100)] bg-white px-8">
      <div className="min-w-0">{account && <WorkflowStepsBar steps={steps} activeKey={activeKey} />}</div>

      <div className="flex shrink-0 items-center gap-4">
        {account && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]" title="Autosaved to this browser">
            <Check size={13} className="text-[var(--color-success-500)]" />
            Saved {relativeTime(account.updatedAt)}
          </span>
        )}
        <button className="rounded-full p-2 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] hover:text-[var(--color-ink-600)]" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink-100)] text-xs font-semibold text-[var(--color-ink-600)]">
            BR
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium text-[var(--color-ink-800)]">Broker</p>
            <p className="text-[11px] text-[var(--color-ink-400)]">Commercial Lines</p>
          </div>
        </div>
      </div>
    </header>
  );
}
