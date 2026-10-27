import { beforeEach, describe, expect, it, vi } from 'vitest';

// The app's analytics call (0078): sent as note_work, a name ad / privacy blockers don't drop; until 0078 is
// applied, the original track_product_event.
const calls: string[] = [];
let noteWorkMissing = false;
vi.mock('../../supabase/client', () => ({
  supabase: {
    rpc: (fn: string) => {
      calls.push(fn);
      if (fn === 'note_work' && noteWorkMissing) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.note_work' } });
      return Promise.resolve({ data: true, error: null });
    },
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('trackEvent call name', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
  });
  it('sends note_work', async () => {
    noteWorkMissing = false;
    const { trackEvent } = await import('../trackEvent');
    trackEvent('market_added', { accountId: 'acct_1', dedupeKey: 'market_added:acct_1:q1' });
    await flush();
    expect(calls).toEqual(['note_work']);
  });
  it('falls back to track_product_event when note_work isn’t there yet, then uses it directly', async () => {
    noteWorkMissing = true;
    const { trackEvent } = await import('../trackEvent');
    trackEvent('account_created', { accountId: 'acct_2' });
    await flush();
    trackEvent('policy_bound', { accountId: 'acct_2' });
    await flush();
    expect(calls).toEqual(['note_work', 'track_product_event', 'track_product_event']);
  });
});
