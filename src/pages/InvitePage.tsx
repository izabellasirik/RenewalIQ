import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { signOutBroker } from '../services/supabase/brokerAuth';
import { acceptInvitation, clearPendingInvite, getInvitation, rememberPendingInvite, type InvitationInfo } from '../services/supabase/teamRepo';
import { useAccountsStore } from '../state/useAccountsStore';

const ROLE_LABEL = { agent: 'Agent', admin: 'Admin' } as const;

/**
 * /invite/:token — where an invitation link lands. Shows which agency and role it's for; a signed-out
 * visitor creates an account or signs in (with the invited email, which comes back here afterwards);
 * a signed-in visitor with the invited email joins with one click. The agency and role come from the
 * invitation in the database — the person never picks them.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const session = useBrokerSession();
  const [info, setInfo] = useState<InvitationInfo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    getInvitation(token).then((res) => {
      if (!res.ok) return setLoadError(res.message);
      setInfo(res.data);
      if (res.data?.status !== 'open') clearPendingInvite();
    });
  }, [token]);

  // The remembered invitation has done its job once a signed-in person is looking at it — clearing it
  // here means a mismatched or unusable invitation can never keep redirecting them back.
  useEffect(() => {
    if (session.status === 'signed_in') clearPendingInvite();
  }, [session.status]);

  async function join() {
    setJoining(true);
    setJoinError(null);
    const res = await acceptInvitation(token);
    setJoining(false);
    if (!res.ok) return setJoinError(res.message);
    clearPendingInvite();
    // Re-read agency membership and accounts, then into Renewal IQ (profile setup first if needed).
    await useAccountsStore.getState().hydrateCloudSubmissions();
    navigate('/', { replace: true });
  }

  const qs = info ? `?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(info.email)}` : '';
  const signedInEmail = session.status === 'signed_in' ? (session.email ?? '').toLowerCase() : null;

  let body;
  if (loadError) body = <p className="text-sm text-[var(--color-danger-600)]">{loadError}</p>;
  else if (info === undefined || session.status === 'loading')
    body = (
      <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
        <Loader2 size={15} className="animate-spin" /> Opening your invitation…
      </p>
    );
  else if (info === null) body = <p className="text-sm text-[var(--color-ink-700)]">This invitation link isn’t valid. Ask your agency admin to send you a new one.</p>;
  else if (info.status !== 'open' && !(info.status === 'accepted' && signedInEmail === info.email))
    body = (
      <p className="text-sm text-[var(--color-ink-700)]">
        {info.status === 'accepted' ? 'This invitation has already been used.' : info.status === 'revoked' ? 'This invitation was cancelled.' : 'This invitation has expired.'} Ask your
        agency admin for a new one.
      </p>
    );
  else
    body = (
      <>
        <div>
          <p className="text-base font-semibold text-[var(--color-ink-900)]">Join {info.agencyName} on Renewal IQ</p>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            You’ve been invited as <span className="font-medium text-[var(--color-ink-900)]">{ROLE_LABEL[info.role]}</span> with{' '}
            <span className="font-medium text-[var(--color-ink-900)]">{info.email}</span>.
          </p>
        </div>
        {signedInEmail === null ? (
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                rememberPendingInvite(token);
                navigate(`/signup${qs}`);
              }}
            >
              Create your account
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                rememberPendingInvite(token);
                navigate(`/login${qs}`);
              }}
            >
              I already have an account — sign in
            </Button>
          </div>
        ) : signedInEmail !== info.email ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-ink-600)]">
              You’re signed in as <span className="font-medium">{session.email}</span>. This invitation is for {info.email}.
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                await signOutBroker();
                navigate(`/login${qs}`);
              }}
            >
              Sign out and sign in as {info.email}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {joinError && <p className="text-sm text-[var(--color-danger-600)]">{joinError}</p>}
            <Button onClick={join} disabled={joining} icon={joining ? <Loader2 size={15} className="animate-spin" /> : undefined}>
              {joining ? 'Joining…' : `Join ${info.agencyName}`}
            </Button>
          </div>
        )}
      </>
    );

  return (
    <AuthShell>
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand-800)]/10 text-[var(--color-brand-800)]">
          <Users size={17} />
        </span>
        {body}
      </div>
    </AuthShell>
  );
}
