import { describe, expect, it, vi } from 'vitest';
import { handleRead, type ModelCallResult } from '../../../../supabase/functions/extract-document-vision/handler.ts';
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
