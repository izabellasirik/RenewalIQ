// One AI read request, start to finish: reuse a stored read when there is one, otherwise make the
// one paid call (others asking for the same page meanwhile wait for it), store it, and log the
// usage either way. Plain TypeScript (no Deno APIs) — index.ts wires it to Deno.serve and the
// Anthropic API; unit tests wire it to fakes.

import { costUsd, usageCounts, type TokenUsage } from './pricing.ts';
import { cacheKeyFor, type Operation, type ReadContext, type Store, type UsageRow } from './store.ts';

export interface ModelCallResult {
  ok: boolean;
  /** HTTP status from the provider (or 0 for a network error). */
  status: number;
  /** The tool input the model returned, when it did. */
  output?: unknown;
  model?: string | null;
  usage?: TokenUsage | null;
}

export interface ReadRequest {
  operation: Operation;
  imageBase64: string;
  fileName: string | null;
  context: ReadContext;
  userId: string | null;
}

export interface ReadDeps {
  store: Store | null;
  callModel: () => Promise<ModelCallResult>;
  configuredModel: string;
  sleep?: (ms: number) => Promise<void>;
  /** How long a request waits for the same page's in-flight read before giving up. */
  waitBudgetMs?: number;
  now?: () => number;
}

export type ReadResponse = { status: 200; body: unknown; fromCache: boolean } | { status: number; body: { error: string } };

export async function handleRead(req: ReadRequest, deps: ReadDeps): Promise<ReadResponse> {
  const { store } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const orgId = store && req.userId ? await store.agencyOf(req.userId) : null;
  const scope = orgId ?? req.userId;
  const row = (patch: Partial<UsageRow>): UsageRow => ({
    organization_id: orgId,
    user_id: req.userId,
    account_id: req.context.accountId ?? null,
    document_id: req.context.documentId ?? null,
    file_name: req.fileName ? req.fileName.slice(0, 200) : null,
    page_number: req.context.page ?? null,
    operation: req.operation,
    source_kind: req.context.sourceKind ?? null,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cost_usd: 0,
    succeeded: false,
    from_cache: false,
    error_code: null,
    ...patch,
  });

  // 1. A stored read, or the right to make the call (one request per page at a time).
  let key: string | null = null;
  if (store && scope) {
    key = await cacheKeyFor(scope, req.operation, req.context, req.imageBase64);
    const deadline = now() + (deps.waitBudgetMs ?? 100_000);
    for (;;) {
      const claim = await store.claim(key, scope, req.operation);
      if (!claim) {
        key = null; // cache unavailable: read without it
        break;
      }
      if (claim.state === 'hit') {
        await store.logUsage(row({ model: claim.model, succeeded: true, from_cache: true }));
        return { status: 200, body: claim.result, fromCache: true };
      }
      if (claim.state === 'claimed') break;
      if (now() >= deadline) return { status: 503, body: { error: 'This page is already being read — try again in a moment.' } };
      await sleep(1500);
    }
  }

  // 2. The paid call.
  let result: ModelCallResult;
  try {
    result = await deps.callModel();
  } catch {
    result = { ok: false, status: 0 };
  }
  const model = result.model ?? deps.configuredModel;
  const tokens = usageCounts(result.usage);
  const cost = costUsd(model, result.usage);
  const output = result.output;
  if (!result.ok || !output || typeof output !== 'object') {
    if (key && store) await store.release(key);
    await store?.logUsage(row({ model, ...tokens, cost_usd: cost, error_code: !result.ok ? `provider_${result.status}` : 'no_structured_output' }));
    return result.ok
      ? { status: 502, body: { error: 'The vision model did not return structured data.' } }
      : { status: 502, body: { error: result.status === 0 ? 'Could not reach the vision model provider.' : 'The vision model provider returned an error.' } };
  }

  // 3. Kept, so this page is never paid for again.
  if (key && store) await store.complete(key, output, model);
  await store?.logUsage(row({ model, ...tokens, cost_usd: cost, succeeded: true }));
  return { status: 200, body: output, fromCache: false };
}
