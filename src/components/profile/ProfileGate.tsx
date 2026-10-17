import { useEffect, useState, type ReactNode } from 'react';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { loadMyProfile } from '../../services/supabase/profileRepo';
import { pendingInvite } from '../../services/supabase/teamRepo';
import { Navigate } from 'react-router-dom';
import { useAccountsStore } from '../../state/useAccountsStore';
import { AuthShell } from '../auth/AuthShell';
import { Skeleton } from '../ui';
import { ProfileForm } from './ProfileForm';

/**
 * After sign-in, loads the user's professional profile. The first time someone signs in without a
 * name on file, they get a one-time "Set up your profile" screen before Renewal IQ; anyone who
 * already has a name (e.g. an agency member named during setup) goes straight in. If the profile
 * can't be read (offline), nobody is blocked. Local-only mode (no Supabase) passes straight through.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const session = useBrokerSession();
  const myProfile = useAccountsStore((s) => s.myProfile);
  const setMyProfile = useAccountsStore((s) => s.setMyProfile);
  const [state, setState] = useState<'loading' | 'ready' | 'setup'>('loading');
  const userId = session.status === 'signed_in' ? session.userId : null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setState('loading');
    loadMyProfile(userId).then((profile) => {
      if (cancelled) return;
      if (profile) setMyProfile(profile);
      setState(profile && !profile.fullName ? 'setup' : 'ready');
    });
    return () => {
      cancelled = true;
    };
  }, [userId, setMyProfile]);

  if (session.status !== 'signed_in' || !userId) return <>{children}</>;
  // An invitation opened before signing up / in (e.g. the confirmation email landed on the home page): finish joining first.
  const invite = pendingInvite();
  if (invite) return <Navigate to={`/invite/${invite}`} replace />;
  if (state === 'loading' && !myProfile?.fullName) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--color-ink-50)] p-8">
        <Skeleton variant="block" className="h-24 w-full max-w-md" />
      </div>
    );
  }
  if (state === 'setup') {
    return (
      <AuthShell>
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
          <div>
            <p className="text-base font-semibold text-[var(--color-ink-900)]">Set up your profile</p>
            <p className="mt-1 text-sm text-[var(--color-ink-500)]">Your name is shown to your team on accounts you’re assigned and in activity.</p>
          </div>
          <ProfileForm email={session.email ?? ''} initial={myProfile} submitLabel="Continue to Renewal IQ" onSaved={() => setState('ready')} />
        </div>
      </AuthShell>
    );
  }
  return <>{children}</>;
}
