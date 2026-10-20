// Gmail (Related Emails, Phase 1): connect a broker's own Gmail read-only, and sync thread headers on Refresh.
// Never sends, drafts, deletes or changes mail; stores no bodies or attachments (0068).
//
//   POST {action: 'start', returnTo}  → {url}: Google's consent page (signed-in broker only)
//   GET  ?code=…&state=…              ← Google's redirect: stores the encrypted refresh token, back to the app
//   POST {action: 'refresh'}           → {status, threads}: new / changed threads since the last sync (first time:
//                                        the last 90 days), with Gmail's short snippet for matching (not stored)
//   POST {action: 'disconnect'}        → revokes the token at Google and deletes it
//
// Deploy with --no-verify-jwt (Google's redirect carries no Supabase token); every POST checks the user's token itself.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY (base64, 32 bytes), APP_ORIGINS (comma-separated
// app origins allowed as returnTo). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const KEY_B64 = Deno.env.get('GMAIL_TOKEN_KEY') ?? '';
const ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const REDIRECT_URI = `${URL_}/functions/v1/gmail`;
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly email';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FIRST_SYNC_QUERY = 'newer_than:90d -in:chats -in:drafts -in:spam -in:trash';
const CATCH_UP_QUERY = 'newer_than:7d -in:chats -in:drafts -in:spam -in:trash';
const MAX_MESSAGES = 2000;
const MAX_THREADS = 500;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));

// ── keys: AES-GCM for the refresh token, HMAC (a key derived from the same secret) for the OAuth state ──
const rawKey = () => unb64(KEY_B64);
const aesKey = () => crypto.subtle.importKey('raw', rawKey(), 'AES-GCM', false, ['encrypt', 'decrypt']);
const hmacKey = async () =>
  crypto.subtle.importKey('raw', new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode('oauth-state:'), ...rawKey()]))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function encrypt(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(text)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
async function decrypt(stored: string): Promise<string> {
  const [v, iv, ct] = stored.split(':');
  if (v !== 'v1') throw new Error('unknown token format');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(), unb64(ct)));
}
async function sign(payload: string): Promise<string> {
  return b64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(payload)))));
}

// ── Supabase (service role) ──
const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}
/** The signed-in user, checked with Supabase Auth (not just decoded). */
async function userId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
  if (!res.ok) return null;
  const u = await res.json();
  return typeof u?.id === 'string' ? u.id : null;
}

// ── Google ──
async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}
async function gmail(path: string, access: string) {
  const res = await fetch(`${GMAIL}/${path}`, { headers: { Authorization: `Bearer ${access}` } });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

async function start(uid: string, returnTo: string) {
  if (!ORIGINS.some((o) => returnTo === o || returnTo.startsWith(`${o}/`))) return json({ error: 'That return address isn’t allowed.' }, 400);
  const payload = b64url(JSON.stringify({ u: uid, r: returnTo, e: Date.now() + 10 * 60_000, n: crypto.randomUUID() }));
  const state = `${payload}.${await sign(payload)}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })}`;
  return json({ url });
}

async function callback(params: URLSearchParams) {
  const [payload, mac] = (params.get('state') ?? '').split('.');
  if (!payload || !mac || mac !== (await sign(payload))) return new Response('Invalid request.', { status: 400 });
  const st = JSON.parse(unb64url(payload)) as { u: string; r: string; e: number };
  const back = (result: string) => Response.redirect(`${st.r}${st.r.includes('?') ? '&' : '?'}gmail=${result}`, 302);
  if (Date.now() > st.e || !ORIGINS.some((o) => st.r === o || st.r.startsWith(`${o}/`))) return new Response('This link has expired. Try connecting again.', { status: 400 });
  if (params.get('error') || !params.get('code')) return back('cancelled');
  const tok = await tokenRequest({ code: params.get('code')!, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
  if (!tok.ok || !tok.body.refresh_token || !String(tok.body.scope ?? '').includes('gmail.readonly')) return back('failed');
  const profile = await gmail('profile', tok.body.access_token);
  if (!profile.body?.emailAddress) return back('failed');
  const prof = await (await db(`profiles?user_id=eq.${st.u}&select=agency_id`)).json();
  const agency = prof?.[0]?.agency_id ?? null;
  const conn = await db('gmail_connections?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: st.u, agency_id: agency, email_address: profile.body.emailAddress, status: 'connected', history_id: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  const saved = conn.ok && (await db('gmail_tokens?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: st.u, refresh_token_ciphertext: await encrypt(tok.body.refresh_token), key_version: 1, updated_at: new Date().toISOString() }),
  })).ok;
  return back(saved ? 'connected' : 'failed');
}

async function accessToken(uid: string): Promise<string | 'reconnect' | null> {
  const rows = await (await db(`gmail_tokens?user_id=eq.${uid}&select=refresh_token_ciphertext`)).json();
  if (!rows?.[0]) return null;
  const tok = await tokenRequest({ refresh_token: await decrypt(rows[0].refresh_token_ciphertext), grant_type: 'refresh_token' });
  if (!tok.ok) {
    if (tok.body?.error === 'invalid_grant') {
      await db(`gmail_connections?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'reconnect_needed', updated_at: new Date().toISOString() }) });
      return 'reconnect';
    }
    throw new Error(`token refresh failed: ${tok.body?.error ?? 'unknown'}`);
  }
  return tok.body.access_token;
}

/** Thread ids from a Gmail search, newest first, up to MAX_MESSAGES messages. */
async function search(q: string, access: string): Promise<string[]> {
  const ids: string[] = [];
  let page = '';
  for (let seen = 0; seen < MAX_MESSAGES; ) {
    const r = await gmail(`messages?${new URLSearchParams({ q, maxResults: '500', ...(page ? { pageToken: page } : {}) })}`, access);
    if (!r.body) throw new Error(`search failed: ${r.status}`);
    for (const m of r.body.messages ?? []) if (!ids.includes(m.threadId)) ids.push(m.threadId);
    seen += (r.body.messages ?? []).length;
    page = r.body.nextPageToken ?? '';
    if (!page) break;
  }
  return ids;
}

const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
function parseFrom(v: string): { name: string | null; email: string | null } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: v.trim().toLowerCase() || null };
}

async function refresh(uid: string) {
  const conns = await (await db(`gmail_connections?user_id=eq.${uid}&select=status,history_id`)).json();
  const conn = conns?.[0];
  if (!conn || conn.status === 'disconnected') return json({ status: 'not_connected', threads: [] });
  const access = await accessToken(uid);
  if (access === 'reconnect' || access === null) return json({ status: 'reconnect_needed', threads: [] });
  let threadIds: string[] = [];
  let historyId: string | null = null;
  if (conn.history_id) {
    let page = '';
    let expired = false;
    for (let i = 0; i < 10; i++) {
      const r = await gmail(`history?${new URLSearchParams({ startHistoryId: conn.history_id, historyTypes: 'messageAdded', maxResults: '500', ...(page ? { pageToken: page } : {}) })}`, access);
      if (r.status === 404) { expired = true; break; }
      if (!r.body) throw new Error(`history failed: ${r.status}`);
      for (const h of r.body.history ?? []) for (const a of h.messagesAdded ?? []) {
        const labels: string[] = a.message?.labelIds ?? [];
        if (!labels.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH' || l === 'CHAT') && !threadIds.includes(a.message.threadId)) threadIds.push(a.message.threadId);
      }
      historyId = r.body.historyId ?? historyId;
      page = r.body.nextPageToken ?? '';
      if (!page) break;
    }
    // Gmail keeps history about a week: when the cursor has expired, catch up on the last 7 days.
    if (expired) { threadIds = await search(CATCH_UP_QUERY, access); historyId = null; }
  } else {
    threadIds = await search(FIRST_SYNC_QUERY, access);
  }
  if (!historyId) historyId = (await gmail('profile', access)).body?.historyId ?? null;
  const threads: unknown[] = [];
  const ids = threadIds.slice(0, MAX_THREADS);
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async (tid) => {
      const r = await gmail(`threads/${tid}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, access);
      const msgs = (r.body?.messages ?? []).filter((m: { labelIds?: string[] }) => !(m.labelIds ?? []).some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH'));
      if (!msgs.length) return;
      msgs.sort((a: { internalDate: string }, b: { internalDate: string }) => Number(a.internalDate) - Number(b.internalDate));
      const last = msgs[msgs.length - 1];
      const from = parseFrom(header(last, 'From'));
      const subject = header(msgs[0], 'Subject') || header(last, 'Subject');
      const lastAt = new Date(Number(last.internalDate)).toISOString();
      const id = await rpc('email_record_thread', {
        p_owner: uid, p_gmail_thread_id: tid, p_subject: subject, p_from_name: from.name, p_from_email: from.email,
        p_last_message_id: last.id, p_last_message_at: lastAt, p_message_count: msgs.length,
      });
      threads.push({ id, gmailThreadId: tid, subject, fromName: from.name, fromEmail: from.email, lastMessageId: last.id, lastMessageAt: lastAt, messageCount: msgs.length, snippet: String(last.snippet ?? '').slice(0, 300) });
    }));
  }
  await db(`gmail_connections?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ history_id: historyId, last_synced_at: new Date().toISOString(), status: 'connected', updated_at: new Date().toISOString() }) });
  return json({ status: 'ok', threads, truncated: threadIds.length > MAX_THREADS });
}

async function disconnect(uid: string) {
  const rows = await (await db(`gmail_tokens?user_id=eq.${uid}&select=refresh_token_ciphertext`)).json();
  if (rows?.[0]) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(await decrypt(rows[0].refresh_token_ciphertext))}`, { method: 'POST' });
    } catch { /* deleted below either way */ }
  }
  await db(`gmail_tokens?user_id=eq.${uid}`, { method: 'DELETE' });
  await db(`gmail_connections?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'disconnected', history_id: null, updated_at: new Date().toISOString() }) });
  return json({ status: 'disconnected' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!URL_ || !SERVICE || !CLIENT_ID || !CLIENT_SECRET || rawKey().length !== 32) return json({ error: 'Gmail isn’t set up on this server.' }, 503);
  try {
    if (req.method === 'GET') return await callback(new URL(req.url).searchParams);
    if (req.method !== 'POST') return json({ error: 'Not allowed' }, 405);
    const uid = await userId(req);
    if (!uid) return json({ error: 'Sign in first.' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'start') return await start(uid, String(body.returnTo ?? ''));
    if (body.action === 'refresh') return await refresh(uid);
    if (body.action === 'disconnect') return await disconnect(uid);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('gmail:', e instanceof Error ? e.message : e);
    return json({ error: 'Gmail couldn’t be reached. Try again.' }, 502);
  }
});
