import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase/client';

export type BrokerSessionStatus = 'loading' | 'not_configured' | 'signed_out' | 'signed_in' | 'password_recovery';

export interface BrokerSession {
  status: BrokerSessionStatus;
  email: string | null;
  userId: string | null;
}

/**
 * Tracks the signed-in broker (if any) — completely separate from useAdminSession. A broker being
 * `signed_in` here says nothing about admin access; nothing in this hook touches admin_users or
 * is_admin(). Callers must not treat 'loading' as 'signed_out' — the local-only experience should
 * keep working during 'loading' rather than flashing a sign-in prompt.
 */
export function useBrokerSession(): BrokerSession {
  const [status, setStatus] = useState<BrokerSessionStatus>(isSupabaseConfigured ? 'loading' : 'not_configured');
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    function apply(sessionEmail: string | null, id: string | null) {
      if (cancelled) return;
      setEmail(sessionEmail);
      setUserId(id);
      setStatus(sessionEmail ? 'signed_in' : 'signed_out');
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session?.user.email ?? null, data.session?.user.id ?? null));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // Arriving via the "forgot password" email link — show the "set a new password" form
      // instead of a normal signed-in state until that's completed.
      if (event === 'PASSWORD_RECOVERY') {
        if (!cancelled) {
          setEmail(session?.user.email ?? null);
          setUserId(session?.user.id ?? null);
          setStatus('password_recovery');
        }
        return;
      }
      apply(session?.user.email ?? null, session?.user.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { status, email, userId };
}
