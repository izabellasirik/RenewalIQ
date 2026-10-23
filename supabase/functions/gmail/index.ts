// Gmail (Related Emails, Phase 1): connect a broker's own Gmail read-only, and sync thread headers on Refresh.
// Never sends, drafts, deletes or changes mail; stores no bodies or attachments (0068).
//
//   POST {action: 'start', returnTo}  → {url}: Google's consent page (signed-in broker only)
//   GET  ?code=…&state=…              ← Google's redirect: stores the encrypted refresh token, back to the app
//   POST {action: 'refresh'}           → {status, threads, timing}: new / changed threads since the last sync (first time:
//                                        the last 90 days), with Gmail's short snippet for matching (not stored)
//   POST {action: 'disconnect'}        → revokes the token at Google and deletes it
//
// Deploy with --no-verify-jwt (Google's redirect carries no Supabase token); every POST checks the user's token itself.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY (base64, 32 bytes), APP_ORIGINS (comma-separated
// app origins allowed as returnTo). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { STATE_TTL_MS, allowedReturn, signState, verifyState } from './oauthState.ts';
import { mapPool, planQueue, remainingAfter, threadCounterpart, withRetry, type FetchOutcome } from './syncPlan.ts';
const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const KEY_B64 = Deno.env.get('GMAIL_TOKEN_KEY') ?? '';
const ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const REDIRECT_URI = `${URL_}/functions/v1/gmail`;
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly'; // only scope requested; the mailbox address comes from Gmail's profile
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FIRST_SYNC_QUERY = 'newer_than:90d -in:chats -in:drafts -in:spam -in:trash';
const CATCH_UP_QUERY = 'newer_than:7d -in:chats -in:drafts -in:spam -in:trash';
const MAX_MESSAGES = 2000;
const MAX_THREADS = 500;
const FETCH_CONCURRENCY = 10; // threads.get costs 10 of Gmail's 250 quota units per user per second; 429s are retried

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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
// Gmail calls retry rate limits and server errors (backing off); other failures are returned, never ignored.
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
async function gmail(path: string, access: string) {
  return await withRetry(async () => {
    const res = await fetch(`${GMAIL}/${path}`, { headers: { Authorization: `Bearer ${access}` } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }, sleep);
}

// Gmail is for agency members only (0069's rule, checked here too because this function uses the service role).
async function isMember(uid: string): Promise<boolean> {
  const rows = await (await db(`profiles?user_id=eq.${uid}&select=agency_id`)).json();
  return !!rows?.[0]?.agency_id;
}

async function start(uid: string, returnTo: string) {
  if (!(await isMember(uid))) return json({ error: 'Join your agency to connect Gmail.' }, 403);
  if (!allowedReturn(returnTo, ORIGINS)) return json({ error: 'That return address isn’t allowed.' }, 400);
  const state = await signState({ u: uid, r: returnTo, e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() }, await hmacKey());
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', state })}`;
  return json({ url });
}

// Google's return. Nothing is connected here: the encrypted token is parked (single use, one per
// state) and the browser goes back to the app, where the SAME signed-in user must complete it.
async function callback(params: URLSearchParams) {
  const checked = await verifyState(params.get('state'), await hmacKey(), ORIGINS);
  if (!checked.ok) return new Response(checked.reason === 'expired' ? 'This link has expired. Try connecting again.' : 'Invalid request.', { status: 400 });
  const st = checked.state;
  const back = (query: string) => Response.redirect(`${st.r}${st.r.includes('?') ? '&' : '?'}${query}`, 302);
  if (params.get('error') || !params.get('code')) return back('gmail=cancelled');
  const tok = await tokenRequest({ code: params.get('code')!, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
  if (!tok.ok || !tok.body.refresh_token || !String(tok.body.scope ?? '').includes('gmail.readonly')) return back('gmail=failed');
  const profile = await gmail('profile', tok.body.access_token);
  if (!profile.body?.emailAddress) return back('gmail=failed');
  const res = await db('rpc/gmail_oauth_stash', {
    method: 'POST',
    body: JSON.stringify({ p_nonce: st.n, p_user: st.u, p_email: profile.body.emailAddress, p_ciphertext: await encrypt(tok.body.refresh_token), p_expires: new Date(st.e).toISOString() }),
  });
  if (!res.ok) return new Response('Invalid request.', { status: 400 }); // replay of a used state
  return back(`gmail=complete&gmail_pending=${encodeURIComponent(await res.json())}`);
}

// The app finishes the connection as the signed-in user; the database checks it's the user who started it.
async function complete(uid: string, pending: string) {
  if (!/^[0-9a-f-]{36}$/i.test(pending)) return json({ error: 'This connection link isn’t valid. Try connecting again.' }, 400);
  if (!(await isMember(uid))) return json({ error: 'Join your agency to connect Gmail.' }, 403);
  const res = await db('rpc/gmail_oauth_complete', { method: 'POST', body: JSON.stringify({ p_pending: pending, p_user: uid }) });
  if (!res.ok) throw new Error(`gmail_oauth_complete: ${res.status}`);
  const reason = await res.json();
  if (reason === 'connected') return json({ status: 'connected' });
  if (reason === 'no_agency') return json({ error: 'Join your agency to connect Gmail.' }, 403);
  return json({ error: reason === 'mismatch' ? 'This Gmail connection was started by a different RenewalIQ user, so it wasn’t connected.' : 'This connection link has expired or was already used. Try connecting again.' }, reason === 'mismatch' ? 403 : 400);
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

/** Thread ids from a Gmail search, newest first, up to MAX_MESSAGES messages; `capped` when more matched. */
async function search(q: string, access: string): Promise<{ ids: string[]; capped: boolean }> {
  const ids: string[] = [];
  let page = '';
  for (let seen = 0; ; ) {
    const r = await gmail(`messages?${new URLSearchParams({ q, maxResults: '500', ...(page ? { pageToken: page } : {}) })}`, access);
    if (!r.body) throw new Error(`search failed: ${r.status}`);
    for (const m of r.body.messages ?? []) if (!ids.includes(m.threadId)) ids.push(m.threadId);
    seen += (r.body.messages ?? []).length;
    page = r.body.nextPageToken ?? '';
    if (!page) return { ids, capped: false };
    if (seen >= MAX_MESSAGES) return { ids, capped: true };
  }
}

const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

async function refresh(uid: string) {
  // Durations (ms) and counts only: never mailbox content, addresses, ids or tokens.
  const t0 = performance.now();
  const ms: Record<string, number> = {};
  const lap = (k: string, from: number) => (ms[k] = Math.round(performance.now() - from));
  const [member, conns] = await Promise.all([
    isMember(uid),
    db(`gmail_connections?user_id=eq.${uid}&select=status,history_id,email_address,sync_backlog`).then((r) => r.json()),
  ]);
  lap('checks', t0);
  if (!member) return json({ error: 'Join your agency to use Gmail in RenewalIQ.' }, 403);
  const conn = conns?.[0];
  if (!conn || conn.status === 'disconnected') return json({ status: 'not_connected', threads: [] });
  let t = performance.now();
  const access = await accessToken(uid);
  lap('token', t);
  if (access === 'reconnect' || access === null) return json({ status: 'reconnect_needed', threads: [] });
  t = performance.now();

  // 1. What changed since the last position (or the first 90 days). Never moves the position past mail
  //    it hasn't queued: everything found goes into the queue, which carries over between Refreshes.
  let newIds: string[] = [];
  let historyId: string | null = null;
  let capped = false;
  let catchUp = !conn.history_id;
  if (conn.history_id) {
    let page = '';
    for (let i = 0; ; i++) {
      const r = await gmail(`history?${new URLSearchParams({ startHistoryId: conn.history_id, historyTypes: 'messageAdded', maxResults: '500', ...(page ? { pageToken: page } : {}) })}`, access);
      if (r.status === 404) { catchUp = true; break; } // Gmail keeps history about a week
      if (!r.body) throw new Error(`history failed: ${r.status}`);
      for (const h of r.body.history ?? []) for (const a of h.messagesAdded ?? []) {
        const labels: string[] = a.message?.labelIds ?? [];
        if (!labels.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH' || l === 'CHAT')) newIds.push(a.message.threadId);
      }
      historyId = r.body.historyId ?? historyId;
      page = r.body.nextPageToken ?? '';
      if (!page) break;
      if (i >= 50) { catchUp = true; break; } // too much history to page through: catch up by search instead
    }
  }
  if (catchUp) {
    const found = await search(conn.history_id ? CATCH_UP_QUERY : FIRST_SYNC_QUERY, access);
    newIds = found.ids;
    capped = found.capped;
    historyId = null;
  }
  if (!historyId) historyId = (await gmail('profile', access)).body?.historyId ?? conn.history_id ?? null;
  lap('list', t);

  // 2. Fetch up to MAX_THREADS from the queue (new first, then what's left from before), FETCH_CONCURRENCY
  //    at a time: each worker takes the next thread as soon as it's done (no waiting for the slowest of a batch).
  const queue = planQueue(newIds, Array.isArray(conn.sync_backlog) ? conn.sync_backlog : []);
  const batch = queue.slice(0, MAX_THREADS);
  const outcomes = new Map<string, FetchOutcome>();
  const threads: unknown[] = [];
  let gmailMs = 0;
  let saveMs = 0;
  t = performance.now();
  await mapPool(batch, FETCH_CONCURRENCY, async (tid) => {
    let s = performance.now();
    const r = await gmail(`threads/${tid}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, access);
    gmailMs += performance.now() - s;
    if (r.status === 404) return void outcomes.set(tid, 'gone');
    if (!r.body) return void outcomes.set(tid, 'failed');
    const msgs = (r.body.messages ?? []).filter((m: { labelIds?: string[] }) => !(m.labelIds ?? []).some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH'));
    if (!msgs.length) return void outcomes.set(tid, 'gone');
    msgs.sort((a: { internalDate: string }, b: { internalDate: string }) => Number(a.internalDate) - Number(b.internalDate));
    const last = msgs[msgs.length - 1];
    // Who the broker is emailing with — not the broker's own reply.
    const withWhom = threadCounterpart(msgs.map((m: { internalDate: string; payload?: { headers?: { name: string; value: string }[] } }) => ({ from: header(m, 'From'), to: header(m, 'To'), internalDate: m.internalDate })), conn.email_address ?? '');
    const subject = header(msgs[0], 'Subject') || header(last, 'Subject');
    const lastAt = new Date(Number(last.internalDate)).toISOString();
    s = performance.now();
    try {
      const id = await rpc('email_record_thread', {
        p_owner: uid, p_gmail_thread_id: tid, p_subject: subject, p_from_name: withWhom.name, p_from_email: withWhom.email,
        p_last_message_id: last.id, p_last_message_at: lastAt, p_message_count: msgs.length,
      });
      threads.push({ id, gmailThreadId: tid, subject, fromName: withWhom.name, fromEmail: withWhom.email, lastMessageId: last.id, lastMessageAt: lastAt, messageCount: msgs.length, snippet: String(last.snippet ?? '').slice(0, 300) });
      outcomes.set(tid, 'ok');
    } catch (e) {
      console.error('gmail: record thread failed', e instanceof Error ? e.message : e);
      outcomes.set(tid, 'failed');
    }
    saveMs += performance.now() - s;
  });
  lap('fetchAndSave', t);
  const backlog = remainingAfter(queue, MAX_THREADS, outcomes).slice(0, 5000);
  const failed = [...outcomes.values()].filter((o) => o === 'failed').length;
  t = performance.now();
  await db(`gmail_connections?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ history_id: historyId, sync_backlog: backlog, last_synced_at: new Date().toISOString(), status: 'connected', updated_at: new Date().toISOString() }) });
  lap('cursor', t);
  ms.gmailCallsSum = Math.round(gmailMs);
  ms.recordCallsSum = Math.round(saveMs);
  lap('total', t0);
  const counts = { queued: queue.length, fetched: batch.length, recorded: threads.length, failed, remaining: backlog.length, catchUp: catchUp ? 1 : 0 };
  console.log('gmail refresh timing', JSON.stringify({ ms, counts }));
  return json({ status: 'ok', threads, remaining: backlog.length, failed, olderNotFetched: capped, timing: { ms, counts } });
}

async function disconnect(uid: string) {
  const rows = await (await db(`gmail_tokens?user_id=eq.${uid}&select=refresh_token_ciphertext`)).json();
  if (rows?.[0]) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(await decrypt(rows[0].refresh_token_ciphertext))}`, { method: 'POST' });
    } catch { /* deleted below either way */ }
  }
  // Access revoked at Google above; now delete everything RenewalIQ stored for this mailbox (0071).
  const forgot = await db('rpc/gmail_forget_mailbox', { method: 'POST', body: JSON.stringify({ p_user: uid }) }); // returns no content
  if (!forgot.ok) throw new Error(`gmail_forget_mailbox: ${forgot.status}`);
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
    if (body.action === 'complete') return await complete(uid, String(body.pending ?? ''));
    if (body.action === 'refresh') return await refresh(uid);
    if (body.action === 'disconnect') return await disconnect(uid);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('gmail:', e instanceof Error ? e.message : e);
    return json({ error: 'Gmail couldn’t be reached. Try again.' }, 502);
  }
});
