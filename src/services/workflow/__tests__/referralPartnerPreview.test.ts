import { describe, expect, it } from 'vitest';
import { agentBrokerFeeShareCents, isFirstPolicy, referralPartnerSplit } from '../policies';

const half = { mode: 'percent' as const, value: 0.5 };
const p = (id: string, boundDate: string, createdAt = '2026-10-01T00:00:00Z') => ({ id, boundDate, createdAt });

describe('broker fee preview with a referral partner (0083 rules)', () => {
  it('first policy: $400 fee, $75 partner, 50% share → $162.50', () => {
    const s = referralPartnerSplit(40000, 7500);
    expect(s).toEqual({ partnerCents: 7500, shortfallCents: 0 });
    expect(agentBrokerFeeShareCents(40000, half, s.partnerCents)).toBe(16250);
  });
  it('a later policy: no partner → $200', () => {
    expect(agentBrokerFeeShareCents(40000, half, 0)).toBe(20000);
  });
  it('fee smaller than the partner amount: the rest is a shortfall', () => {
    expect(referralPartnerSplit(3000, 5000)).toEqual({ partnerCents: 3000, shortfallCents: 2000 });
  });
  it('a new policy on a client with no policies is the first', () => {
    expect(isFirstPolicy([], { id: null, boundDate: '2026-10-30' })).toBe(true);
  });
  it('a new policy after an existing one is not the first', () => {
    expect(isFirstPolicy([p('a', '2026-09-01')], { id: null, boundDate: '2026-10-30' })).toBe(false);
  });
  it('bound earlier than the existing one: it becomes the first', () => {
    expect(isFirstPolicy([p('a', '2026-09-01')], { id: null, boundDate: '2026-08-01' })).toBe(true);
  });
  it('editing: uses the date typed in the form; no date sorts last', () => {
    const list = [p('a', '2026-09-01'), p('b', '2026-10-01')];
    expect(isFirstPolicy(list, { id: 'a' })).toBe(true);
    expect(isFirstPolicy(list, { id: 'b', boundDate: '2026-08-01' })).toBe(true);
    expect(isFirstPolicy([p('a', '')], { id: null, boundDate: '2026-10-30' })).toBe(true);
  });
});
