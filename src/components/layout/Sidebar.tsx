import { NavLink, useParams } from 'react-router-dom';
import { LayoutGrid, UploadCloud, ClipboardList, FileText, Compass, Search, BarChart3, Link2, Shield, CalendarCheck, Briefcase } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, StepStatusDot } from './WorkflowSteps';
import { BrandLogo } from '../branding/Logo';

const navItemClass =
  'group flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors';

const NAV_ICONS = {
  upload: UploadCloud,
  workspace: Briefcase,
  'risk-profile': ClipboardList,
  'limits-coverage': Shield,
  'submission-assistant': FileText,
  'carrier-appetite': Compass,
};

export function Sidebar({ mobileOpen = false, onNavigate }: { mobileOpen?: boolean; onNavigate?: () => void }) {
  const { accountId: routeAccountId } = useParams();
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const accountId = routeAccountId ?? activeAccountId ?? undefined;
  const account = accounts.find((a) => a.id === accountId);
  const steps = useWorkflowStatus(account?.id);

  return (
    <aside
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.();
      }}
      className={cn(
        'h-full w-64 shrink-0 flex-col border-r border-[var(--color-ink-100)] bg-white',
        // Below md the sidebar is an overlay toggled from the TopBar menu button.
        mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex shadow-2xl md:static md:shadow-none' : 'hidden md:flex'
      )}
    >
      <div className="flex items-center gap-2.5 px-5 py-6">
        {/* The logo goes home (Accounts). */}
        <NavLink to="/" aria-label="RenewalIQ — go to Accounts" className="rounded-md focus-visible:outline-2 focus-visible:outline-[var(--color-brand-500)]">
          <BrandLogo size={30} />
          <p className="mt-0.5 text-[11px] text-[var(--color-ink-400)]">Broker Workspace</p>
        </NavLink>
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
          Accounts
        </NavLink>

        <NavLink
          to="/today"
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
          <CalendarCheck size={17} />
          Today's Plate
        </NavLink>

        <NavLink
          to="/market-finder"
          className={({ isActive }) =>
            cn(
              navItemClass,
              isActive
                ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]'
                : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
            )
          }
        >
          <Search size={17} />
          Market Finder
        </NavLink>

        <NavLink
          to="/intake-links"
          className={({ isActive }) =>
            cn(
              navItemClass,
              isActive
                ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]'
                : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
            )
          }
        >
          <Link2 size={17} />
          Submission Intake
        </NavLink>

        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            cn(
              navItemClass,
              isActive
                ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]'
                : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
            )
          }
        >
          <BarChart3 size={17} />
          Analytics
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
                  end={step.hub}
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
                  {!step.hub && <StepStatusDot status={step.status} />}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

    </aside>
  );
}
