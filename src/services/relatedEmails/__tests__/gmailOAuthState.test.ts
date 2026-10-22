import { describe, expect, it } from 'vitest';
import { STATE_TTL_MS, signState, verifyState, type OAuthState } from '../../../../supabase/functions/gmail/oauthState.ts';

// The Gmail function's OAuth state (supabase/functions/gmail/oauthState.ts). Fictional values only.
const ORIGINS = ['https://preview.example.app'];
const key = () => crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const NOW = Date.parse('2026-10-22T12:00:00Z');
const st = (over: Partial<OAuthState> = {}): OAuthState => ({ u: '00000000-0000-0000-0000-0000000000a1', r: 'https://preview.example.app/accounts', e: NOW + STATE_TTL_MS, n: 'nonce-1', ...over });
const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);

describe('Gmail OAuth state: signed, short-lived, only back to the app', () => {
  it('a state this server signed is accepted, with who started it', async () => {
    const k = await key();
    const r = await verifyState(await signState(st(), k), k, ORIGINS, NOW);
    expect(r).toEqual({ ok: true, state: st() });
  });
  it('tampered: a changed payload, a changed signature, another key, or garbage are all refused', async () => {
    const k = await key();
    const good = await signState(st(), k);
    const [payload, mac] = good.split('.');
    const otherUser = (await signState(st({ u: '00000000-0000-0000-0000-0000000000a2' }), k)).split('.')[0];
    for (const bad of [`${otherUser}.${mac}`, `${payload}.${flip(mac, 3)}`, `${flip(payload, 5)}.${mac}`, await signState(st(), await key()), 'x', '', 'a.b.c', `${payload}.`]) {
      expect((await verifyState(bad, k, ORIGINS, NOW)).ok).toBe(false);
    }
    expect(await verifyState(null, k, ORIGINS, NOW)).toEqual({ ok: false, reason: 'tampered' });
  });
  it('expired after 10 minutes', async () => {
    const k = await key();
    expect(await verifyState(await signState(st(), k), k, ORIGINS, NOW + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
  });
  it('a return address outside the app is refused even when signed', async () => {
    const k = await key();
    expect(await verifyState(await signState(st({ r: 'https://preview.example.app.evil.example/x' }), k), k, ORIGINS, NOW)).toEqual({ ok: false, reason: 'return_not_allowed' });
  });
});
