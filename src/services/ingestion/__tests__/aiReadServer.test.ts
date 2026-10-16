import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_GLOBAL_DAILY_LIMIT, GLOBAL_LIMIT_MESSAGE, PAUSED_MESSAGE, handleRead, pausedRefusal, type ModelCallResult } from '../../../../supabase/functions/extract-document-vision/handler.ts';
import { AUTH_MESSAGES, verifyCaller, type Caller } from '../../../../supabase/functions/extract-document-vision/auth.ts';
import { costUsd, priceFor } from '../../../../supabase/functions/extract-document-vision/pricing.ts';
import { cacheKeyFor, restStore, sanitizeContext, userIdFromJwt, type ClaimState, type Store, type UsageRow } from '../../../../supabase/functions/extract-document-vision/store.ts';

/** An in-memory stand-in for ai_read_cache / ai_usage_events with the same claim rules as 0046. */
function memoryStore() {
  const cache = new Map<string, { status: 'pending' | 'done'; result?: unknown; model?: string | null }>();
  const usage: UsageRow[] = [];
  const store: Store = {
    agencyOf: async () => 'org_1',
    claim: async (key): Promise<ClaimState> => {
      const row = cache.get(key);
      if (!row) {
        cache.set(key, { status: 'pending' });
        return { state: 'claimed' };
      }
      return row.status === 'done' ? { state: 'hit', result: row.result, model: row.model ?? null } : { state: 'busy' };
    },
    complete: async (key, result, model) => void cache.set(key, { status: 'done', result, model }),
    release: async (key) => void (cache.get(key)?.status === 'pending' && cache.delete(key)),
    logUsage: async (row) => void usage.push(row),
  };
  return { store, cache, usage };
}

const OUTPUT = { documentType: 'driver_license', documentTypeConfidence: 'high', scalarFields: [] };
const ok = (): ModelCallResult => ({ ok: true, status: 200, output: OUTPUT, model: 'claude-sonnet-5', usage: { input_tokens: 1800, output_tokens: 400 } });
const request = (page = 1) => ({
  operation: 'structured_extraction' as const,
  imageBase64: 'aW1n',
  fileName: 'loss run.pdf',
  context: { documentId: 'doc_1', accountId: 'acct_1', page, sourceKind: 'scanned_pdf_page' as const, sourceHash: 'b'.repeat(64) },
  userId: '11111111-1111-1111-1111-111111111111',
});

describe('AI read: once per page, then reused', () => {
  it('a new read is paid once; reopening or refreshing reuses it without another call', async () => {
    const { store, usage } = memoryStore();
    const callModel = vi.fn(async () => ok());
    const first = await handleRead(request(), { store, callModel, configuredModel: 'claude-sonnet-5' });
    expect(first).toMatchObject({ status: 200, body: OUTPUT, fromCache: false });
    // Preview reopened, browser refreshed, another device: same file, same page.
    const again = await handleRead(request(), { store, callModel, configuredModel: 'claude-sonnet-5' });
    expect(again).toMatchObject({ status: 200, body: OUTPUT, fromCache: true });
    expect(callModel).toHaveBeenCalledTimes(1);
    // A different page is its own read.
    await handleRead(request(2), { store, callModel, configuredModel: 'claude-sonnet-5' });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(usage.map((u) => [u.page_number, u.from_cache, u.cost_usd])).toEqual([
      [1, false, 0.0114],
      [1, true, 0],
      [2, false, 0.0114],
    ]);
  });

  it('two requests for the same page at once make one paid call; the second waits and reuses it', async () => {
    const { store } = memoryStore();
    let release!: () => void;
    const callModel = vi.fn(() => new Promise<ModelCallResult>((r) => (release = () => r(ok()))));
    const sleep = vi.fn(async () => {
      release?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    const a = handleRead(request(), { store, callModel, configuredModel: 'claude-sonnet-5', sleep });
    const b = handleRead(request(), { store, callModel, configuredModel: 'claude-sonnet-5', sleep });
    const [ra, rb] = await Promise.all([a, b]);
    expect(callModel).toHaveBeenCalledTimes(1);
    // Whichever claimed the page first paid for it; the other waited and reused it.
    expect([ra, rb].map((r) => r.status)).toEqual([200, 200]);
    expect([ra, rb].map((r) => (r as { fromCache: boolean }).fromCache).sort()).toEqual([false, true]);
  });

  it('a failed call is logged, not cached — the next request tries again', async () => {
    const { store, usage, cache } = memoryStore();
    const failing = vi.fn(async (): Promise<ModelCallResult> => ({ ok: false, status: 529 }));
    const res = await handleRead(request(), { store, callModel: failing, configuredModel: 'claude-sonnet-5' });
    expect(res.status).toBe(502);
    expect(cache.size).toBe(0);
    expect(usage[0]).toMatchObject({ succeeded: false, from_cache: false, error_code: 'provider_529', cost_usd: 0 });
    const retry = vi.fn(async () => ok());
    expect((await handleRead(request(), { store, callModel: retry, configuredModel: 'claude-sonnet-5' })).status).toBe(200);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('usage rows carry who/where and Anthropic’s own token counts — never the document’s content', async () => {
    const { store, usage } = memoryStore();
    await handleRead(request(), { store, callModel: async () => ({ ...ok(), usage: { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 100 } }), configuredModel: 'claude-sonnet-5' });
    expect(usage[0]).toEqual({
      organization_id: 'org_1',
      user_id: '11111111-1111-1111-1111-111111111111',
      account_id: 'acct_1',
      document_id: 'doc_1',
      file_name: 'loss run.pdf',
      page_number: 1,
      operation: 'structured_extraction',
      source_kind: 'scanned_pdf_page',
      model: 'claude-sonnet-5',
      input_tokens: 2000,
      output_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 100,
      cost_usd: 0.02103, // 2000×$3 + 1000×$15 + 100×$0.30 per million
      succeeded: true,
      from_cache: false,
      error_code: null,
    });
    expect(JSON.stringify(usage)).not.toContain('driver_license');
  });

  it('without a database (local), reads still work — uncached', async () => {
    const callModel = vi.fn(async () => ok());
    expect((await handleRead(request(), { store: null, callModel, configuredModel: 'x' })).status).toBe(200);
    expect((await handleRead(request(), { store: null, callModel, configuredModel: 'x' })).status).toBe(200);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it('cache keys are per brokerage, operation and page; transcription never reuses an extraction', async () => {
    const ctx = request().context;
    const k = await cacheKeyFor('org_1', 'structured_extraction', ctx, 'x');
    expect(await cacheKeyFor('org_1', 'structured_extraction', ctx, 'different render')).toBe(k); // same file + page
    expect(await cacheKeyFor('org_2', 'structured_extraction', ctx, 'x')).not.toBe(k);
    expect(await cacheKeyFor('org_1', 'transcription', ctx, 'x')).not.toBe(k);
    expect(await cacheKeyFor('org_1', 'structured_extraction', { ...ctx, page: 2 }, 'x')).not.toBe(k);
  });

  it('only well-formed identifiers from the browser are kept', () => {
    expect(sanitizeContext({ documentId: 'doc_1', accountId: "x'; drop table", page: 0, sourceKind: 'video', sourceHash: 'nothex', extra: 1 })).toEqual({ documentId: 'doc_1' });
    const payload = btoa(JSON.stringify({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' })).replace(/=+$/, '');
    expect(userIdFromJwt(`Bearer h.${payload}.s`)).toBe('11111111-1111-1111-1111-111111111111');
    expect(userIdFromJwt(`Bearer h.${btoa(JSON.stringify({ role: 'anon' }))}.s`)).toBeNull();
  });

  it('the REST store calls the service-role RPCs and inserts usage', async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes('/rpc/ai_read_claim')) return new Response(JSON.stringify({ state: 'claimed' }));
      if (url.includes('/profiles')) return new Response(JSON.stringify([{ agency_id: 'org_9' }]));
      return new Response('', { status: 201 });
    }) as typeof fetch;
    const s = restStore('https://x.supabase.co', 'service-key', fetchImpl);
    expect(await s.agencyOf('u1')).toBe('org_9');
    expect(await s.claim('k', 'org_9', 'transcription')).toEqual({ state: 'claimed' });
    await s.logUsage({ operation: 'transcription' } as UsageRow);
    expect(calls.map((c) => c.url.replace('https://x.supabase.co', ''))).toEqual(['/rest/v1/profiles?user_id=eq.u1&select=agency_id', '/rest/v1/rpc/ai_read_claim', '/rest/v1/ai_usage_events']);
  });
});

describe('AI prices — one place', () => {
  it('cost is computed from the reported tokens', () => {
    expect(costUsd('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(18);
    expect(costUsd('claude-haiku-4-5-20251001', { input_tokens: 1_000_000 })).toBe(1);
    expect(costUsd('claude-opus-5-5', { output_tokens: 1_000_000 })).toBe(25);
    expect(costUsd('claude-sonnet-5', null)).toBe(0);
    expect(priceFor('some-new-model').known).toBe(false);
  });
});

// The public anon key passes the platform's JWT check too, so the function itself must
// refuse anyone who isn't a confirmed, signed-in broker — before any provider call.
describe('AI read: signed-in brokers only', () => {
  const USER = '11111111-1111-1111-1111-111111111111';
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const token = (claims: object) => `Bearer ${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
  const userToken = token({ sub: USER, role: 'authenticated' });
  const authFetch = (status: number, body: object = {}) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  const statusOf = (c: Caller) => (c.ok ? 200 : c.status);
  const confirmed = { id: USER, email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false, banned_until: null };

  it('the public anon key, the service key, no token or a malformed token are refused without a network call', async () => {
    for (const auth of [token({ role: 'anon', iss: 'supabase' }), token({ role: 'service_role' }), null, 'Bearer nonsense', token({ sub: 'not-a-uuid', role: 'authenticated' })]) {
      const { calls, fetchImpl } = authFetch(200, confirmed);
      expect(await verifyCaller(auth, 'https://x.supabase.co', 'anon', fetchImpl)).toEqual({ ok: false, status: 401, error: AUTH_MESSAGES.signIn });
      expect(calls).toHaveLength(0);
    }
  });

  it('a confirmed broker is accepted after Supabase Auth confirms the token', async () => {
    const { calls, fetchImpl } = authFetch(200, confirmed);
    expect(await verifyCaller(userToken, 'https://x.supabase.co', 'anon-key', fetchImpl)).toEqual({ ok: true, userId: USER });
    expect(calls).toEqual([{ url: 'https://x.supabase.co/auth/v1/user', headers: { apikey: 'anon-key', Authorization: userToken } }]);
  });

  it('a forged, expired or signed-out token (Auth says no) and a token for someone else are refused', async () => {
    for (const status of [401, 403, 404]) expect(statusOf(await verifyCaller(userToken, 'u', 'k', authFetch(status, { msg: 'invalid JWT' }).fetchImpl))).toBe(401);
    expect(await verifyCaller(userToken, 'u', 'k', authFetch(200, { ...confirmed, id: '22222222-2222-2222-2222-222222222222' }).fetchImpl)).toMatchObject({ ok: false, status: 401 });
  });

  it('unconfirmed email, anonymous sign-ins and banned users are refused', async () => {
    const now = () => Date.parse('2026-10-14T00:00:00Z');
    for (const user of [{ ...confirmed, email_confirmed_at: null }, { ...confirmed, is_anonymous: true }, { ...confirmed, banned_until: '2099-01-01T00:00:00Z' }]) {
      expect(await verifyCaller(userToken, 'u', 'k', authFetch(200, user).fetchImpl, now)).toEqual({ ok: false, status: 403, error: AUTH_MESSAGES.notAllowed });
    }
    // A ban that has ended doesn't block.
    expect((await verifyCaller(userToken, 'u', 'k', authFetch(200, { ...confirmed, banned_until: '2026-01-01T00:00:00Z' }).fetchImpl, now)).ok).toBe(true);
  });

  it('fails closed: Auth unreachable, erroring or not configured → refused', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(statusOf(await verifyCaller(userToken, 'u', 'k', down))).toBe(503);
    expect(statusOf(await verifyCaller(userToken, 'u', 'k', authFetch(500).fetchImpl))).toBe(503);
    expect(statusOf(await verifyCaller(userToken, undefined, 'k', authFetch(200, confirmed).fetchImpl))).toBe(503);
    expect(statusOf(await verifyCaller(userToken, 'u', undefined, authFetch(200, confirmed).fetchImpl))).toBe(503);
  });

  it('the handler never calls the provider, the cache or the usage log without a user', async () => {
    const { store, cache, usage } = memoryStore();
    const callModel = vi.fn(async () => ok());
    const res = await handleRead({ ...request(), userId: null }, { store, callModel, configuredModel: 'x' });
    expect(res).toEqual({ status: 401, body: { error: 'Sign in to use AI document reading.' } });
    expect(callModel).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
    expect(usage).toHaveLength(0);
    // Without a database either.
    expect((await handleRead({ ...request(), userId: null }, { store: null, callModel, configuredModel: 'x' })).status).toBe(401);
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe('AI read: platform-wide daily ceiling', () => {
  const withCount = (count: number | null) => {
    const m = memoryStore();
    m.store.paidReadsToday = async () => count;
    return m;
  };

  it('at the ceiling, a new read is refused (429) with no provider call and the page is freed for later', async () => {
    const { store, cache, usage } = withCount(5);
    const callModel = vi.fn(async () => ok());
    const res = await handleRead(request(), { store, callModel, configuredModel: 'x', globalDailyLimit: 5 });
    expect(res).toEqual({ status: 429, body: { error: GLOBAL_LIMIT_MESSAGE } });
    expect(callModel).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
    expect(usage.map((u) => [u.error_code, u.from_cache, u.cost_usd])).toEqual([['global_daily_limit', false, 0]]);
  });

  it('below the ceiling, or when the count is unavailable, the read goes ahead; the default ceiling applies when none is set', async () => {
    for (const [count, limit] of [[4, 5], [null, 5], [DEFAULT_GLOBAL_DAILY_LIMIT - 1, undefined]] as const) {
      const { store } = withCount(count);
      const callModel = vi.fn(async () => ok());
      expect((await handleRead(request(), { store, callModel, configuredModel: 'x', globalDailyLimit: limit })).status).toBe(200);
      expect(callModel).toHaveBeenCalledTimes(1);
    }
    const { store } = withCount(DEFAULT_GLOBAL_DAILY_LIMIT);
    expect((await handleRead(request(), { store, callModel: async () => ok(), configuredModel: 'x' })).status).toBe(429);
  });

  it('a page already read is still served from the cache at the ceiling (free)', async () => {
    const { store } = memoryStore();
    await handleRead(request(), { store, callModel: async () => ok(), configuredModel: 'x' });
    store.paidReadsToday = async () => 999;
    const callModel = vi.fn(async () => ok());
    expect(await handleRead(request(), { store, callModel, configuredModel: 'x', globalDailyLimit: 1 })).toMatchObject({ status: 200, fromCache: true });
    expect(callModel).not.toHaveBeenCalled();
  });

  it('the REST store counts today’s paid reads with one HEAD request; any failure → null', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const ok = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 200, headers: { 'content-range': '*/42' } });
    }) as typeof fetch;
    expect(await restStore('https://x.supabase.co', 'k', ok).paidReadsToday!()).toBe(42);
    expect(seen!.init?.method).toBe('HEAD');
    expect(decodeURIComponent(seen!.url)).toMatch(/\/rest\/v1\/ai_usage_events\?select=id&from_cache=is\.false&occurred_at=gte\.\d{4}-\d\d-\d\dT00:00:00\.000Z&or=\(succeeded\.is\.true,cost_usd\.gt\.0\)$/);
    expect(await restStore('u', 'k', (async () => new Response(null, { status: 500 })) as typeof fetch).paidReadsToday!()).toBeNull();
    expect(await restStore('u', 'k', (async () => { throw new Error('down'); }) as typeof fetch).paidReadsToday!()).toBeNull();
  });
});

describe('AI read: pause switch (the safe rollback)', () => {
  it('AI_READING_PAUSED=true / 1 / yes / on refuses with 503; anything else leaves AI on', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) expect(pausedRefusal(v)).toEqual({ status: 503, body: { error: PAUSED_MESSAGE } });
    for (const v of [undefined, null, '', 'false', '0', 'no', 'off', 'paused?']) expect(pausedRefusal(v)).toBeNull();
  });

  it('index.ts checks the caller first, then the pause switch, and only then reads the body or the API key', () => {
    const src = readFileSync(new URL('../../../../supabase/functions/extract-document-vision/index.ts', import.meta.url), 'utf8');
    const at = (needle: string) => src.indexOf(needle);
    expect(at("import { verifyCaller } from './auth.ts'")).toBeGreaterThan(-1);
    const verify = at('await verifyCaller(');
    const refuse = at('if (!caller.ok) return');
    const pause = at("pausedRefusal(Deno.env.get('AI_READING_PAUSED'))");
    const key = at("Deno.env.get('ANTHROPIC_API_KEY')");
    const body = at('await req.json()');
    expect(verify).toBeGreaterThan(-1);
    expect([verify, refuse, pause, key, body].every((v, i, a) => v > -1 && (i === 0 || v > a[i - 1]))).toBe(true);
  });
});
