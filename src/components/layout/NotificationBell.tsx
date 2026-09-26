import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Inbox } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { fetchIntakeLinks, fetchIntakeSubmissions } from '../../services/supabase/intakeRepo';
import type { IntakeSubmission } from '../../types';
import { relativeTime } from '../../utils/dates';
import { cn } from '../../utils/cn';

const POLL_MS = 60_000;
const seenKey = (userId: string) => `renewaliq.notifications.seen.${userId}`;

function readSeen(userId: string): string {
  try {
    return localStorage.getItem(seenKey(userId)) ?? '';
  } catch {
    return '';
  }
}

/**
 * Notifications: every submission that came in through one of the broker's intake links and hasn't
 * been imported or dismissed yet. The red count is the ones that arrived since the bell was last
 * opened (remembered in this browser); each one opens Submission Intake to review and import it.
 */
export function NotificationBell() {
  const session = useBrokerSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userId = session.status === 'signed_in' ? session.userId : null;
  const [pending, setPending] = useState<IntakeSubmission[]>([]);
  const [linkNames, setLinkNames] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState('');
  const [open, setOpen] = useState(false);
  /** What had been seen when the list was opened — items newer than this get the "new" dot. */
  const [seenAtOpen, setSeenAtOpen] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [subs, links] = await Promise.all([fetchIntakeSubmissions(userId), fetchIntakeLinks(userId)]);
    if (subs.ok) setPending(subs.data.filter((s) => s.status === 'pending'));
    if (links.ok) setLinkNames(Object.fromEntries(links.data.map((l) => [l.id, l.organizationName || l.label])));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setSeen(readSeen(userId));
    const timer = setInterval(load, POLL_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [userId, load]);

  // Importing or dismissing on Submission Intake changes what's pending — refresh on navigation.
  useEffect(() => {
    load();
  }, [pathname, load]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!userId) return null;

  const unread = pending.filter((s) => s.createdAt > seen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) setSeenAtOpen(seen);
    if (next && pending.length > 0 && userId) {
      const newest = pending.reduce((m, s) => (s.createdAt > m ? s.createdAt : m), seen);
      try {
        localStorage.setItem(seenKey(userId), newest);
      } catch {
        // per-browser convenience only
      }
      setSeen(newest);
    }
  }

  function openIntake() {
    setOpen(false);
    navigate('/intake-links');
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="relative rounded-full p-2 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] hover:text-[var(--color-ink-600)] cursor-pointer"
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger-600)] px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white [box-shadow:var(--shadow-popover)]">
          <div className="border-b border-[var(--color-ink-100)] px-3 py-2">
            <p className="text-sm font-semibold text-[var(--color-ink-900)]">Notifications</p>
          </div>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
              <Inbox size={20} className="text-[var(--color-ink-300)]" />
              <p className="text-sm text-[var(--color-ink-500)]">No new submissions from your intake links.</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {pending.map((s) => (
                <li key={s.id}>
                  <button onClick={openIntake} className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--color-ink-50)] cursor-pointer">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', s.createdAt > seenAtOpen ? 'bg-[var(--color-danger-600)]' : 'bg-transparent')} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--color-ink-900)]">New submission: {s.namedInsured || 'Unnamed business'}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-500)]">
                        {linkNames[s.intakeLinkId] ? `via ${linkNames[s.intakeLinkId]} · ` : ''}
                        {relativeTime(s.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={openIntake} className="block w-full border-t border-[var(--color-ink-100)] px-3 py-2 text-center text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-ink-50)] cursor-pointer">
            Open Submission Intake
          </button>
        </div>
      )}
    </div>
  );
}
