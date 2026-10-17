import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { loadPreferences, savePreferences } from '../services/preferences/viewPreferences';

/**
 * A page's view settings, remembered for the signed-in user on this device (see viewPreferences.ts).
 * Loads again when the signed-in user changes, so each person gets their own.
 */
export function useRememberedView<T extends object>(scope: string, defaults: T, sanitize: (saved: Record<string, unknown>) => Partial<T>): [T, (patch: Partial<T>) => void, () => void] {
  const userId = useAccountsStore((s) => s.currentUserId);
  const defaultsRef = useRef(defaults);
  const sanitizeRef = useRef(sanitize);
  const [state, setState] = useState<{ userId: string | null; value: T }>(() => ({ userId, value: loadPreferences(scope, userId, defaults, sanitize) }));

  // Someone else signed in (or the session finished loading): show their settings.
  useEffect(() => {
    if (state.userId !== userId) setState({ userId, value: loadPreferences(scope, userId, defaultsRef.current, sanitizeRef.current) });
  }, [scope, userId, state.userId]);

  const update = useCallback(
    (patch: Partial<T>) =>
      setState((cur) => {
        const value = { ...cur.value, ...patch };
        savePreferences(scope, cur.userId, value, defaultsRef.current);
        return { ...cur, value };
      }),
    [scope]
  );
  const reset = useCallback(() => update(defaultsRef.current), [update]);
  return [state.value, update, reset];
}
