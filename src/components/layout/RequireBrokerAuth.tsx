import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { Skeleton } from '../ui';

/**
 * The single authorization gate for every broker-private route (everything under AppShell — see
 * router.tsx): the dashboard, an account's Documents/Risk Profile/Limits & Coverage/Submission
 * Assistant/Carrier Appetite pages, intake link management, and Analytics. A signed-out visitor is
 * redirected to /login rather than ever seeing any of that content — this is the fix for the
 * reported bug where opening the site while logged out showed the dashboard directly.
 *
 * 'not_configured' (no VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY in this environment) is
 * deliberately NOT redirected: with no Supabase project, there is no login system to redirect to
 * at all — /login itself just shows "Cloud sign-in isn't configured" and a "Continue without an
 * account" link back to `/`, so redirecting here would be a dead-end loop. This is the same
 * documented local-only mode SUPABASE_SETUP.md and useBrokerSession already describe; it only ever
 * applies to an environment with no cloud project configured, never to a live, configured
 * deployment. On a live deployment (Supabase configured), a signed-out visitor is ALWAYS sent to
 * /login — there is no "try without an account" path once real accounts exist to protect.
 *
 * 'loading' renders a lightweight skeleton rather than redirecting or rendering the real page —
 * redirecting here would incorrectly bounce an already-signed-in user to /login for a frame while
 * the session is still being resolved from the live Supabase session on load.
 */
export function RequireBrokerAuth({ children }: { children: ReactNode }) {
  const session = useBrokerSession();

  if (session.status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--color-ink-50)] p-8">
        <Skeleton variant="block" className="h-24 w-full max-w-md" />
      </div>
    );
  }

  // 'password_recovery' (arrived via a "forgot password" email link) is treated the same as
  // signed_out here — in practice this redirect always points at /login itself (see
  // requestBrokerPasswordReset), so a private route only ever sees this status if someone
  // navigates here directly mid-recovery; either way the "set a new password" flow, not the
  // private workspace, is what should be shown next.
  if (session.status === 'signed_out' || session.status === 'password_recovery') {
    return <Navigate to="/login" replace />;
  }

  // 'not_configured' or 'signed_in'
  return <>{children}</>;
}
