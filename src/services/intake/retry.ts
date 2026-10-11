/**
 * Retrying calls that fail for temporary reasons (a dropped connection, a timeout, the server
 * briefly overloaded) — with increasing pauses — while failing fast on errors that won't go away by
 * trying again (a file that's too large, a link that's no longer active).
 */

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  /** Pause before the 2nd try; doubles each time (1s, 2s, 4s, …). */
  baseDelayMs?: number;
  /** Called before each retry (attempt = the try about to start, from 2). */
  onRetry?: (attempt: number, error: unknown) => void;
  isTransient?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Status code of a Supabase / fetch error, when there is one. */
export function errorStatus(error: unknown): number | undefined {
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown } | null;
  for (const v of [e?.status, e?.statusCode]) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : String(error);
}

/** Temporary: no connection, a timeout, rate limiting or a server error. Everything else is final. */
export function isTransientError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined) return status === 408 || status === 425 || status === 429 || status >= 500;
  const msg = errorMessage(error).toLowerCase();
  return /failed to fetch|network|load failed|timed? ?out|timeout|connection|econnreset|socket|aborted|fetch failed|temporarily|503|502|504/.test(msg);
}

export class TimeoutError extends Error {
  constructor(what: string) {
    super(`${what} timed out`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with a TimeoutError if `promise` hasn't settled after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'The request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(what)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 1000;
  const transient = opts.isTransient ?? isTransientError;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !transient(err)) throw err;
      opts.onRetry?.(attempt + 1, err);
      await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
