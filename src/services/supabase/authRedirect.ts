/**
 * Where Supabase auth emails (sign-up confirmation, password reset, invitations) send people back
 * to, and what the app learns when someone arrives from one of those links.
 *
 * The return address is always the site the person is using right now — production on production,
 * the preview on a preview, localhost in development — never a fixed URL. Supabase only honours it
 * if it's on the project's Redirect URLs allow-list (Authentication → URL Configuration); anything
 * else falls back to the Site URL. See SUPABASE_SETUP.md, "Auth email links".
 */

export function authRedirectUrl(path: string): string {
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

const RECOVERY_KEY = 'renewaliq.passwordRecovery';
let linkError: string | null = null;

/**
 * Runs once, before the Supabase client reads (and clears) the link's #access_token… from the URL.
 * A password-reset link must end on "Set a new password" — not quietly sign the person in — so that
 * is remembered for this tab until the new password is saved. An expired or already-used link
 * arrives as #error=…; its reason is kept so the sign-in page can say so.
 */
export function captureAuthLinkState(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(`${window.location.hash.replace(/^#/, '')}&${window.location.search.replace(/^\?/, '')}`);
  if (params.get('type') === 'recovery') {
    try {
      sessionStorage.setItem(RECOVERY_KEY, '1');
    } catch {
      // private mode: the PASSWORD_RECOVERY event still covers the common case
    }
  }
  const code = params.get('error_code');
  if (code || params.get('error')) {
    linkError =
      code === 'otp_expired'
        ? 'That email link has expired or was already used. Request a new one below.'
        : (params.get('error_description')?.replace(/\+/g, ' ') ?? 'That email link could not be used. Request a new one below.');
  }
}

export function passwordRecoveryPending(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearPasswordRecovery(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // nothing to clear
  }
}

/** The reason an auth email link failed, if the page was opened from one. */
export function authLinkError(): string | null {
  return linkError;
}
