import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authLinkError, authRedirectUrl, captureAuthLinkState, clearPasswordRecovery, passwordRecoveryPending } from '../authRedirect';

// A minimal browser: the page's address and this tab's sessionStorage.
function openAt(url: string) {
  const u = new URL(url);
  vi.stubGlobal('window', { location: { origin: u.origin, hash: u.hash, search: u.search } });
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

describe('auth email links', () => {
  it('return to the site the person is on — production, preview or localhost — never a fixed host', () => {
    openAt('https://renewal-iq.example.com/login');
    expect(authRedirectUrl('/login')).toBe('https://renewal-iq.example.com/login');
    openAt('https://renewal-iq-git-branch-team.vercel.app/signup');
    expect(authRedirectUrl('invite/abc')).toBe('https://renewal-iq-git-branch-team.vercel.app/invite/abc');
    openAt('http://localhost:5173/');
    expect(authRedirectUrl('/login')).toBe('http://localhost:5173/login');
  });

  it('a password-reset link is remembered until the new password is saved', () => {
    openAt('https://rq.example.com/login#access_token=t&refresh_token=r&type=recovery');
    captureAuthLinkState();
    expect(passwordRecoveryPending()).toBe(true);
    clearPasswordRecovery();
    expect(passwordRecoveryPending()).toBe(false);
  });

  it('a sign-up confirmation link is not treated as a reset', () => {
    openAt('https://rq.example.com/login#access_token=t&refresh_token=r&type=signup');
    captureAuthLinkState();
    expect(passwordRecoveryPending()).toBe(false);
  });

  it('an expired link says so', () => {
    openAt('https://rq.example.com/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    captureAuthLinkState();
    expect(authLinkError()).toMatch(/expired or was already used/);
  });
});
