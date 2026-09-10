import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { supabase } from './services/supabase/client';
import { useAccountsStore } from './state/useAccountsStore';

/**
 * Keeps useAccountsStore.currentUserId in sync with the live Supabase session — the store never
 * reads Supabase auth state itself, so every cloud-sync decision (is this account mine to push?)
 * is driven from here rather than a persisted, potentially-stale value. Signing in triggers a
 * hydration pull (see hydrateCloudSubmissions) so a broker's cloud submissions appear immediately
 * on this device; signing out clears currentUserId so cloud writes stop, but never touches local
 * state — a signed-out broker's local-only submissions are exactly as they were.
 */
function useBrokerCloudBootstrap() {
  const setCurrentUserId = useAccountsStore((s) => s.setCurrentUserId);
  const hydrateCloudSubmissions = useAccountsStore((s) => s.hydrateCloudSubmissions);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id ?? null;
      setCurrentUserId(userId);
      if (userId) hydrateCloudSubmissions();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') return; // handled entirely on /login, not a normal session change
      const userId = session?.user.id ?? null;
      setCurrentUserId(userId);
      // Only re-pull on an actual sign-in — NOT on every event this fires for (e.g. TOKEN_REFRESHED
      // every ~hour while a tab stays open). Re-fetching then would risk racing an edit whose
      // syncNow push hasn't landed yet and overwriting it with the slightly-stale cloud read.
      if (event === 'SIGNED_IN' && userId) hydrateCloudSubmissions();
    });

    return () => subscription.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function App() {
  useBrokerCloudBootstrap();
  return <RouterProvider router={router} />;
}

export default App;
