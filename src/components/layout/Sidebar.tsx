import { NavLink, useParams } from 'react-router-dom';
import { LayoutGrid, UploadCloud, ClipboardList, FileText, Compass } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAccountsStore } from '../../state/useAccountsStore';

const navItemClass =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';

export function Sidebar() {
  const { accountId: routeAccountId } = useParams();
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const accountId = routeAccountId ?? activeAccountId ?? undefined;
  const account = accounts.find((a) => a.id === accountId);

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
            cn(navItemClass, isActive ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')
          }
        >
          <LayoutGrid size={17} />
          Dashboard
        </NavLink>

        {account && (
          <>
            <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">
              {account.namedInsured}
            </p>
            <NavLink
              to={`/accounts/${account.id}/upload`}
              className={({ isActive }) =>
                cn(navItemClass, isActive ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')
              }
            >
              <UploadCloud size={17} />
              Documents
            </NavLink>
            <NavLink
              to={`/accounts/${account.id}/risk-profile`}
              className={({ isActive }) =>
                cn(navItemClass, isActive ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')
              }
            >
              <ClipboardList size={17} />
              Risk Profile
            </NavLink>
            <NavLink
              to={`/accounts/${account.id}/submission-assistant`}
              className={({ isActive }) =>
                cn(navItemClass, isActive ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')
              }
            >
              <FileText size={17} />
              Submission Assistant
            </NavLink>
            <NavLink
              to={`/accounts/${account.id}/carrier-appetite`}
              className={({ isActive }) =>
                cn(navItemClass, isActive ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')
              }
            >
              <Compass size={17} />
              Carrier Appetite
            </NavLink>
          </>
        )}
      </nav>

      <div className="border-t border-[var(--color-ink-100)] px-5 py-4">
        <p className="text-[11px] text-[var(--color-ink-400)]">Renewal IQ MVP · Phase 1</p>
      </div>
    </aside>
  );
}
