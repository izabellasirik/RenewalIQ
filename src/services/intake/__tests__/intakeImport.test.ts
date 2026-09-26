import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeSubmission } from '../../../types';

const log = vi.hoisted(() => ({ calls: [] as string[], save: { ok: true, complete: true } as { ok: boolean; complete: boolean; message?: string } }));

vi.mock('../../supabase/intakeRepo', () => ({
  fetchIntakeDocuments: async () => ({ ok: true, data: [] }),
  downloadIntakeDocumentFile: async () => ({ ok: false, message: 'n/a' }),
  markIntakeSubmissionImported: async (_id: string, accountId: string) => {
    log.calls.push(`mark:${accountId}`);
    return { ok: true, data: undefined };
  },
}));

const { useAccountsStore } = await import('../../../state/useAccountsStore');
const { importIntakeSubmission } = await import('../importIntakeSubmission');

const submission = { id: 'is1', intakeLinkId: 'l1', namedInsured: 'ABC Trucking, LLC', dotNumber: '1234567', operatingStates: 'TX', coverageRequested: [], contactName: 'Sam', contactEmail: null, contactPhone: null } as unknown as IntakeSubmission;

beforeEach(() => {
  log.calls = [];
  log.save = { ok: true, complete: true };
  useAccountsStore.setState({
    accounts: [],
    riskProfiles: {},
    saveAccountNow: async (id: string) => {
      log.calls.push(`save:${id}`);
      return log.save;
    },
    deleteAccountPermanently: async (id: string) => {
      log.calls.push(`delete:${id}`);
      useAccountsStore.setState((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
      return { ok: true };
    },
  });
});

describe('intake import waits for the cloud save', () => {
  it('marks the submission imported only after the account saved', async () => {
    const res = await importIntakeSubmission(submission);
    expect(res.ok).toBe(true);
    expect(log.calls).toEqual([`save:${res.accountId}`, `mark:${res.accountId}`]);
    expect(useAccountsStore.getState().accounts.map((a) => a.namedInsured)).toEqual(['ABC Trucking, LLC']);
  });

  it('a failed save removes the new account and leaves the submission pending', async () => {
    log.save = { ok: false, complete: false, message: 'permission denied' };
    const res = await importIntakeSubmission(submission);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('nothing was imported');
    expect(log.calls.some((c) => c.startsWith('mark:'))).toBe(false);
    expect(log.calls.some((c) => c.startsWith('delete:'))).toBe(true);
    expect(useAccountsStore.getState().accounts).toHaveLength(0);
  });

  it('a save that only lacks a not-yet-applied workflow migration still imports', async () => {
    log.save = { ok: true, complete: false, message: 'Contacts … need migration 0007' };
    const res = await importIntakeSubmission(submission);
    expect(res.ok).toBe(true);
    expect(log.calls.some((c) => c.startsWith('mark:'))).toBe(true);
  });
});
