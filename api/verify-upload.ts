import { SIGNATURE_BYTES, checkUpload } from './_lib/fileSignature.js';

/**
 * POST /api/verify-upload  { bucket, path }
 *
 * Checks a just-uploaded file's real contents on the server: reads its first 4 KB from private
 * Storage with the service key and checks them against its extension (api/_lib/fileSignature.ts),
 * plus its size. A just-uploaded file that isn't what it claims is deleted. A file that passes is recorded in
 * upload_verifications (0048) — once enforcement is switched on, a client upload can only be
 * attached to a request or intake submission after this.
 *
 *  - intake-uploads (client request / intake uploads, no login): the path must be a request or
 *    intake folder (random, unguessable ids). Knowing a path proves the caller made the upload.
 *  - submission-documents (broker uploads): a signed-in user, and only inside their own folder.
 *
 * Vercel environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 * VITE_SUPABASE_ANON_KEY (to check a broker's session). Without them: 501, and the app carries on
 * as before (enforcement stays off until this is configured).
 */

export interface VerifyEnv {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const CLIENT_PATH = /^[A-Za-z0-9_-]{8,80}\/[A-Za-z0-9_-]{4,80}\/[^/]{1,255}$/;
const BROKER_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_.:-]{1,100}\/[A-Za-z0-9_.:-]{1,100}\/[^/]{1,255}$/i;

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
// '.' and '..' would be resolved by the URL and point outside the caller's folder.
const hasDotSegment = (p: string) => p.split('/').some((s) => s === '.' || s === '..');

/**
 * Only a file stored in the last few minutes (the upload this check follows) is deleted when it
 * fails. An older file — e.g. one a client sent before these limits existed and a broker already
 * has — is refused but left alone, so re-checking a known path can never remove someone's document.
 */
export const DELETE_WINDOW_MS = 15 * 60_000;
const justUploaded = (lastModified: string | null, now: number) => {
  const t = lastModified ? Date.parse(lastModified) : NaN;
  return Number.isFinite(t) && now - t <= DELETE_WINDOW_MS;
};

export async function handleVerifyUpload(request: Request, env: VerifyEnv, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json(501, { notConfigured: true, error: 'Upload verification is not configured for this deployment.' });

  let body: { bucket?: unknown; path?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // handled below
  }
  const bucket = body.bucket;
  const path = typeof body.path === 'string' ? body.path : '';
  if (hasDotSegment(path)) return json(400, { error: 'Unknown upload.' });
  if (bucket === 'intake-uploads') {
    if (!CLIENT_PATH.test(path)) return json(400, { error: 'Unknown upload.' });
  } else if (bucket === 'submission-documents') {
    if (!BROKER_PATH.test(path)) return json(400, { error: 'Unknown upload.' });
    const anonKey = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY;
    const auth = request.headers.get('authorization') ?? '';
    if (!anonKey || !auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first.' });
    const me = await fetchImpl(`${url}/auth/v1/user`, { headers: { apikey: anonKey, authorization: auth }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const user = me?.ok ? ((await me.json()) as { id?: string }) : null;
    if (!user?.id || path.split('/')[0] !== user.id) return json(403, { error: 'Not your upload.' });
  } else {
    return json(400, { error: 'Unknown upload.' });
  }

  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const object = `${url}/storage/v1/object/${bucket}/${encodePath(path)}`;
  let res: Response;
  try {
    res = await fetchImpl(object, { headers: { ...headers, range: `bytes=0-${SIGNATURE_BYTES - 1}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return json(502, { error: 'The file could not be checked right now.' });
  }
  if (res.status === 404 || res.status === 400) return json(404, { error: 'Upload not found.' });
  if (!res.ok) return json(502, { error: 'The file could not be checked right now.' });
  const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, SIGNATURE_BYTES);
  // 206: "bytes 0-4095/123456" carries the full size; 200: the whole (small) file came back.
  const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? (res.status === 200 ? bytes.length : NaN));
  const name = path.split('/').pop() ?? '';
  const verdict = checkUpload(name, Number.isFinite(total) ? total : bytes.length, bytes);

  if (!verdict.ok) {
    if (!justUploaded(res.headers.get('last-modified'), now)) return json(422, { rejected: true, error: verdict.reason });
    await fetchImpl(`${url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }), signal: AbortSignal.timeout(8_000) }).catch(() => null);
    return json(422, { rejected: true, error: verdict.reason });
  }
  const record = await fetchImpl(`${url}/rest/v1/upload_verifications`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ bucket_id: bucket, object_name: path, kind: verdict.kind, size_bytes: Number.isFinite(total) ? total : null }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!record?.ok) return json(502, { error: 'The file could not be checked right now.' });
  return json(200, { ok: true, kind: verdict.kind });
}

export async function POST(request: Request): Promise<Response> {
  return handleVerifyUpload(request, process.env as VerifyEnv);
}
