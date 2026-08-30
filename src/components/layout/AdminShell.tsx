import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../utils/cn';

/**
 * Deliberately separate from AppShell (no broker Sidebar/TopBar/FeedbackWidget) — the admin area
 * is a distinct internal tool, not a broker-facing product surface. Reachable only via the
 * discreet footer link in the broker Sidebar and by knowing the /admin URL directly; see
 * router.tsx and Sidebar.tsx.
 */
export function AdminShell() {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-[var(--color-brand-800)]/8 text-[var(--color-brand-800)]' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]');

  return (
    <div className="min-h-screen bg-[var(--color-ink-50)]">
      <header className="border-b border-[var(--color-ink-100)] bg-white px-6 py-3.5">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-800)] text-sm font-bold text-white">R</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight tracking-tight text-[var(--color-ink-900)]">Renewal IQ — Admin</p>
            <p className="text-[11px] leading-tight text-[var(--color-ink-400)]">Internal tool — not part of the broker product</p>
          </div>
          <nav className="ml-auto flex items-center gap-1">
            <NavLink to="/admin" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/admin/appetite-updates" className={navLinkClass}>
              Appetite Update Requests
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
