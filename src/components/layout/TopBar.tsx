import { useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronDown, LogOut, CloudOff, CloudUpload, AlertTriangle } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, WorkflowStepsBar } from './WorkflowSteps';
import { relativeTime } from '../../utils/dates';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { signOutBroker } from '../../services/supabase/brokerAuth';

/** email + Sign out when signed in; a discreet "Sign in" link otherwise. Deliberately small — see PROJECT direction not to overbuild profiles yet. */
function AccountMenu() {
  const navigate = useNavigate();
  const session = useBrokerSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (session.status === 'not_configured') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]" title="Cloud sync is not configured in this environment — see SUPABASE_SETUP.md">
        <CloudOff size={14} />
        Local only
      </span>
    );
  }

  if (session.status !== 'signed_in') {
    return (
      <button
        onClick={() => navigate('/login')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-200)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer"
      >
        <CloudUpload size={13} />
        Sign in to save across devices
      </button>
    );
  }

  const initials = (session.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-[var(--color-ink-50)] cursor-pointer">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand-800)]/10 text-xs font-semibold text-[var(--color-brand-800)]">{initials}</div>
        <div className="leading-tight text-left">
          <p className="max-w-[160px] truncate text-sm font-medium text-[var(--color-ink-800)]">{session.email}</p>
          <p className="text-[11px] text-[var(--color-ink-400)]">Signed in</p>
        </div>
        <ChevronDown size={14} className="text-[var(--color-ink-400)]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white py-1 [box-shadow:var(--shadow-popover)]">
          <div className="border-b border-[var(--color-ink-100)] px-3 py-2">
            <p className="truncate text-xs text-[var(--color-ink-500)]">{session.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              signOutBroker();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { accountId } = useParams();
  const location = useLocation();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const syncStatus = useAccountsStore((s) => (accountId ? s.syncStatus[accountId] : undefined));
  const steps = useWorkflowStatus(account?.id);
  const activeKey = steps.find((s) => location.pathname.startsWith(s.path))?.key ?? '';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-ink-100)] bg-white px-8">
      <div className="min-w-0">{account && <WorkflowStepsBar steps={steps} activeKey={activeKey} />}</div>

      <div className="flex shrink-0 items-center gap-4">
        {account && syncStatus === 'saving' && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]">
            <Check size={13} className="animate-pulse text-[var(--color-ink-300)]" />
            Saving…
          </span>
        )}
        {account && syncStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-danger-600)]" title="This change is only saved in this browser — it did not reach your account. Try again.">
            <AlertTriangle size={13} />
            Failed to save to your account
          </span>
        )}
        {account && (syncStatus === 'saved' || syncStatus === undefined) && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]" title={syncStatus === 'saved' ? 'Saved to your Renewal IQ account' : 'Autosaved to this browser'}>
            <Check size={13} className="text-[var(--color-success-500)]" />
            Saved {relativeTime(account.updatedAt)}
          </span>
        )}
        <button className="rounded-full p-2 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] hover:text-[var(--color-ink-600)]" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <AccountMenu />
      </div>
    </header>
  );
}
