// Pure pieces of the Gmail refresh (no Deno or env access, so the tests run them under Node):
// who a thread is "with", which threads to fetch now and which carry over, and retrying Gmail calls.

/** A message's From/To as Gmail reports them. */
export interface MessageHeaders {
  from: string;
  to: string;
  internalDate: string;
}

/** "Dana Reyes <dana@x.com>" → { name, email } (lower-cased email). */
export function parseAddress(raw: string): { name: string | null; email: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const plain = raw.trim().split(/[,\s]+/)[0] ?? '';
  return { name: null, email: plain.includes('@') ? plain.toLowerCase() : null };
}

/**
 * The thread's counterpart, for matching: the most recent sender who isn't the mailbox owner (a reply
 * from the broker doesn't hide the client); if only the owner wrote, the first recipient of their
 * latest message.
 */
export function threadCounterpart(messages: MessageHeaders[], ownerEmail: string): { name: string | null; email: string | null } {
  const owner = ownerEmail.trim().toLowerCase();
  const sorted = [...messages].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const from = parseAddress(sorted[i].from);
    if (from.email && from.email !== owner) return from;
  }
  const last = sorted[sorted.length - 1];
  for (const part of (last?.to ?? '').split(',')) {
    const to = parseAddress(part);
    if (to.email && to.email !== owner) return to;
  }
  return parseAddress(last?.from ?? '');
}

/** New threads first, then the carried-over backlog; each once. */
export function planQueue(newIds: string[], backlog: string[]): string[] {
  return [...new Set([...newIds, ...backlog])];
}

export type FetchOutcome = 'ok' | 'gone' | 'failed';

/**
 * What's left after fetching up to `batch` threads: the ones not reached yet, plus the ones whose fetch
 * failed (they're retried next Refresh). Threads Gmail no longer has ('gone') are dropped.
 */
export function remainingAfter(queue: string[], batch: number, outcomes: Map<string, FetchOutcome>): string[] {
  const attempted = queue.slice(0, batch);
  return [...attempted.filter((id) => outcomes.get(id) === 'failed' || !outcomes.has(id)), ...queue.slice(batch)];
}

/** Gmail's rate-limit and server errors are worth retrying; anything else isn't. */
export const retryable = (status: number) => status === 429 || status >= 500;

/** Calls `fn` until it returns a non-retryable status, up to `tries` times, waiting longer each time. */
export async function withRetry<T extends { status: number }>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>, tries = 4): Promise<T> {
  let r = await fn();
  for (let i = 1; i < tries && retryable(r.status); i++) {
    await sleep(500 * 2 ** (i - 1));
    r = await fn();
  }
  return r;
}

/** Runs `fn` over `items`, at most `limit` at a time; each worker starts the next item as soon as one finishes. */
export async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
