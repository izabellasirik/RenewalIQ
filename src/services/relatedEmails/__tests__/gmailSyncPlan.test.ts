import { describe, expect, it } from 'vitest';
import { planQueue, remainingAfter, threadCounterpart, withRetry, type FetchOutcome } from '../../../../supabase/functions/gmail/syncPlan.ts';

// The Gmail function's sync planning (supabase/functions/gmail/syncPlan.ts). Fictional addresses only.
const OWNER = 'broker@agency.example';
const msg = (from: string, at: number, to = OWNER) => ({ from, to, internalDate: String(at) });

describe('who a thread is with (reply-sender bug)', () => {
  it('the broker’s own reply doesn’t hide the client who wrote', () => {
    expect(threadCounterpart([msg('Dana Reyes <dana@client.example>', 1), msg(`Broker <${OWNER}>`, 2, 'dana@client.example')], OWNER)).toEqual({ name: 'Dana Reyes', email: 'dana@client.example' });
  });
  it('the most recent other sender wins; the owner is recognised case-insensitively', () => {
    expect(threadCounterpart([msg('a@one.example', 1), msg('B <b@two.example>', 2), msg('BROKER@Agency.example', 3, 'b@two.example')], OWNER).email).toBe('b@two.example');
  });
  it('a thread only the broker wrote is with its first recipient', () => {
    expect(threadCounterpart([msg(OWNER, 1, 'Dana <dana@client.example>, other@x.example')], OWNER).email).toBe('dana@client.example');
  });
});

describe('no skipped mail (incomplete-sync bug)', () => {
  it('new threads first, then the backlog, each once', () => {
    expect(planQueue(['n1', 'b2'], ['b1', 'b2', 'b3'])).toEqual(['n1', 'b2', 'b1', 'b3']);
  });
  it('failed and unreached threads carry over to the next Refresh; deleted ones are dropped', () => {
    const queue = ['t1', 't2', 't3', 't4', 't5'];
    const outcomes = new Map<string, FetchOutcome>([['t1', 'ok'], ['t2', 'failed'], ['t3', 'gone']]);
    expect(remainingAfter(queue, 3, outcomes)).toEqual(['t2', 't4', 't5']);
  });
  it('a thread whose fetch never reported back is kept, not silently lost', () => {
    expect(remainingAfter(['t1', 't2'], 2, new Map([['t1', 'ok' as FetchOutcome]]))).toEqual(['t2']);
  });
});

describe('Gmail calls retry rate limits and server errors, and give up visibly', () => {
  const calls = (statuses: number[]) => {
    let i = 0;
    return { fn: async () => ({ status: statuses[Math.min(i++, statuses.length - 1)] }), count: () => i };
  };
  const noWait = async () => undefined;
  it('429 then 200: retried and succeeds', async () => {
    const c = calls([429, 503, 200]);
    expect((await withRetry(c.fn, noWait)).status).toBe(200);
    expect(c.count()).toBe(3);
  });
  it('403 (not retryable): returned at once', async () => {
    const c = calls([403]);
    expect((await withRetry(c.fn, noWait)).status).toBe(403);
    expect(c.count()).toBe(1);
  });
  it('still failing after 4 tries: the failure is returned (the thread is then kept for later)', async () => {
    const c = calls([500]);
    expect((await withRetry(c.fn, noWait)).status).toBe(500);
    expect(c.count()).toBe(4);
  });
});
