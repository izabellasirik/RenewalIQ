import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { HomePage } from '../../pages/public/HomePage';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { AppLoading } from '../branding/AppLoading';

/**
 * Gate for every broker page (everything under AppShell in router.tsx): a signed-out visitor goes
 * to /login instead of seeing the workspace. This is presentation only — what a signed-in user can
 * actually read or change is enforced by the database (RLS, 0011_agency_roles.sql).
 *
 * 'not_configured' (no Supabase project in this environment) is let through: there's no sign-in to
 * send anyone to, and the app runs local-only, as before. 'loading' shows a placeholder rather than
 * redirecting, so a signed-in user isn't bounced to /login while their session is still being read.
 * 'password_recovery' is treated as signed out — /login is where that flow finishes.
 */
export function RequireBrokerAuth({ children }: { children: ReactNode }) {
  const session = useBrokerSession();
  const location = useLocation();

  if (session.status === 'loading') return <AppLoading />;
  // The site's front door is public: a signed-out visitor at / sees what RenewalIQ is (and the policies).
  if (session.status === 'signed_out' && location.pathname === '/') return <HomePage />;
  if (session.status === 'signed_out' || session.status === 'password_recovery') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
