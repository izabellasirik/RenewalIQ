// The OAuth `state` sent to Google and checked on its return: who started the connection, where to
// send them back, when it expires, and a one-time nonce — HMAC-signed so it can't be altered. The
// signature is checked with crypto.subtle.verify (constant time). Pure: no Deno or env access, so it
// runs under Deno (the function) and Node (the tests).

export interface OAuthState {
  /** The user who started the connection. */
  u: string;
  /** Where to send them back (must be an allowed app origin). */
  r: string;
  /** Expiry, ms since epoch. */
  e: number;
  /** One-time nonce: a state is accepted once (gmail_oauth_stash). */
  n: string;
}

export const STATE_TTL_MS = 10 * 60_000;

const enc = new TextEncoder();
const toB64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

export const allowedReturn = (returnTo: string, origins: string[]) => origins.some((o) => returnTo === o || returnTo.startsWith(`${o}/`));

export async function signState(st: OAuthState, key: CryptoKey): Promise<string> {
  const payload = toB64url(enc.encode(JSON.stringify(st)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${toB64url(mac)}`;
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: 'tampered' | 'expired' | 'return_not_allowed' };

export async function verifyState(raw: string | null, key: CryptoKey, origins: string[], now = Date.now()): Promise<StateCheck> {
  const parts = (raw ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'tampered' };
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', key, fromB64url(parts[1]), enc.encode(parts[0]));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'tampered' };
  let st: OAuthState;
  try {
    st = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  } catch {
    return { ok: false, reason: 'tampered' };
  }
  if (typeof st?.u !== 'string' || typeof st.r !== 'string' || typeof st.e !== 'number' || typeof st.n !== 'string') return { ok: false, reason: 'tampered' };
  if (now > st.e) return { ok: false, reason: 'expired' };
  if (!allowedReturn(st.r, origins)) return { ok: false, reason: 'return_not_allowed' };
  return { ok: true, state: st };
}
