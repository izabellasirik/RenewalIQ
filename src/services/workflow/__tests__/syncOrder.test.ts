import { beforeEach, describe, expect, it, vi } from 'vitest';

// The account row must be saved before its activity events (activity_events → submissions FK).
const calls = vi.hoisted(() => ({ order: [] as string[], headerSaved: true, snapOk: true }));

vi.mock('../../supabase/client', () => ({ isSupabaseConfigured: true, supabase: null }));
vi.mock('../../supabase/submissionsRepo', () => ({
  saveSubmissionSnapshot: async () => {
    calls.order.push('snapshot:start');
    await new Promise((r) => setTimeout(r, 20));
    calls.order.push('snapshot:end');
    return calls.snapOk ? { ok: true, data: undefined, headerSaved: true } : { ok: false, message: 'header failed', headerSaved: calls.headerSaved };
  },
  appendActivityEvents: async () => {
    calls.order.push('activity');
    return { ok: true, data: undefined };
  },
}));
vi.mock('../../documents/localFileStore', () => ({ saveLocalFile: async () => {}, deleteLocalFiles: async () => {}, copyLocalFile: async () => {} }));

const { useAccountsStore } = await import('../../../state/useAccountsStore');

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

  it('skips activity when the account row itself failed, and reports the real error', async () => {
    calls.snapOk = false;
    calls.headerSaved = false;
    const id = useAccountsStore.getState().createAccount('Fail Co', 'TX');
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
});
