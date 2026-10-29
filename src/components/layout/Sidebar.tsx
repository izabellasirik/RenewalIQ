import type { ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { LayoutGrid, UploadCloud, ClipboardList, FileText, Compass, Search, BarChart3, Link2, Shield, CalendarCheck, Briefcase, Users, Inbox, LineChart, ShieldAlert, ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import { isSupabaseConfigured } from '../../services/supabase/client';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, StepStatusDot } from './WorkflowSteps';
import { BrandLogo } from '../branding/Logo';
import { useEffect, useState } from 'react';
import { checkIsAdmin } from '../../services/supabase/adminAuth';
import { checkIsFounder } from '../../services/productAnalytics/founderRepo';

/** Whether the signed-in user may review product feedback and appetite-update requests — asks the database (is_admin()). */
function useIsReviewer(): boolean {
  const userId = useAccountsStore((s) => s.currentUserId);
  const [reviewer, setReviewer] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setReviewer(false);
      return;
    }
    checkIsAdmin().then((ok) => !cancelled && setReviewer(ok));
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return reviewer;
}

/** Whether the signed-in user is the Renewal IQ founder — the database's is_founder() decides (never an email check here). */
function useIsFounder(): boolean {
  const userId = useAccountsStore((s) => s.currentUserId);
  const [founder, setFounder] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setFounder(false);
      return;
    }
    checkIsFounder().then((ok) => !cancelled && setFounder(ok));
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return founder;
}

const navItemClass =
  'group relative flex items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors';
const activeClass = 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/6 text-[var(--color-brand-800)]';
const idleClass = 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]';

const NAV_ICONS = {
  upload: UploadCloud,
  workspace: Briefcase,
  'risk-profile': ClipboardList,
  'limits-coverage': Shield,
  'submission-assistant': FileText,
  'carrier-appetite': Compass,
};

/**
 * One sidebar link. Collapsed (desktop only), just the icon: the name stays for screen readers and shows as a
 * tooltip on hover or keyboard focus; `extra` (a status dot) sits on the icon's corner.
 */
function NavItem({ to, end, icon: Icon, label, collapsed, extra }: { to: string; end?: boolean; icon: LucideIcon; label: string; collapsed: boolean; extra?: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn(navItemClass, isActive ? activeClass : idleClass, collapsed && 'md:justify-center md:px-0')}>
      <Icon size={17} className="shrink-0" />
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'md:sr-only')}>{label}</span>
      {extra && <span className={cn('flex shrink-0 items-center', collapsed && 'md:absolute md:right-2 md:top-1.5')}>{extra}</span>}
      {collapsed && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--color-ink-900)] px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:block"
        >
          {label}
        </span>
      )}
    </NavLink>
  );
}

/**
 * The left navigation. On desktop it collapses to an icon rail (`collapsed`, toggled by the chevron button);
 * below md it's an overlay opened from the TopBar menu button, always shown in full.
 */
export function Sidebar({ mobileOpen = false, onNavigate, collapsed = false, onToggleCollapsed }: { mobileOpen?: boolean; onNavigate?: () => void; collapsed?: boolean; onToggleCollapsed?: () => void }) {
  const { accountId: routeAccountId } = useParams();
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const accountId = routeAccountId ?? activeAccountId ?? undefined;
  const account = accounts.find((a) => a.id === accountId);
  const steps = useWorkflowStatus(account?.id);
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  // Signed in to the cloud but in no agency: an owner can set one up (brokers join by invitation).
  const canCreateAgency = useAccountsStore((s) => !!s.currentUserId && !s.agencyAccess && isSupabaseConfigured);
  const isReviewer = useIsReviewer();
  const isFounder = useIsFounder();
  const pendingIntake = useAccountsStore((s) => s.pendingIntakeCount);
  // The mobile overlay is always the full sidebar.
  const rail = collapsed && !mobileOpen;

  return (
    <aside
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.();
      }}
      className={cn(
        'h-full w-64 shrink-0 flex-col border-r border-[var(--color-ink-100)] bg-white transition-[width] duration-200 ease-out motion-reduce:transition-none',
        rail && 'md:w-16',
        // Below md the sidebar is an overlay toggled from the TopBar menu button.
        mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex shadow-2xl md:static md:shadow-none' : 'hidden md:relative md:z-20 md:flex'
      )}
      data-collapsed={rail ? 'true' : 'false'}
    >
      <div className={cn('flex items-start justify-between gap-2.5 px-5 py-6', rail && 'md:flex-col md:items-center md:gap-3 md:px-0')}>
        {/* The logo goes home (Accounts). */}
        <NavLink to="/" aria-label="RenewalIQ — go to Accounts" className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-[var(--color-brand-500)]">
          {rail ? (
            <>
              <span className="md:hidden">
                <BrandLogo size={30} />
              </span>
              <span className="hidden md:block">
                <BrandLogo size={30} wordmark={false} />
              </span>
            </>
          ) : (
            <BrandLogo size={30} />
          )}
          <p className={cn('mt-0.5 whitespace-nowrap text-[11px] text-[var(--color-ink-400)]', rail && 'md:hidden')}>Agent Workspace</p>
        </NavLink>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!rail}
            title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden shrink-0 cursor-pointer rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] hover:text-[var(--color-ink-700)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand-500)] md:block"
            data-testid="sidebar-toggle"
          >
            {rail ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
      </div>

      <nav className={cn('flex flex-1 flex-col gap-1 px-3', rail && 'md:px-2')} aria-label="Main">
        <NavItem to="/" end icon={LayoutGrid} label="Accounts" collapsed={rail} />
        <NavItem to="/today" end icon={CalendarCheck} label="Today's Plate" collapsed={rail} />
        <NavItem to="/market-finder" icon={Search} label="Market Finder" collapsed={rail} />
        <NavItem
          to="/intake-links"
          icon={Link2}
          label="Submission Intake"
          collapsed={rail}
          // Something is waiting in Pending.
          extra={pendingIntake > 0 ? <span className="h-2 w-2 rounded-full bg-[var(--color-warning-500)]" title={`${pendingIntake} pending submission${pendingIntake === 1 ? '' : 's'}`} aria-label={`${pendingIntake} pending`} /> : undefined}
        />
        <NavItem to="/analytics" icon={BarChart3} label="Analytics" collapsed={rail} />

        {/* The founder only — the database's is_founder() decides, and the page's data is refused to anyone else. */}
        {isFounder && <NavItem to="/founder-analytics" icon={LineChart} label="Founder Analytics" collapsed={rail} />}

        {/* Renewal IQ reviewers (admin_users) only — the database's is_admin() decides, and the /admin pages check it again. */}
        {isReviewer && <NavItem to="/admin" icon={Inbox} label="Feedback & Updates" collapsed={rail} />}

        {canCreateAgency && <NavItem to="/team" icon={Users} label="Set up agency" collapsed={rail} />}

        {/* Agency admins only — the database also only returns the whole team to an admin. */}
        {isAgencyAdmin && <NavItem to="/team" icon={Users} label="Team and Partners" collapsed={rail} />}
        {isAgencyAdmin && <NavItem to="/admin-review" icon={ShieldAlert} label="Admin Review" collapsed={rail} />}

        {account && (
          <>
            {rail ? (
              <div className="mx-2 mb-1 mt-4 hidden border-t border-[var(--color-ink-100)] md:block" aria-hidden />
            ) : null}
            <p className={cn('mb-1 mt-5 truncate px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]', rail && 'md:sr-only')}>
              {account.namedInsured}
            </p>
            {steps.map((step) => {
              const Icon = NAV_ICONS[step.key as keyof typeof NAV_ICONS];
              const link = <NavItem key={step.key} to={step.path} end={step.hub} icon={Icon} label={step.label} collapsed={rail} extra={!step.hub ? <StepStatusDot status={step.status} /> : undefined} />;
              // The account home, then a divider, then the workflow steps.
              return step.hub ? (
                <div key={step.key}>
                  {link}
                  <div className="mx-3 my-1.5 border-t border-[var(--color-ink-100)]" aria-hidden />
                </div>
              ) : (
                link
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
