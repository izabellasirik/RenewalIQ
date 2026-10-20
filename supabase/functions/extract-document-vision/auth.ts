// Who is calling extract-document-vision. The platform's JWT check (verify_jwt) only proves a token
// was signed by this project — the public anon key passes it too — so every paid read must also be
// tied to a real, signed-in broker here, before the body is parsed or the provider is called.
//
// Plain TypeScript (fetch only, no Deno APIs) so the app's unit tests can exercise it.

import { userIdFromJwt } from './store.ts';

export type Caller = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 503; error: string };

export const AUTH_MESSAGES = {
  signIn: 'Sign in to use AI document reading.',
  notAllowed: 'AI document reading needs a confirmed RenewalIQ account.',
  unavailable: 'Could not confirm your sign-in — try again in a moment.',
  noAgency: 'AI document reading is for members of a RenewalIQ agency. Join your agency first.',
} as const;

/**
 * A caller is allowed only when the token is a signed-in user's (role authenticated — never the
 * anon or service key), Supabase Auth still knows that user, the email is confirmed, and the user
 * isn't an anonymous sign-in or banned. Anything else is refused without a provider call. If Auth
 * can't be reached the read is refused too (fail closed): this check guards a paid API.
 */
export async function verifyCaller(authorization: string | null, supabaseUrl: string | undefined, apiKey: string | undefined, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now()): Promise<Caller> {
  // Cheap first gate: the anon key, a missing header or a malformed token never cost a network call.
  const claimed = userIdFromJwt(authorization);
  if (!claimed || !authorization) return { ok: false, status: 401, error: AUTH_MESSAGES.signIn };
  if (!supabaseUrl || !apiKey) {
    console.error('extract-document-vision: SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot verify callers');
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: authorization } });
  } catch (err) {
    console.error('extract-document-vision: auth check failed', String(err));
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, status: 401, error: AUTH_MESSAGES.signIn };
  if (!res.ok) {
    console.error('extract-document-vision: auth check returned', res.status);
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  let user: { id?: unknown; email_confirmed_at?: unknown; is_anonymous?: unknown; banned_until?: unknown };
  try {
    user = await res.json();
  } catch {
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  if (user?.id !== claimed) return { ok: false, status: 401, error: AUTH_MESSAGES.signIn };
  const banned = typeof user.banned_until === 'string' && Date.parse(user.banned_until) > now();
  if (user.is_anonymous === true || !user.email_confirmed_at || banned) return { ok: false, status: 403, error: AUTH_MESSAGES.notAllowed };
  // Invitation-only (0069): an agency member or the founder, asked of the database as this caller.
  // Anything but a plain `true` — no such function, an error, unreachable — is refused (fail closed).
  let access: Response;
  try {
    access = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/has_product_access`, { method: 'POST', headers: { apikey: apiKey, Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' });
  } catch (err) {
    console.error('extract-document-vision: access check failed', String(err));
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  if (!access.ok) {
    console.error('extract-document-vision: access check returned', access.status);
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  let allowed: unknown;
  try {
    allowed = await access.json();
  } catch {
    return { ok: false, status: 503, error: AUTH_MESSAGES.unavailable };
  }
  if (allowed !== true) return { ok: false, status: 403, error: AUTH_MESSAGES.noAgency };
  return { ok: true, userId: claimed };
}
