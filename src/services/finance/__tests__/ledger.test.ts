import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYOUT_SCHEDULE, carrierReceived, describeSchedule, ledgerStatus, payoutDate, payoutReadiness, payoutWords, remainingNetCents, toTransaction, verificationBlockers } from '../ledger';

// Fictional data only. The same cases as supabase/tests/commission_ledger_0064 (the database's own rules).
const rec = (patch: Record<string, unknown>) =>
  toTransaction({ id: 't', submission_id: 'a', client_name: 'Sample Haulers', kind: 'policy', stream: 'weekly', origin: 'recorded', carrier_name: 'Sample Mutual', carrier_key: 'sample mutual',
    event_date: '2026-03-06', payable_from: '2026-03-06', net_cents: 0, agent_user_id: 'agent-a', agent_rate: '0.25', agent_cents: 0, carrier_rate: '0.12', carrier_rate_source: 'carrier_rate',
    carrier_cents: 0, proof_status: 'has_proof', verification_status: 'unverified', settlement: 'open', review_flags: [], ...patch });

describe('payout dates', () => {
  const s = DEFAULT_PAYOUT_SCHEDULE;
  it('policies bound Monday–Sunday are paid the following Friday — a Friday binding never the same Friday', () => {
    expect(payoutDate(s, 'weekly', '2026-10-16')).toBe('2026-10-23'); // Friday → next Friday
    expect(payoutDate(s, 'weekly', '2026-10-12')).toBe('2026-10-23'); // Monday
    expect(payoutDate(s, 'weekly', '2026-10-18')).toBe('2026-10-23'); // Sunday
    expect(payoutDate(s, 'weekly', '2026-10-19')).toBe('2026-10-30'); // next Monday
    expect(payoutDate(s, 'weekly', '2026-12-31')).toBe('2027-01-08'); // across the year
  });
  it('a payday that passed before the commission was verified reads as the next payout', () => {
    expect(payoutWords('2026-10-23', false, '2026-10-19')).toMatch(/^payout .+ once verified$/);
    expect(payoutWords('2026-10-16', false, '2026-10-19')).toBe('next payout once verified');
    expect(payoutWords('2026-10-16', true, '2026-10-19')).toMatch(/^payout /);
    expect(payoutWords(null, false)).toBe('');
  });
  it('endorsements: the first Friday of the next month by default, or a set day', () => {
    expect(payoutDate(s, 'monthly', '2026-10-01')).toBe('2026-11-06');
    expect(payoutDate(s, 'monthly', '2026-10-31')).toBe('2026-11-06');
    expect(payoutDate(s, 'monthly', '2026-12-15')).toBe('2027-01-01'); // 1 January 2027 is a Friday
    expect(payoutDate({ ...s, monthlyPayRule: 'day_of_month', monthlyPayDay: 15 }, 'monthly', '2026-10-20')).toBe('2026-11-15');
  });
  it('described in words', () => {
    expect(describeSchedule(s)).toEqual({ weekly: 'Policies bound Monday–Sunday are paid the following Friday.', monthly: 'Endorsements dated in a month are paid on the first Friday of the next month.' });
  });
});

describe('status and what blocks verification', () => {
  it('Missing Proof → Pending Verification → Verified', () => {
    expect(ledgerStatus(rec({ proof_status: 'missing_proof' }))).toBe('missing_proof');
    expect(ledgerStatus(rec({}))).toBe('pending_verification');
    expect(ledgerStatus(rec({ verification_status: 'verified', verified_at: '2026-03-10T00:00:00Z' }))).toBe('verified');
  });
  it('historical until reviewed; settled outside; void', () => {
    expect(ledgerStatus(rec({ origin: 'historical' }))).toBe('historical_review');
    expect(ledgerStatus(rec({ origin: 'historical', rate_confirmed_at: '2026-03-10T00:00:00Z' }))).toBe('pending_verification');
    expect(ledgerStatus(rec({ origin: 'historical', settlement: 'settled_outside' }))).toBe('settled_outside');
    expect(ledgerStatus(rec({ verification_status: 'void' }))).toBe('void');
  });
  it('blocking flags are named; informational ones are not', () => {
    expect(verificationBlockers(rec({ review_flags: ['default_carrier_rate', 'created_before_ledger'] }))).toEqual([]);
    expect(verificationBlockers(rec({ kind: 'endorsement', review_flags: ['unlinked_endorsement'] }))).toEqual(['Endorsement not linked to its policy']);
    expect(verificationBlockers(rec({ origin: 'historical', review_flags: ['historical', 'uncertain_carrier_rate'] }))).toEqual(['Confirm the agent, split and carrier rate first']);
  });
  it('only verified commissions are eligible; anything awaiting verification is flagged, never paid', () => {
    expect(payoutReadiness(rec({ agent_cents: 25_000 })).payable).toBe(false);
    expect(payoutReadiness(rec({ agent_cents: 25_000 })).note).toBe('Awaiting verification — flagged for admin review');
    expect(payoutReadiness(rec({ agent_cents: 25_000, verification_status: 'verified', verified_at: 'x' })).payable).toBe(true);
    expect(payoutReadiness(rec({ origin: 'historical', settlement: 'settled_outside' })).payable).toBe(false);
  });
});

describe('what is left on a policy', () => {
  it('policy + correction + endorsements − cancellations ($10,000 + $2,000 − $2,000 + $3,000 − $4,000 = $9,000)', () => {
    const all = [
      rec({ id: 'p1', net_cents: 1_000_000, verification_status: 'verified', verified_at: 'x' }),
      rec({ id: 'c1', kind: 'correction', original_transaction_id: 'p1', net_cents: 200_000 }),
      rec({ id: 'e1', kind: 'endorsement', original_transaction_id: 'p1', net_cents: -200_000 }),
      rec({ id: 'e2', kind: 'endorsement', original_transaction_id: 'p1', net_cents: 300_000 }),
      rec({ id: 'x1', kind: 'cancellation', original_transaction_id: 'p1', net_cents: -400_000 }),
      rec({ id: 'v1', kind: 'endorsement', original_transaction_id: 'p1', net_cents: 999_999, verification_status: 'void' }),
    ];
    expect(remainingNetCents('p1', all)).toBe(900_000);
  });
  it('carrier receipts are compared with the carrier commission (tracking only)', () => {
    const t = rec({ id: 'p1', carrier_cents: 120_000 });
    expect(carrierReceived(t, [])).toEqual({ receivedCents: 0, state: 'none' });
    expect(carrierReceived(t, [{ id: 'r', transactionId: 'p1', amountCents: 60_000, receivedDate: '2026-04-01', reference: null, note: null, voidedAt: null }]).state).toBe('partial');
    expect(carrierReceived(t, [{ id: 'r', transactionId: 'p1', amountCents: 120_000, receivedDate: '2026-04-01', reference: null, note: null, voidedAt: null }]).state).toBe('received');
    expect(carrierReceived(t, [{ id: 'r', transactionId: 'p1', amountCents: 120_000, receivedDate: '2026-04-01', reference: null, note: null, voidedAt: '2026-04-02' }]).state).toBe('none');
  });
});
