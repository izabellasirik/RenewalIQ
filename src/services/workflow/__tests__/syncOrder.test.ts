import { beforeEach, describe, expect, it, vi } from 'vitest';

// The account row must be saved before its activity events (activity_events → submissions FK).
const calls = vi.hoisted(() => ({ order: [] as string[], headerSaved: true, snapOk: true }));

vi.mock('../../supabase/client', () => ({ isSupabaseConfigured: true, supabase: null }));
vi.mock('../../supabase/submissionsRepo', () => ({
  saveSubmissionSnapshot: async (_u: string, account: { id: string }) => {
    calls.order.push('snapshot:start', `start:${account.id}`);
    await new Promise((r) => setTimeout(r, 20));
    calls.order.push('snapshot:end', `end:${account.id}`);
    return calls.snapOk ? { ok: true, data: undefined, headerSaved: true } : { ok: false, message: 'header failed', headerSaved: calls.headerSaved };
  },
  appendActivityEvents: async () => {
    calls.order.push('activity');
    return { ok: true, data: undefined };
  },
}));
vi.mock('../../documents/localFileStore', () => ({ saveLocalFile: async () => {}, deleteLocalFiles: async () => {}, copyLocalFile: async () => {} }));

const { useAccountsStore, SYNC_RETRY } = await import('../../../state/useAccountsStore');
SYNC_RETRY.delaysMs = [20, 20, 20];
SYNC_RETRY.slowMs = 60_000;

beforeEach(() => {
  calls.order = [];
  calls.snapOk = true;
  calls.headerSaved = true;
  useAccountsStore.setState({ accounts: [], cloudAccountIds: {}, activityLog: {}, riskProfiles: {}, documents: {}, syncStatus: {}, syncError: {}, currentUserId: 'u1', currentUserEmail: 'u1@x.com', agencyAccess: null, agencyMembers: [] });
});

describe('cloud save order', () => {
  it('writes activity only after the account row has been saved', async () => {
    useAccountsStore.getState().createAccount('Order Co', 'TX');
    await vi.waitFor(() => expect(calls.order).toContain('activity'), { timeout: 10000 });
    expect(calls.order.indexOf('activity')).toBeGreaterThan(calls.order.indexOf('snapshot:end'));
  });

  it('skips activity when the account row itself failed, and reports the real error once the retries are used up', async () => {
    calls.snapOk = false;
    calls.headerSaved = false;
    const id = useAccountsStore.getState().createAccount('Fail Co', 'TX');
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('retrying'), { timeout: 10000 });
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('error'), { timeout: 10000 });
    expect(calls.order).not.toContain('activity');
    expect(useAccountsStore.getState().syncError[id]).toBe('header failed');
  });

  it('still writes activity when the row saved but part of the snapshot did not (missing migration)', async () => {
    calls.snapOk = false;
    calls.headerSaved = true;
    const id = useAccountsStore.getState().createAccount('Partial Co', 'TX');
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('error'), { timeout: 10000 });
    expect(calls.order).toContain('activity');
  });

  it('a temporary failure shows "retrying", never an error, and clears itself when a retry succeeds', async () => {
    calls.snapOk = false;
    const id = useAccountsStore.getState().createAccount('Blip Co', 'TX');
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('retrying'), { timeout: 10000 });
    calls.snapOk = true;
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('saved'), { timeout: 10000 });
    expect(useAccountsStore.getState().syncError[id]).toBeUndefined();
  });

  it('saves of one account never overlap', async () => {
    const id = useAccountsStore.getState().createAccount('Burst Co', 'TX');
    const st = useAccountsStore.getState();
    st.renameAccount?.(id, 'Burst Co 2');
    await Promise.all([st.saveAccountNow(id), st.saveAccountNow(id), st.saveAccountNow(id)]);
    await vi.waitFor(() => expect(useAccountsStore.getState().syncStatus[id]).toBe('saved'), { timeout: 10000 });
    // start/end strictly alternate: a save never starts while another is running.
    const snaps = calls.order.filter((o) => o === `start:${id}` || o === `end:${id}`);
    expect(snaps.length).toBeGreaterThanOrEqual(4);
    snaps.forEach((o, i) => expect(o).toBe(i % 2 === 0 ? `start:${id}` : `end:${id}`));
  });
});
