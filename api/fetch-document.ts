import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * GET /api/fetch-document?url=https://…  (Authorization: Bearer <Supabase access token>)
 *
 * Downloads a document a broker linked to, for sites that don't let a browser download their
 * files from another website (CORS) — Google Drive / Docs / Sheets, Dropbox, most file hosts.
 * The browser still checks that what comes back is a real document (see
 * src/services/ingestion/documentLinks.ts); this only fetches the bytes.
 *
 * Kept deliberately narrow so it can't be used as an open proxy or to reach internal systems:
 * signed-in RenewalIQ users only, https only, public internet addresses only (checked again on
 * every redirect), no cookies or credentials sent, a timeout, and a size cap.
 */

// Vercel caps a function's response body at 4.5 MB.
const MAX_BYTES = 4_400_000;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(mapped) === 4) {
    const [a, b] = mapped.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = mapped.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

/** https, no embedded credentials, and a host name that resolves only to public addresses. */
async function checkUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.') || /(^|\.)(localhost|local|internal)$/i.test(host)) return null;
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

async function signedIn(request: Request): Promise<boolean> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const auth = request.headers.get('authorization') ?? '';
  if (!supabaseUrl || !anonKey || !auth.startsWith('Bearer ')) return false;
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: anonKey, authorization: auth }, signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await signedIn(request))) return json(401, 'Sign in to open linked documents.');
  const target = new URL(request.url).searchParams.get('url') ?? '';

  let current = await checkUrl(target);
  if (!current) return json(400, 'Only public https links can be opened.');

  let upstream: Response | null = null;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      upstream = await fetch(current, { redirect: 'manual', signal, headers: { accept: '*/*', 'user-agent': 'Mozilla/5.0 (compatible; RenewalIQ document link)' } });
    } catch {
      return json(502, 'The site could not be reached.');
    }
    const location = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get('location') : null;
    if (!location) break;
    const next = await checkUrl(new URL(location, current).toString());
    if (!next) return json(400, 'The link redirected somewhere that is not allowed.');
    current = next;
    upstream = null;
  }
  if (!upstream) return json(502, 'The link redirected too many times.');
  if (!upstream.ok) return json(502, `The link returned HTTP ${upstream.status}.`);
  if (Number(upstream.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, 'The linked file is too large to open from a link.');

  // Read with a running cap — content-length can be missing or wrong.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = upstream.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return json(413, 'The linked file is too large to open from a link.');
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }

  const headers = new Headers({ 'cache-control': 'no-store', 'x-final-url': current.toString() });
  for (const h of ['content-type', 'content-disposition']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(body, { status: 200, headers });
}
