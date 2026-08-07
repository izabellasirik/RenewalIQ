import { NavLink, useParams } from 'react-router-dom';
import { LayoutGrid, UploadCloud, ClipboardList, ListChecks, FileText, Compass } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, StepStatusDot } from './WorkflowSteps';

const navItemClass =
  'group flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors';

const NAV_ICONS = {
  upload: UploadCloud,
  'risk-profile': ClipboardList,
  review: ListChecks,
  'submission-assistant': FileText,
  'carrier-appetite': Compass,
};

export function Sidebar() {
  const { accountId: routeAccountId } = useParams();
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const accountId = routeAccountId ?? activeAccountId ?? undefined;
  const account = accounts.find((a) => a.id === accountId);
  const steps = useWorkflowStatus(account?.id);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--color-ink-100)] bg-white">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand-800)] text-sm font-bold text-white">
          R
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight text-[var(--color-ink-900)]">Renewal IQ</p>
          <p className="text-[11px] text-[var(--color-ink-400)]">Broker Workspace</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              navItemClass,
              isActive
                ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]'
                : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
            )
          }
        >
          <LayoutGrid size={17} />
          Dashboard
        </NavLink>

        {account && (
          <>
            <p className="mb-1 mt-5 truncate px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">
              {account.namedInsured}
            </p>
            {steps.map((step) => {
              const Icon = NAV_ICONS[step.key as keyof typeof NAV_ICONS];
              return (
                <NavLink
                  key={step.key}
                  to={step.path}
                  className={({ isActive }) =>
                    cn(
                      navItemClass,
                      isActive
                        ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]'
                        : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
                    )
                  }
                >
                  <Icon size={17} />
                  <span className="flex-1">{step.label}</span>
                  <StepStatusDot status={step.status} />
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      <div className="border-t border-[var(--color-ink-100)] px-5 py-4">
        <p className="text-[11px] text-[var(--color-ink-400)]">Renewal IQ MVP · Design Preview</p>
      </div>
    </aside>
  );
}
