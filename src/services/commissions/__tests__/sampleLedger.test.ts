import { describe, expect, it } from 'vitest';
import { lineFor, statement } from '../calc';
import { addAdjustment, addTransaction, clearSampleLedger, editTransaction, freshSampleLedger, loadSampleLedger, reverseAdjustment, saveSampleLedger, setDefaultSplit, toCsv, type SampleLedger } from '../sampleLedger';
import { commissionsAccess, commissionsFeatureEnabled } from '../access';
import { ASSUMPTIONS } from '../assumptions';

const ok = (r: ReturnType<typeof editTransaction>): SampleLedger => {
  if (!r.ok) throw new Error(r.errors.join(' '));
  return r.ledger;
};
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('sample ledger changes', () => {
  it('starts with the sample data and an audit history for its adjustments', () => {
    const l = freshSampleLedger();
    expect(l.transactions).toHaveLength(14);
    expect(l.audit.map((e) => e.action)).toEqual(['Sample data loaded', 'Manual adjustment', 'Manual adjustment']);
  });

  it('editing a premium recalculates the line and records before → after', () => {
    const l = ok(editTransaction(freshSampleLedger(), 't07', 'premium', 700_000, 'Avery Admin'));
    expect(lineFor(l.transactions.find((t) => t.id === 't07')!)).toMatchObject({ gross: 87_500, agent: 35_000 });
    expect(l.audit.at(-1)).toMatchObject({ by: 'Avery Admin', action: 'Changed premium' });
    expect(l.audit.at(-1)!.detail).toContain('$6,350.00 → $7,000.00');
    expect(statement(l, '2026-10').totals.gross).toBe(873_800);
  });

  it('an invalid edit changes nothing; an unchanged value adds no audit entry', () => {
    const l = freshSampleLedger();
    expect(editTransaction(l, 't13', 'rate', null, 'x').ok).toBe(false);
    const same = ok(editTransaction(l, 't13', 'split', 60_000, 'x'));
    expect(same.audit).toHaveLength(l.audit.length);
  });

  it('a negative premium typed on a cancellation is stored positive (the type gives the sign)', () => {
    const l = ok(editTransaction(freshSampleLedger(), 't09', 'premium', -1_000_000, 'x'));
    expect(lineFor(l.transactions.find((t) => t.id === 't09')!).gross).toBe(-100_000);
  });

  it('adding a cancellation uses the producer’s default split and is negative', () => {
    const r = addTransaction(freshSampleLedger(), { date: '2026-10-21', account: 'Sample Co', policy: 'SMP-AL-24099', carrier: 'Prairie Mutual (sample)', type: 'cancellation', premiumCents: 100_000, rateMilli: 10_000, producerId: 'p-alex', splitMilli: undefined }, 'x');
    const l = ok(r);
    const tx = l.transactions.at(-1)!;
    expect(lineFor(tx)).toMatchObject({ month: '2026-10', splitMilli: 40_000, gross: -10_000, agent: -4_000 });
    expect(l.audit.at(-1)!.action).toBe('Added transaction');
  });

  it('adding a transaction requires its fields', () => {
    const r = addTransaction(freshSampleLedger(), { date: '', account: ' ', policy: '', carrier: '', type: 'renewal', premiumCents: null, rateMilli: null, producerId: '', splitMilli: undefined }, 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(6);
  });

  it('an adjustment needs a reason; recorded ones change payout, not gross', () => {
    expect(addAdjustment(freshSampleLedger(), { month: '2026-10', producerId: 'p-casey', amountCents: -25_000, reason: '' }, 'x').ok).toBe(false);
    const l = ok(addAdjustment(freshSampleLedger(), { month: '2026-10', producerId: 'p-casey', amountCents: -25_000, reason: 'Clawback test' }, 'Avery Admin', '2026-10-17T12:00:00Z'));
    const casey = statement(l, '2026-10').rows.find((r) => r.producer.id === 'p-casey')!;
    expect([casey.gross, casey.adjTotal, casey.payable]).toEqual([416_000, -25_000, 224_600]);
    expect(l.audit.at(-1)).toMatchObject({ action: 'Manual adjustment', reason: 'Clawback test', by: 'Avery Admin' });
  });

  it('reversal: needs a reason, keeps the original, can’t be repeated or reversed again', () => {
    const base = ok(addAdjustment(freshSampleLedger(), { month: '2026-10', producerId: 'p-casey', amountCents: -25_000, reason: 'Clawback test' }, 'x'));
    const id = base.adjustments.at(-1)!.id;
    expect(reverseAdjustment(base, id, ' ', 'x').ok).toBe(false);
    const l = ok(reverseAdjustment(base, id, 'Wrong producer', 'x'));
    expect(l.adjustments.filter((a) => a.id === id)).toHaveLength(1);
    const rev = l.adjustments.at(-1)!;
    expect([rev.amountCents, rev.reversesId]).toEqual([25_000, id]);
    expect(reverseAdjustment(l, id, 'Again please', 'x').ok).toBe(false);
    expect(reverseAdjustment(l, rev.id, 'Undo the undo', 'x').ok).toBe(false);
    expect(statement(l, '2026-10').rows.find((r) => r.producer.id === 'p-casey')!.adjTotal).toBe(0);
  });

  it('a new default split applies to new transactions only', () => {
    const l = ok(setDefaultSplit(freshSampleLedger(), 'p-alex', 42_500, 'x'));
    expect(l.transactions.find((t) => t.id === 't08')!.splitMilli).toBe(40_000);
    const added = ok(addTransaction(l, { date: '2026-10-22', account: 'A', policy: 'SMP-1', carrier: 'c', type: 'renewal', premiumCents: 100_000, rateMilli: 10_000, producerId: 'p-alex', splitMilli: undefined }, 'x'));
    expect(added.transactions.at(-1)!.splitMilli).toBe(42_500);
  });

  it('is kept per user in browser storage; Reset clears it; bad data falls back to the sample', () => {
    const s = memory();
    const edited = ok(editTransaction(freshSampleLedger(), 't07', 'premium', 700_000, 'x'));
    saveSampleLedger('user-a', edited, s);
    expect(loadSampleLedger('user-a', s).transactions.find((t) => t.id === 't07')!.premiumCents).toBe(700_000);
    expect(loadSampleLedger('user-b', s).transactions.find((t) => t.id === 't07')!.premiumCents).toBe(635_000);
    expect(Object.isFrozen(loadSampleLedger('user-a', s).audit[0])).toBe(true);
    clearSampleLedger('user-a', s);
    expect(loadSampleLedger('user-a', s).transactions.find((t) => t.id === 't07')!.premiumCents).toBe(635_000);
    s.setItem([...s.m.keys()][0] ?? 'renewaliq-commissions-sample:v2:user-c', '{not json');
    expect(loadSampleLedger('user-c', s).transactions).toHaveLength(14);
  });

  it('CSV neutralises spreadsheet formulas and quotes properly', () => {
    expect(toCsv([['=HYPERLINK("x")', '-12.50', 'a,b', '@sum']])).toBe(`"'=HYPERLINK(""x"")",-12.50,"a,b",'@sum`);
  });
});

describe('access', () => {
  it('only agency admins, and only when the section is switched on', () => {
    expect(commissionsAccess({ role: 'admin' }, true)).toBe('allowed');
    expect(commissionsAccess({ role: 'agent' }, true)).toBe('not-admin');
    expect(commissionsAccess(null, true)).toBe('no-agency');
    expect(commissionsAccess(undefined, true)).toBe('no-agency');
    expect(commissionsAccess({ role: 'admin' }, false)).toBe('feature-off');
  });
  it('switched off in production builds unless VITE_FEATURE_COMMISSIONS=true; on in development unless false', () => {
    expect(commissionsFeatureEnabled({ DEV: false })).toBe(false);
    expect(commissionsFeatureEnabled({ DEV: false, VITE_FEATURE_COMMISSIONS: '' })).toBe(false);
    expect(commissionsFeatureEnabled({ DEV: false, VITE_FEATURE_COMMISSIONS: 'yes' })).toBe(false);
    expect(commissionsFeatureEnabled({ DEV: false, VITE_FEATURE_COMMISSIONS: 'true' })).toBe(true);
    expect(commissionsFeatureEnabled({ DEV: true })).toBe(true);
    expect(commissionsFeatureEnabled({ DEV: true, VITE_FEATURE_COMMISSIONS: 'false' })).toBe(false);
  });
});

describe('assumptions', () => {
  it('eleven unconfirmed rules, numbered A1–A11, each with a question and what the preview does now', () => {
    expect(ASSUMPTIONS.map((a) => a.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11']);
    expect(ASSUMPTIONS.every((a) => a.question.endsWith('?') && a.current.length > 20)).toBe(true);
  });
});
