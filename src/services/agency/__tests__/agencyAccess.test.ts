import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../types';

/**
 * Client-side behavior of agency permissions, against a fake cloud that applies the SAME access rule
 * as the database (0011_agency_roles.sql: submission_visible). The rule itself is enforced — and
 * tested against real Postgres RLS — in supabase/tests/agency_rls; this checks that the app shows,
 * drops, and assigns accounts in line with what the database returns.
 */

type Row = { id: string; namedInsured: string; creator: string; agencyId: string | null; assignedUserId: string | null };
const cloud = vi.hoisted(() => ({
  rows: [] as Row[],
  profiles: {} as Record<string, { agencyId: string; role: 'agent' | 'admin'; name: string }>,
  current: null as string | null,
}));

function visible(r: Row, uid: string): boolean {
  if (!r.agencyId) return r.creator === uid;
  const p = cloud.profiles[uid];
  return !!p && p.agencyId === r.agencyId && (p.role === 'admin' || r.assignedUserId === uid);
}

vi.mock('../../supabase/client', () => ({ isSupabaseConfigured: true, supabase: null }));
vi.mock('../../supabase/submissionsRepo', async () => {
  const { createEmptyRiskProfile } = await import('../../extraction/emptyRiskProfile');
  return {
    fetchUserSubmissions: async (uid: string) => ({
      ok: true,
      data: cloud.rows
        .filter((r) => visible(r, uid))
        .map((r) => ({
          account: { id: r.id, namedInsured: r.namedInsured, state: 'TX', status: 'new', archived: false, createdAt: '2026-09-01', updatedAt: '2026-09-01', agencyId: r.agencyId ?? undefined, assignedUserId: r.assignedUserId } as Account,
          profile: createEmptyRiskProfile(r.id),
          documents: [],
          activity: [],
          missingItems: [],
          quotes: [{ id: `q_${r.id}`, accountId: r.id, marketName: 'Progressive', status: 'submitted', notes: [], createdAt: '2026-09-01', updatedAt: '2026-09-01' }],
          followUps: [],
          hasWorkflowColumns: true,
          hasStageColumn: true,
        })),
    }),
    fetchAgencyAccess: async (uid: string) => {
      const me = cloud.profiles[uid];
      if (!me) return { ok: true, data: { access: null, members: [] } };
      const members = Object.entries(cloud.profiles)
        .filter(([id, p]) => p.agencyId === me.agencyId && (me.role === 'admin' || id === uid))
        .map(([id, p]) => ({ userId: id, role: p.role, name: p.name, email: `${p.name.toLowerCase()}@agency.com` }));
      return { ok: true, data: { access: { agencyId: me.agencyId, agencyName: 'Agency', role: me.role }, members } };
    },
    submissionsRevoked: async (ids: string[]) => Object.fromEntries(ids.filter((id) => cloud.rows.some((r) => r.id === id)).map((id) => [id, true])),
    assignSubmission: async (id: string, userId: string | null) => {
      const r = cloud.rows.find((x) => x.id === id);
      const uid = cloud.current!;
      if (!r || !visible(r, uid)) return { ok: false, message: 'not found' };
      if (cloud.profiles[uid]?.role !== 'admin') return { ok: false, message: 'Only an agency admin can reassign an account.' };
      r.assignedUserId = userId;
      return { ok: true, data: undefined };
    },
    saveSubmissionSnapshot: async (uid: string, account: Account) => {
      const existing = cloud.rows.find((r) => r.id === account.id);
      if (existing) return visible(existing, uid) ? { ok: true, data: undefined, headerSaved: true } : { ok: false, message: 'new row violates row-level security policy', headerSaved: false };
      const agencyId = cloud.profiles[uid]?.agencyId ?? null;
      cloud.rows.push({ id: account.id, namedInsured: account.namedInsured, creator: uid, agencyId, assignedUserId: uid });
      return { ok: true, data: undefined, headerSaved: true };
    },
    appendActivityEvents: async () => ({ ok: true, data: undefined }),
  };
});
vi.mock('../../documents/localFileStore', () => ({ saveLocalFile: async () => {}, deleteLocalFiles: async () => {}, copyLocalFile: async () => {} }));

const { useAccountsStore } = await import('../../../state/useAccountsStore');
const { deriveAccountActions } = await import('../../workflow/nextActions');
const { agentLabel } = await import('../agentLabel');
const store = () => useAccountsStore.getState();

const ROMAN = 'u-roman';
const AGENT_B = 'u-agentb';
const DENIS = 'u-denis';
const OUTSIDER = 'u-outsider';

async function signIn(uid: string) {
  cloud.current = uid;
  store().setCurrentUserId(uid, `${uid}@agency.com`);
  await store().hydrateCloudSubmissions();
}
const ids = () => store().accounts.map((a) => a.id).sort();
function todaysPlateAccountIds(): string[] {
  const s = store();
  return [...new Set(s.accounts.flatMap((account) => deriveAccountActions({ account, items: s.missingItems[account.id] ?? [], quotes: s.quotes[account.id] ?? [], contacts: [] }).now.map((a) => a.accountId)))].sort();
}

beforeEach(() => {
  cloud.rows = [
    { id: 'acct_r1', namedInsured: 'Roman Trucking', creator: ROMAN, agencyId: 'ag1', assignedUserId: ROMAN },
    { id: 'acct_r2', namedInsured: 'Roman Freight', creator: ROMAN, agencyId: 'ag1', assignedUserId: ROMAN },
    { id: 'acct_b1', namedInsured: 'B Logistics', creator: AGENT_B, agencyId: 'ag1', assignedUserId: AGENT_B },
    { id: 'acct_o1', namedInsured: 'Other Agency Co', creator: OUTSIDER, agencyId: 'ag2', assignedUserId: OUTSIDER },
  ];
  cloud.profiles = {
    [DENIS]: { agencyId: 'ag1', role: 'admin', name: 'Denis' },
    [ROMAN]: { agencyId: 'ag1', role: 'agent', name: 'Roman' },
    [AGENT_B]: { agencyId: 'ag1', role: 'agent', name: 'Agent B' },
    [OUTSIDER]: { agencyId: 'ag2', role: 'admin', name: 'Outsider' },
  };
  cloud.current = null;
  useAccountsStore.setState({ accounts: [], hiddenAccounts: [], accountOwners: {}, cloudAccountIds: {}, missingItems: {}, quotes: {}, followUps: {}, riskProfiles: {}, documents: {}, activityLog: {}, matchResults: {}, currentUserId: null, currentUserEmail: null, agencyAccess: null, agencyMembers: [] });
});

describe('agent vs admin account access (client)', () => {
  it('1–2: Roman sees his accounts; Agent B does not see them (same browser, switching users)', async () => {
    await signIn(ROMAN);
    expect(ids()).toEqual(['acct_r1', 'acct_r2']);
    expect(store().agencyAccess?.role).toBe('agent');
    await signIn(AGENT_B);
    expect(ids()).toEqual(['acct_b1']);
  });

  it("4: a URL to another agent's account finds nothing locally (the workspace shows Not found)", async () => {
    await signIn(AGENT_B);
    expect(store().accounts.find((a) => a.id === 'acct_r1')).toBeUndefined();
    expect(store().riskProfiles.acct_r1).toBeUndefined();
  });

  it('5–8: admin sees the whole agency, reassigns Roman → Agent B; Roman loses it, Agent B gains it', async () => {
    await signIn(DENIS);
    expect(ids()).toEqual(['acct_b1', 'acct_r1', 'acct_r2']);
    expect(store().agencyMembers.map((m) => m.name)).toEqual(['Denis', 'Roman', 'Agent B']);

    const res = await store().assignAccountToAgent('acct_r2', AGENT_B);
    expect(res.ok).toBe(true);
    const r2 = store().accounts.find((a) => a.id === 'acct_r2')!;
    expect(r2.assignedUserId).toBe(AGENT_B);
    expect(agentLabel(r2, store().agencyMembers, DENIS)).toBe('Agent B');
    expect(store().activityLog.acct_r2.at(-1)?.message).toContain('Assigned to agent Agent B');

    // Roman's device still had acct_r2 from before — the next sign-in drops it.
    cloud.current = ROMAN;
    useAccountsStore.setState((s) => ({ accountOwners: { ...s.accountOwners, acct_r1: ROMAN, acct_r2: ROMAN } }));
    await signIn(ROMAN);
    expect(ids()).toEqual(['acct_r1']);
    expect(store().quotes.acct_r2).toBeUndefined();

    await signIn(AGENT_B);
    expect(ids()).toEqual(['acct_b1', 'acct_r2']);
  });

  it('agents cannot reassign (and the control is admin-only)', async () => {
    await signIn(ROMAN);
    const res = await store().assignAccountToAgent('acct_r1', AGENT_B);
    expect(res.ok).toBe(false);
    expect(cloud.rows.find((r) => r.id === 'acct_r1')!.assignedUserId).toBe(ROMAN);
  });

  it('9: a new account created by Roman belongs to Roman', async () => {
    await signIn(ROMAN);
    const id = store().createAccount('Roman New Co', 'TX');
    const acct = store().accounts.find((a) => a.id === id)!;
    expect(acct.assignedUserId).toBe(ROMAN);
    expect(acct.assignedBroker?.name).toBe('Roman');
    await vi.waitFor(() => expect(cloud.rows.find((r) => r.id === id)?.assignedUserId).toBe(ROMAN), { timeout: 10000 });
    await signIn(AGENT_B);
    expect(ids()).not.toContain(id);
  });

  it("an account that never reached the cloud is kept, not dropped", async () => {
    await signIn(ROMAN);
    const id = 'acct_pending';
    useAccountsStore.setState((s) => ({
      accounts: [...s.accounts, { id, namedInsured: 'Pending', state: 'TX', status: 'new', archived: false, createdAt: '2026-09-01', updatedAt: '2026-09-01' }],
      cloudAccountIds: { ...s.cloudAccountIds, [id]: true },
    }));
    await store().hydrateCloudSubmissions();
    expect(ids()).toContain(id);
  });

  it("10–12: quotes and Today's Plate only come from accounts the user can access; admin's is agency-wide", async () => {
    await signIn(ROMAN);
    expect(Object.keys(store().quotes).sort()).toEqual(['acct_r1', 'acct_r2']);
    expect(todaysPlateAccountIds()).toEqual(['acct_r1', 'acct_r2']);
    await signIn(AGENT_B);
    expect(todaysPlateAccountIds()).toEqual(['acct_b1']);
    await signIn(DENIS);
    expect(todaysPlateAccountIds()).toEqual(['acct_b1', 'acct_r1', 'acct_r2']);
  });

  it('other agencies are invisible even to their admin', async () => {
    await signIn(OUTSIDER);
    expect(ids()).toEqual(['acct_o1']);
  });

  it('outside an agency (no profile) nothing changes: owner-only, broker label as before', async () => {
    cloud.profiles = {};
    cloud.rows = [{ id: 'acct_l1', namedInsured: 'Legacy', creator: ROMAN, agencyId: null, assignedUserId: null }];
    await signIn(ROMAN);
    expect(store().agencyAccess).toBeNull();
    expect(ids()).toEqual(['acct_l1']);
    await signIn(AGENT_B);
    expect(ids()).toEqual([]);
  });
});
