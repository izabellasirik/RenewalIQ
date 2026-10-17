// AI model prices — the ONE place they live. Each usage row's cost is computed from these when the
// call is made (and stored on the row), so updating a price here changes future rows only.
//
// USD per million tokens. Check against https://www.anthropic.com/pricing when a model or price
// changes; a model is matched by its exact id first, then by family prefix.
//
// Plain TypeScript (no Deno APIs) so the app's unit tests can import it too.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Prompt-cache writes and reads, when used. */
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

const family = (input: number, output: number): ModelPrice => ({
  inputPerMTok: input,
  outputPerMTok: output,
  cacheWritePerMTok: input * 1.25,
  cacheReadPerMTok: input * 0.1,
});

/** Exact model ids with their own price (none differ from their family today). */
export const MODEL_PRICES: Record<string, ModelPrice> = {};

/** By family — the first prefix that matches wins. */
export const FAMILY_PRICES: { prefix: string; price: ModelPrice }[] = [
  { prefix: 'claude-opus', price: family(5, 25) },
  { prefix: 'claude-sonnet', price: family(3, 15) },
  { prefix: 'claude-haiku', price: family(1, 5) },
];

/** Used for a model not listed above (and flagged as such) — the Sonnet price, the default model's family. */
export const FALLBACK_PRICE: ModelPrice = family(3, 15);

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function priceFor(model: string | null | undefined): { price: ModelPrice; known: boolean } {
  const id = (model ?? '').toLowerCase();
  if (MODEL_PRICES[id]) return { price: MODEL_PRICES[id], known: true };
  const f = FAMILY_PRICES.find((p) => id.startsWith(p.prefix));
  return f ? { price: f.price, known: true } : { price: FALLBACK_PRICE, known: false };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** The cost in USD of one call, from the token counts Anthropic returned (rounded to 6 decimals). */
export function costUsd(model: string | null | undefined, usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  const { price } = priceFor(model);
  const cost =
    (n(usage.input_tokens) * price.inputPerMTok +
      n(usage.output_tokens) * price.outputPerMTok +
      n(usage.cache_creation_input_tokens) * price.cacheWritePerMTok +
      n(usage.cache_read_input_tokens) * price.cacheReadPerMTok) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/** Token counts as stored on a usage row. */
export function usageCounts(usage: TokenUsage | null | undefined) {
  return {
    input_tokens: n(usage?.input_tokens),
    output_tokens: n(usage?.output_tokens),
    cache_creation_input_tokens: n(usage?.cache_creation_input_tokens),
    cache_read_input_tokens: n(usage?.cache_read_input_tokens),
  };
}
