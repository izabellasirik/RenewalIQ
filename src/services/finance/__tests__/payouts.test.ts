import { describe, expect, it } from 'vitest';
import { agentBalances, readyLines, runPeriodLabel, runState, runTotals, toBalanceEntry, toPayout, toRun, toRunDetails, waitingReason } from '../payouts';

// Fictional data only — the same run as supabase/tests/commission_payouts_0065 (the database does the sums).
const details = toRunDetails({
  run: { id: 'r1', stream: 'weekly', periodStart: '2026-09-07', periodEnd: '2026-09-13', payDate: '2026-09-18', closedAt: null, periodOver: true },
  lines: [
    {
      agent: 'a', agentName: 'Agent A', status: 'draft', payoutId: null, itemCount: 4, recordsCents: 53626, adjustmentsCents: 0, lineCents: 53626, balanceBeforeCents: 0,
      recoveredCents: 0, carriedCents: 0, payCents: 53626,
      items: [
        { transactionId: 'a1', kind: 'policy', origin: 'recorded', agentCents: 25000, netCents: 1000000, late: false },
        { transactionId: 'a2', kind: 'policy', origin: 'recorded', agentCents: 21126, netCents: 845050, late: false },
        { transactionId: 'a3', kind: 'policy', origin: 'recorded', agentCents: 12500, netCents: 500000, late: true },
        { transactionId: 'a5', kind: 'cancellation', origin: 'admin', agentCents: -5000, netCents: -200000, late: false },
      ],
      adjustments: [],
    },
    {
      agent: 'b', agentName: 'Agent B', status: 'draft', payoutId: null, itemCount: 2, recordsCents: -24000, adjustmentsCents: 0, lineCents: -24000, balanceBeforeCents: 0,
      recoveredCents: 0, carriedCents: -24000, payCents: 0,
      items: [{ transactionId: 'b1', kind: 'policy', agentCents: 16000 }, { transactionId: 'b2', kind: 'cancellation', agentCents: -40000 }],
      adjustments: [],
    },
    { agent: 'c', agentName: 'Agent C', status: 'approved', payoutId: 'p', itemCount: 1, recordsCents: 1000, lineCents: 1000, payCents: 1000, items: [{ transactionId: 'c1', agentCents: 1000 }], adjustments: [] },
  ],
  waiting: [{ transactionId: 'a4', status: 'missing_proof', flags: [], holdReason: null }, { transactionId: 'a6', status: 'verified', flags: ['changed_since_recorded'] }],
});

describe('a payout run', () => {
  it("maps the database's run details", () => {
    expect(details.run.payDate).toBe('2026-09-18');
    expect(details.lines[0].items[2].late).toBe(true);
    expect(details.waiting).toHaveLength(2);
  });
  it('adds up the summary: commission, cancellations, to pay, carried', () => {
    expect(runTotals(details.lines)).toEqual({ commissionCents: 25000 + 21126 + 12500 + 16000 + 1000, deductionsCents: -45000, adjustmentsCents: 0, recoveredCents: 0, payCents: 54626, carriedCents: -24000 });
  });
  it('"Approve all ready": the draft lines with something in them, once the period is over', () => {
    expect(readyLines(details).map((l) => l.agent)).toEqual(['a', 'b']);
    expect(readyLines({ ...details, run: { ...details.run, periodOver: false } })).toEqual([]);
    expect(readyLines({ ...details, run: { ...details.run, closedAt: '2026-09-15T00:00:00Z' } })).toEqual([]);
  });
  it('says why a record waits', () => {
    expect(waitingReason(details.waiting[0])).toBe('Missing Document');
    expect(waitingReason(details.waiting[1])).toMatch(/changed/i);
    expect(waitingReason({ status: 'verified', flags: [], holdReason: 'Client disputes the premium' })).toBe('Held: Client disputes the premium');
  });
  it('labels the period', () => {
    expect(runPeriodLabel(details.run)).toBe('Policies bound Sep 7 – 13, 2026');
    expect(runPeriodLabel({ stream: 'weekly', periodStart: '2026-09-28', periodEnd: '2026-10-04' })).toBe('Policies bound Sep 28 – Oct 4, 2026');
    expect(runPeriodLabel({ stream: 'monthly', periodStart: '2026-09-01', periodEnd: '2026-09-30' })).toBe('Endorsements in September 2026');
  });
});

describe('where a run stands', () => {
  const run = toRun({ id: 'r1', stream: 'weekly', period_start: '2026-09-07', period_end: '2026-09-13', pay_date: '2026-09-18' });
  const payout = (status: string, pay: number) => toPayout({ id: 'p', run_id: 'r1', agent_user_id: 'a', status, pay_cents: pay });
  it('open during the week, then ready for review', () => {
    expect(runState(run, [], '2026-09-13')).toBe('open');
    expect(runState(run, [], '2026-09-14')).toBe('review');
  });
  it('closed: payments still to mark, paid, or nothing paid', () => {
    const closed = { ...run, closedAt: '2026-09-15T00:00:00Z' };
    expect(runState(closed, [payout('approved', 100)])).toBe('approved');
    expect(runState(closed, [payout('paid', 100), payout('approved', 0)])).toBe('paid');
    expect(runState(closed, [payout('cancelled', 100)])).toBe('closed');
  });
});

describe('one balance per agent, across weekly and monthly payouts', () => {
  const e = (id: string, kind: string, amount: number, extra: Record<string, unknown> = {}) =>
    toBalanceEntry({ id, agent_user_id: 'b', kind, amount_cents: amount, created_at: `2026-09-${10 + Number(id.slice(1))}T00:00:00Z`, ...extra });
  it("carried amounts, what was recovered or written off against each, and what's left", () => {
    const [b] = agentBalances([
      e('e1', 'carried', -24000, { payout_id: 'p1' }),
      e('e2', 'recovered', 6000, { payout_id: 'p2', applies_to: 'e1' }),
      e('e3', 'written_off', 1000, { applies_to: 'e1', reason: 'Carrier error' }),
      e('e4', 'recovered', 17000, { payout_id: 'p3', applies_to: 'e1', voided_at: '2026-09-20T00:00:00Z' }),
    ]);
    expect(b.balanceCents).toBe(-17000);
    expect(b.carried).toHaveLength(1);
    expect(b.carried[0].leftCents).toBe(17000);
    expect(b.carried[0].reductions.map((r) => r.kind)).toEqual(['recovered', 'written_off']);
  });
});
