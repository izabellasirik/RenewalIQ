import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase/client';
import { checkIsAdmin } from '../services/supabase/adminAuth';

export type AdminSessionStatus = 'loading' | 'not_configured' | 'signed_out' | 'unauthorized' | 'admin' | 'password_recovery';

export interface AdminSession {
  status: AdminSessionStatus;
  email: string | null;
}

/**
 * Tracks whether the current visitor is a signed-in admin, deferring entirely to the database
 * (is_admin(), backed by RLS) rather than any client-side flag. Callers must not fetch admin data
 * (the request queue, etc.) until status === 'admin' — 'loading'/'signed_out'/'unauthorized' should
 * render nothing but the appropriate gate, per the admin route's authorization requirement.
 */
export function useAdminSession(): AdminSession {
  const [status, setStatus] = useState<AdminSessionStatus>(isSupabaseConfigured ? 'loading' : 'not_configured');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function evaluate(sessionEmail: string | null) {
      if (!sessionEmail) {
        if (!cancelled) {
          setStatus('signed_out');
          setEmail(null);
        }
        return;
      }
      const admin = await checkIsAdmin();
      if (cancelled) return;
      setEmail(sessionEmail);
      setStatus(admin ? 'admin' : 'unauthorized');
    }

    supabase.auth.getSession().then(({ data }) => evaluate(data.session?.user.email ?? null));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // Arriving via the "forgot password" email link: Supabase establishes a temporary recovery
      // session and fires this event before any normal sign-in happened. Show the "set a new
      // password" form instead of treating it as a regular admin (or non-admin) session.
      if (event === 'PASSWORD_RECOVERY') {
        if (!cancelled) {
          setEmail(session?.user.email ?? null);
          setStatus('password_recovery');
        }
        return;
      }
      evaluate(session?.user.email ?? null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { status, email };
}
