import { BrandLogo } from './Logo';

/**
 * The full-screen state while RenewalIQ starts (session, access and profile checks): the logo on the
 * app's background with a gentle pulse. Every startup step shows this same screen, so moving from
 * one to the next doesn't flicker; index.html shows the same mark before the app's code has loaded.
 */
export function AppLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[var(--color-ink-50)]" role="status" aria-busy="true" data-testid="app-loading">
      <BrandLogo size={48} wordmark={false} className="animate-pulse" />
      <span className="sr-only">Loading RenewalIQ…</span>
    </div>
  );
}
