import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientRequestUrl, compactToken, expandToken, intakeUrl, isPublicLinkPath, publicAppUrl } from '../publicLinks';

const T = '4811a116-bada-4c0d-a6ab-c1dbcbb2272c';

describe('public links', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('short code round-trips to the same token', () => {
    expect(compactToken(T)).toBe('4811a116bada4c0da6abc1dbcbb2272c');
    expect(expandToken(compactToken(T))).toBe(T);
    expect(expandToken(T)).toBe(T); // old links keep working
  });

  it('uses the configured public address, not the preview hostname', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://app.renewaliq.com/');
    expect(publicAppUrl()).toBe('https://app.renewaliq.com');
    expect(clientRequestUrl(T)).toBe('https://app.renewaliq.com/r/4811a116bada4c0da6abc1dbcbb2272c');
    expect(intakeUrl(T)).toBe('https://app.renewaliq.com/i/4811a116bada4c0da6abc1dbcbb2272c');
  });

  it('falls back to where the app is open', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', '');
    vi.stubGlobal('window', { location: { origin: 'https://renewal-iq-git-branch-someone.vercel.app' } });
    expect(publicAppUrl()).toBe('https://renewal-iq-git-branch-someone.vercel.app');
    vi.unstubAllGlobals();
  });

  it('copied client links are the public /r and /i forms, never an internal app address', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', '');
    vi.stubGlobal('window', { location: { origin: 'https://renewal-iq.example.app' } });
    const req = new URL(clientRequestUrl(T));
    const intake = new URL(intakeUrl(T));
    expect(req.pathname).toBe('/r/4811a116bada4c0da6abc1dbcbb2272c');
    expect(intake.pathname).toBe('/i/4811a116bada4c0da6abc1dbcbb2272c');
    for (const u of [req, intake]) {
      expect(u.search).toBe('');
      expect(u.hash).toBe('');
      expect(isPublicLinkPath(u.pathname)).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  it('knows which paths are public client links', () => {
    for (const p of ['/r/4811a116bada4c0da6abc1dbcbb2272c', '/i/abc', '/request/' + T, '/intake/' + T, '/invite/x', '/r/abc/']) {
      expect(isPublicLinkPath(p)).toBe(true);
    }
    for (const p of ['/', '/login', '/accounts/1', '/intake-links', '/r', '/r/', '/accounts/r/abc', '/admin']) {
      expect(isPublicLinkPath(p)).toBe(false);
    }
  });
});
