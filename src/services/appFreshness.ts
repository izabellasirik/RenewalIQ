import { useEffect, useRef, useState } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { reloadReferralSources } from '../hooks/useReferralSources';
import { reloadOtherReferrals } from '../hooks/useOtherReferrals';
import { reloadNoteSummaries } from '../hooks/useNoteSummaries';
import { reloadBrokerFeeShares } from '../hooks/useBrokerFeeShare';
import { reloadLedger, reloadMyCommissions } from '../hooks/useLedger';
import { reloadAgentCommissionRates } from '../hooks/useAgentCommission';

/**
 * Keeping an open RenewalIQ current, so nobody has to remember to refresh the page:
 *  - a newer version released while it was open is noticed (/version.json, written by the build) — the app
 *    reloads itself at the next page change when nothing would be lost, and shows a "Refresh" bar meanwhile;
 *  - other people's changes are pulled in the background when the tab comes back into view and every few minutes.
 *    Anything not saved on this device is kept (the cloud load merges, see hydrateCloudSubmissions).
 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const VERSION_CHECK_MS = 5 * 60_000;
const REFRESH_EVERY_MS = 5 * 60_000;
const REFRESH_ON_RETURN_AFTER_MS = 60_000;
/** Pages that load their own data listen for this to load it again. */
export const DATA_REFRESH_EVENT = 'renewaliq:data-refresh';

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: unknown };
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/** Nothing is being saved right now. */
export function nothingSaving(): boolean {
  return !Object.values(useAccountsStore.getState().syncStatus).some((s) => s === 'saving' || s === 'retrying');
}

/** Reloading now loses nothing: nothing being saved, nobody typing, no dialog open. */
export function safeToReloadNow(): boolean {
  if (!nothingSaving()) return false;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return false;
  return !document.querySelector('[role="dialog"]');
}

/** True once a newer version than this one has been released. */
export function useNewVersionAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (APP_VERSION === 'dev' || import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      const latest = await fetchLatestVersion();
      if (!stopped && latest && latest !== APP_VERSION) setAvailable(true);
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const timer = setInterval(() => void check(), VERSION_CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return available;
}

let lastRefresh = Date.now();

/** Pulls everyone's latest changes: accounts, partners, summaries, broker fees, commissions; pages reload theirs. */
export async function refreshData(): Promise<void> {
  const st = useAccountsStore.getState();
  if (!st.currentUserId || !nothingSaving()) return;
  lastRefresh = Date.now();
  const me = st.currentUserId;
  const admin = st.agencyAccess?.role === 'admin';
  await Promise.allSettled([
    st.hydrateCloudSubmissions(),
    reloadReferralSources(),
    reloadOtherReferrals(),
    reloadNoteSummaries(),
    reloadBrokerFeeShares(me),
    reloadAgentCommissionRates(me),
    admin ? reloadLedger(me) : reloadMyCommissions(me),
  ]);
  window.dispatchEvent(new Event(DATA_REFRESH_EVENT));
}

/** Background refresh: when the tab comes back after a minute or more, and every few minutes while it's open. */
export function useBackgroundRefresh(): void {
  const signedIn = useAccountsStore((s) => !!s.currentUserId);
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh >= REFRESH_ON_RETURN_AFTER_MS) void refreshData();
    };
    const timer = setInterval(() => document.visibilityState === 'visible' && void refreshData(), REFRESH_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn]);
}

/** Page-level loaders: run `load` again whenever the data is refreshed in the background. */
export function useOnDataRefresh(load: () => void): void {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener(DATA_REFRESH_EVENT, on);
    return () => window.removeEventListener(DATA_REFRESH_EVENT, on);
  }, []);
}
