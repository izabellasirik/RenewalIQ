import { describe, expect, it } from 'vitest';
import { addedLate, payStatus, periodEnd } from '../agentPay';
import type { AgentPayment } from '../../supabase/agentPaymentsRepo';

const pay = (totalCents: number, paidOn: string, undone = false): AgentPayment => ({
  id: paidOn + totalCents, accountId: 'a', rowKey: 'p', agentUserId: 'u', commissionCents: totalCents, brokerFeeCents: 0, partnerShortfallCents: 0, totalCents, paidOn, createdAt: paidOn + 'T10:00:00Z', undoneAt: undone ? '2026-11-01T00:00:00Z' : null, undoReason: undone ? 'mistake' : null,
});

describe('paying agents', () => {
  it('paid, not paid, and partly paid when the amount changed after payment', () => {
    expect(payStatus(59550, []).state).toBe('not_paid');
    expect(payStatus(59550, [pay(59550, '2026-10-30')])).toMatchObject({ state: 'paid', dueCents: 0, lastPaidOn: '2026-10-30' });
    expect(payStatus(63000, [pay(59550, '2026-10-30')])).toMatchObject({ state: 'partly', dueCents: 3450 });
    expect(payStatus(59550, [pay(59550, '2026-10-30', true)]).state).toBe('not_paid');
    expect(payStatus(null, []).state).toBe('no_amount');
  });

  it('a policy belongs to its Monday–Sunday week; an endorsement to its month', () => {
    expect(periodEnd('2026-10-21', false)).toBe('2026-10-25'); // Wednesday → Sunday
    expect(periodEnd('2026-10-25', false)).toBe('2026-10-25'); // Sunday
    expect(periodEnd('2026-10-21', true)).toBe('2026-10-31');
  });

  it('flags a row entered after its week or month ended', () => {
    expect(addedLate('2026-10-21', '2026-10-24T15:00:00', false)).toBe(false);
    expect(addedLate('2026-10-21', '2026-10-29T15:00:00', false)).toBe(true);
    expect(addedLate('2026-10-21', '2026-10-29T15:00:00', true)).toBe(false);
    expect(addedLate('2026-10-21', '2026-11-02T15:00:00', true)).toBe(true);
  });
});
