import { describe, expect, it } from 'vitest';
import * as C from '../calc';
import { SAMPLE_ADJUSTMENTS, SAMPLE_CARRIERS, SAMPLE_PRODUCERS, SAMPLE_TRANSACTIONS } from '../sampleData';

// Expected figures computed independently (Python Decimal, half away from zero) — see the PR notes; not by this code.
const state = (): C.LedgerState => ({ producers: SAMPLE_PRODUCERS, transactions: SAMPLE_TRANSACTIONS, adjustments: SAMPLE_ADJUSTMENTS });
const row = (st: C.Statement, id: string) => st.rows.find((r) => r.producer.id === id)!;

describe('commission formula', () => {
  it('$48,000 at 12.5% with a 40% example split', () => {
    expect(C.calcLine({ premiumCents: 4_800_000, rateMilli: 12_500, splitMilli: 40_000 })).toEqual({ gross: 600_000, agent: 240_000, retained: 360_000 });
  });
  it('other example splits (55%, 60%)', () => {
    expect(C.calcLine({ premiumCents: 2_275_000, rateMilli: 15_000, splitMilli: 55_000 })).toEqual({ gross: 341_250, agent: 187_688, retained: 153_562 });
    expect(C.calcLine({ premiumCents: 6_120_000, rateMilli: 12_000, splitMilli: 60_000 })).toEqual({ gross: 734_400, agent: 440_640, retained: 293_760 });
  });
  it('edge cases: a 0% split leaves everything with the agency, a 100% split pays it all out', () => {
    expect(C.calcLine({ premiumCents: 1_840_000, rateMilli: 10_000, splitMilli: 0 })).toEqual({ gross: 184_000, agent: 0, retained: 184_000 });
    expect(C.calcLine({ premiumCents: 1_840_000, rateMilli: 10_000, splitMilli: 100_000 })).toEqual({ gross: 184_000, agent: 184_000, retained: 0 });
  });
  it('rounds per line to the cent, half away from zero, and every line ties', () => {
    // $1,876.875 → $1,876.88 and −$1,231.875 → −$1,231.88 (half away from zero)
    expect(C.calcLine({ premiumCents: 2_275_000, rateMilli: 15_000, splitMilli: 55_000 }).agent).toBe(187_688);
    expect(C.calcLine({ premiumCents: -2_737_500, rateMilli: 10_000, splitMilli: 45_000 })).toEqual({ gross: -273_750, agent: -123_188, retained: -150_562 });
    expect(C.calcLine({ premiumCents: -198_000, rateMilli: 15_000, splitMilli: 55_000 })).toEqual({ gross: -29_700, agent: -16_335, retained: -13_365 });
    expect(C.mulDivRound(3, 50_000, 100_000)).toBe(2);
    expect(C.mulDivRound(-3, 50_000, 100_000)).toBe(-2);
    expect(C.mulDivRound(-1, 50_000, 100_000)).toBe(-1);
    expect(C.mulDivRound(1, 49_999, 100_000)).toBe(0);
    for (const premiumCents of [1, 99, 12_345, 987_654_321, -555, -1_000_001])
      for (const rateMilli of [1, 7_777, 12_500, 15_000])
        for (const splitMilli of [0, 33_333, 40_000, 55_000, 100_000]) {
          const l = C.calcLine({ premiumCents, rateMilli, splitMilli });
          expect(l.gross).toBe(l.agent + l.retained);
        }
  });
  it('cancellations and return premium are negative (chargebacks)', () => {
    expect(C.signedPremium('cancellation', 2_737_500)).toBe(-2_737_500);
    expect(C.signedPremium('endorsement_return', -198_000)).toBe(-198_000);
    expect(C.signedPremium('endorsement_add', 635_000)).toBe(635_000);
    const l = C.lineFor({ ...SAMPLE_TRANSACTIONS[0], type: 'cancellation', premiumCents: 2_737_500, rateMilli: 10_000, splitMilli: 45_000 });
    expect([l.signedPremiumCents, l.gross, l.agent, l.retained]).toEqual([-2_737_500, -273_750, -123_188, -150_562]);
  });
});

describe('monthly statement', () => {
  it('September: Casey’s correction lowers the payout and goes back to the agency', () => {
    const st = C.statement(state(), '2026-09');
    const casey = row(st, 'p-casey');
    expect([casey.gross, casey.agent, casey.adjTotal, casey.retained, casey.payable]).toEqual([734_400, 440_640, -12_000, 305_760, 428_640]);
    expect([st.totals.gross, st.totals.agent, st.totals.adjTotal, st.totals.retained, st.totals.payable]).toEqual([2_266_650, 1_115_878, -12_000, 1_162_772, 1_103_878]);
    expect(C.ties(st)).toBe(true);
  });
  it('October: Jordan’s cancellation makes the month negative, carried forward', () => {
    const st = C.statement(state(), '2026-10');
    const jordan = row(st, 'p-jordan');
    expect(jordan.broughtForward).toBe(0);
    expect([jordan.gross, jordan.agent, jordan.payable, jordan.carriedForward]).toEqual([-215_750, -97_088, 0, -97_088]);
    const sam = row(st, 'p-sam');
    expect([sam.gross, sam.agent, sam.adjTotal, sam.retained, sam.payable]).toEqual([189_300, 104_115, 7_500, 77_685, 111_615]);
    expect([st.totals.gross, st.totals.agent, st.totals.adjTotal, st.totals.retained, st.totals.payable, st.totals.carriedForward]).toEqual([865_675, 445_927, 7_500, 412_248, 550_515, -97_088]);
    expect(C.ties(st)).toBe(true);
  });
  it('a carried-forward negative is netted against the next month', () => {
    const s = state();
    const nov = { ...s, transactions: [...s.transactions, { ...SAMPLE_TRANSACTIONS[0], id: 'tx', month: '2026-11', date: '2026-11-03', type: 'new_business' as const, premiumCents: 3_000_000, rateMilli: 10_000, producerId: 'p-jordan', splitMilli: 45_000 }] };
    const jordan = row(C.statement(nov, '2026-11'), 'p-jordan');
    // $30,000 × 10% × 45% = $1,350.00, less $970.88 brought forward = $379.12
    expect([jordan.agent, jordan.broughtForward, jordan.payable, jordan.carriedForward]).toEqual([135_000, -97_088, 37_912, 0]);
  });
  it('one producer’s statement shows only that producer', () => {
    const st = C.statement(state(), '2026-10', 'p-alex');
    expect(st.rows).toHaveLength(1);
    expect([st.totals.gross, st.totals.agent]).toEqual([453_125, 181_250]);
  });
  it('month helpers', () => {
    expect(C.monthsOf(state())).toEqual(['2026-09', '2026-10']);
    expect(C.monthLabel('2026-10')).toBe('October 2026');
    expect(C.nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('parsing and formatting', () => {
  it('money and percentages', () => {
    expect(C.parseMoney('$1,234.56')).toBe(123_456);
    expect(C.parseMoney('(500)')).toBe(-50_000);
    expect(C.parseMoney('-0.5')).toBe(-50);
    expect(C.parseMoney('−40.00')).toBe(-4_000);
    expect(C.parseMoney('1.234')).toBeNull();
    expect(C.parseMoney('abc')).toBeNull();
    expect(C.parseMoney('')).toBeNull();
    expect(C.parsePct('12.5')).toBe(12_500);
    expect(C.parsePct('12.5%')).toBe(12_500);
    expect(C.parsePct('100')).toBe(100_000);
    expect(C.parsePct('100.001')).toBeNull();
    expect(C.parsePct('-1')).toBeNull();
    expect(C.parsePct('12.3456')).toBeNull();
    expect(C.fmtMoney(-82_125)).toBe('−$821.25');
    expect(C.fmtMoney(123_456_789)).toBe('$1,234,567.89');
    expect(C.fmtPct(12_500)).toBe('12.5%');
    expect(C.moneyInput(-4_000)).toBe('-40.00');
    expect(C.pctInput(12_500)).toBe('12.5');
  });
});

describe('audit and adjustments', () => {
  it('the audit history is append-only', () => {
    const a1 = C.appendAudit([], { action: 'Adjustment', detail: 'x', reason: 'because' });
    const a2 = C.appendAudit(a1, { action: 'Edit', detail: 'y' });
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(2);
    expect(a2[1].seq).toBe(2);
    expect(() => {
      (a2[0] as { detail: string }).detail = 'changed';
    }).toThrow(TypeError);
    expect(() => (a2 as C.AuditEntry[]).pop()).toThrow(TypeError);
  });
  it('an adjustment needs a producer, month, non-zero amount and a reason', () => {
    expect(C.validateAdjustment({ producerId: 'p-alex', month: '2026-10', amountCents: 2_500, reason: 'Agreed bonus' })).toEqual([]);
    expect(C.validateAdjustment({ producerId: '', month: '', amountCents: 0, reason: ' ' })).toHaveLength(4);
    expect(C.validateAdjustment({ producerId: 'p', month: '2026-10', amountCents: null, reason: 'valid reason' })[0]).toMatch(/amount/);
  });
});

describe('sample data is fictional', () => {
  it('has no email addresses, sample policy numbers and sample carriers only', () => {
    const text = JSON.stringify({ SAMPLE_PRODUCERS, SAMPLE_TRANSACTIONS, SAMPLE_ADJUSTMENTS });
    expect(text).not.toMatch(/@/);
    expect(SAMPLE_TRANSACTIONS.every((t) => t.policy.startsWith('SMP-'))).toBe(true);
    expect(SAMPLE_CARRIERS.every((c) => c.endsWith('(sample)'))).toBe(true);
    expect(SAMPLE_ADJUSTMENTS.every((a) => a.reason.includes('(sample)'))).toBe(true);
  });
  it('uses only the fictional example splits', () => {
    const examples = [40_000, 45_000, 55_000, 60_000, 35_000];
    expect(SAMPLE_PRODUCERS.map((p) => p.splitMilli)).toEqual(examples);
    expect(SAMPLE_TRANSACTIONS.every((t) => examples.includes(t.splitMilli))).toBe(true);
  });
});
