import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, LogOut, UserRound, CloudOff, CloudUpload, AlertTriangle, Menu } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useWorkflowStatus, WorkflowStepsBar } from './WorkflowSteps';
import { relativeTime } from '../../utils/dates';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { signOutBroker } from '../../services/supabase/brokerAuth';
import { NotificationBell } from './NotificationBell';
import { ProfileForm } from '../profile/ProfileForm';
import { Modal } from '../ui';

/** email + Sign out when signed in; a discreet "Sign in" link otherwise. Deliberately small — see PROJECT direction not to overbuild profiles yet. */
function AccountMenu() {
  const navigate = useNavigate();
  const session = useBrokerSession();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const myProfile = useAccountsStore((s) => s.myProfile);
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

  const name = myProfile?.fullName || null;
  const initials = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : (session.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-[var(--color-ink-50)] cursor-pointer">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand-800)]/10 text-xs font-semibold text-[var(--color-brand-800)]">{initials}</div>
        <div className="hidden leading-tight text-left sm:block">
          <p className="max-w-[160px] truncate text-sm font-medium text-[var(--color-ink-800)]">{name ?? session.email}</p>
          <p className="max-w-[160px] truncate text-[11px] text-[var(--color-ink-400)]">{name ? (myProfile?.jobTitle || session.email) : 'Signed in'}</p>
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
              setProfileOpen(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer"
          >
            <UserRound size={14} />
            Your profile
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              await signOutBroker();
              navigate('/login', { replace: true });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
      <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="Your profile">
        {profileOpen && <ProfileForm email={session.email ?? ''} initial={myProfile} submitLabel="Save" onSaved={() => setProfileOpen(false)} />}
      </Modal>
    </div>
  );
}

export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const { accountId } = useParams();
  const location = useLocation();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const syncStatus = useAccountsStore((s) => (accountId ? s.syncStatus[accountId] : undefined));
  const syncError = useAccountsStore((s) => (accountId ? s.syncError[accountId] : undefined));
  const [errorOpen, setErrorOpen] = useState(false);
  // A fresh error starts with its details closed.
  useEffect(() => {
    if (syncStatus !== 'error') setErrorOpen(false);
  }, [syncStatus]);
  const steps = useWorkflowStatus(account?.id);
  // Workspace's address is the start of every account page's, so it's only active on its own page.
  const activeKey = steps.find((s) => (s.hub ? location.pathname.replace(/\/$/, '') === s.path : location.pathname.startsWith(s.path)))?.key ?? '';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-ink-100)] bg-white px-3 sm:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={onOpenNav} className="rounded-md p-2 text-[var(--color-ink-500)] hover:bg-[var(--color-ink-50)] md:hidden cursor-pointer" aria-label="Open navigation">
          <Menu size={18} />
        </button>
        <div className="hidden min-w-0 overflow-x-auto md:block">{account && <WorkflowStepsBar steps={steps} activeKey={activeKey} />}</div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {account && syncStatus === 'saving' && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]">
            <Check size={13} className="animate-pulse text-[var(--color-ink-300)]" />
            Saving…
          </span>
        )}
        {/* A save hiccup being retried quietly — not an error (yet). */}
        {account && syncStatus === 'retrying' && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]" title="The last save didn't go through — retrying automatically.">
            <Loader2 size={13} className="animate-spin text-[var(--color-ink-300)]" />
            Saving… retrying
          </span>
        )}
        {account && syncStatus === 'error' && (
          <div className="relative">
            <button
              onClick={() => setErrorOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[var(--color-danger-600)] hover:underline cursor-pointer"
              title="Couldn’t sync this change yet. It’s saved locally and we’ll retry."
            >
              <AlertTriangle size={13} />
              <span className="hidden sm:inline">Couldn’t sync this change yet</span>
              <span className="sm:hidden">Not synced yet</span>
            </button>
            {errorOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[var(--color-danger-100)] bg-white p-3 text-xs text-[var(--color-ink-700)] [box-shadow:var(--shadow-popover)]">
                <p className="font-semibold text-[var(--color-danger-600)]">Couldn’t sync this change yet. It’s saved locally and we’ll retry.</p>
                <p className="mt-2 text-[var(--color-ink-500)]">Retrying automatically every minute and on your next edit — this clears by itself once it goes through.</p>
                {syncError && (
                  <details className="mt-2 text-[var(--color-ink-500)]">
                    <summary className="cursor-pointer">Technical details</summary>
                    <p className="mt-1 break-words font-mono text-[11px]">{syncError}</p>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
        {account && (syncStatus === 'saved' || syncStatus === undefined) && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-400)]" title={syncStatus === 'saved' ? 'Saved to your RenewalIQ account' : 'Autosaved to this browser'}>
            <Check size={13} className="text-[var(--color-success-500)]" />
            Saved {relativeTime(account.updatedAt)}
          </span>
        )}
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
