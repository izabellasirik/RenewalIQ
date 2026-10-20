import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { signOutBroker } from '../../services/supabase/brokerAuth';
import { acceptMyInvitation, fetchProductAccess, type ProductAccess } from '../../services/supabase/teamRepo';
import { AuthShell } from '../auth/AuthShell';
import { Button, Skeleton } from '../ui';

/**
 * RenewalIQ is invitation-only. A signed-in person who isn't in an agency sees only this screen: Join
 * for their invitation, or how to get one. The database (0069) refuses them everything else anyway.
 */
export function MembershipGate({ children }: { children: ReactNode }) {
  const session = useBrokerSession();
  const userId = session.status === 'signed_in' ? session.userId : null;
  const [access, setAccess] = useState<ProductAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const check = useCallback(() => {
    setError(null);
    setAccess(null);
    void fetchProductAccess().then((r) => (r.ok ? setAccess(r.data) : setError(r.message)));
  }, []);
  useEffect(() => {
    if (userId) check();
  }, [userId, check]);

  if (!userId || access?.allowed) return <>{children}</>;

  const join = async (id: string) => {
    setJoining(id);
    setError(null);
    const r = await acceptMyInvitation(id);
    if (r.ok) window.location.reload();
    else {
      setError(r.message);
      setJoining(null);
    }
  };

  let body: ReactNode;
  if (!access && !error) body = <Skeleton variant="block" className="h-24 w-full" />;
  else if (!access) {
    body = (
      <>
        <p className="text-base font-semibold text-[var(--color-ink-900)]">We couldn’t check your access</p>
        <p className="text-sm text-[var(--color-ink-500)]">{error}</p>
        <Button className="self-start" onClick={check}>
          Try again
        </Button>
      </>
    );
  } else if (access.invitations.length > 0) {
    body = (
      <>
        <div>
          <p className="text-base font-semibold text-[var(--color-ink-900)]">Join your agency</p>
          <p className="mt-1 text-sm text-[var(--color-ink-500)]">You’ve been invited to RenewalIQ. Join to start working with your team.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {access.invitations.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="join-invitation">
              <span>
                <span className="block text-sm font-semibold text-[var(--color-ink-900)]">{inv.agencyName}</span>
                <span className="text-xs text-[var(--color-ink-500)]">as {inv.role === 'admin' ? 'an admin' : 'an agent'}</span>
              </span>
              <Button onClick={() => join(inv.id)} disabled={joining !== null}>
                {joining === inv.id ? 'Joining…' : 'Join'}
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p className="text-sm text-[var(--color-danger-600)]" role="alert">
            {error}{' '}
            <button onClick={check} className="font-medium underline cursor-pointer">
              Refresh
            </button>
          </p>
        )}
      </>
    );
  } else {
    body = (
      <>
        <div>
          <p className="text-base font-semibold text-[var(--color-ink-900)]">You don’t have access yet</p>
          <p className="mt-1 text-sm text-[var(--color-ink-500)]">
            RenewalIQ is invitation-only. Ask your agency’s admin to invite <strong>{session.email ?? 'you'}</strong> from their Team page, then check again.
          </p>
        </div>
        <Button className="self-start" variant="secondary" onClick={check}>
          Check again
        </Button>
      </>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-6" data-testid="membership-gate">
        {body}
        <button onClick={() => void signOutBroker()} className="self-start text-sm font-medium text-[var(--color-ink-500)] hover:underline cursor-pointer">
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
