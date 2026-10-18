import { describe, expect, it } from 'vitest';
import { boundRange, latestBoundIn, renewalFilterDate } from '../accountFilters';
import type { AccountRenewal, MarketQuote } from '../../../types';

const TODAY = '2026-10-18';
const renewal = (patch: Partial<AccountRenewal>): AccountRenewal => ({ id: 'r1', status: 'open', createdAt: '', updatedAt: '', ...patch }) as AccountRenewal;
const q = (status: MarketQuote['status'], boundDate?: string): Pick<MarketQuote, 'status' | 'boundDate'> => ({ status, ...(boundDate ? { boundDate } : {}) });

describe('renewal filter', () => {
  it('upcoming ("due"): from the start-working date until bound; overdue stays', () => {
    const acct = { businessType: 'renewal' as const, renewals: [renewal({ main: true })] };
    expect(renewalFilterDate(acct, '2026-11-20', [], 'due', TODAY)).toBe('2026-11-20'); // 33 days out, 45-day lead → working
    expect(renewalFilterDate(acct, '2027-01-20', [], 'due', TODAY)).toBeNull(); // starts Dec 6
    expect(renewalFilterDate(acct, '2026-10-01', [], 'due', TODAY)).toBe('2026-10-01'); // overdue, still listed
  });
  it('next 30 / 60 / 90 days: an open renewal dated between today and that many days out', () => {
    const acct = { businessType: 'renewal' as const, renewals: [renewal({ main: true, leadDays: 10 })] };
    expect(renewalFilterDate(acct, '2026-11-10', [], '30', TODAY)).toBe('2026-11-10');
    expect(renewalFilterDate(acct, '2026-12-10', [], '30', TODAY)).toBeNull();
    expect(renewalFilterDate(acct, '2026-12-10', [], '60', TODAY)).toBe('2026-12-10');
    expect(renewalFilterDate(acct, '2027-01-15', [], '90', TODAY)).toBe('2027-01-15');
    expect(renewalFilterDate(acct, '2026-10-01', [], '90', TODAY)).toBeNull(); // past dates aren't "in the next N days"
  });
  it('a renewal already bound, or not renewing, never counts', () => {
    const bound = { businessType: 'renewal' as const, renewals: [renewal({ main: true, status: 'bound', renewalDate: '2026-11-01' })] };
    expect(renewalFilterDate(bound, '2027-11-01', [q('bound')], '30', TODAY)).toBeNull();
    expect(renewalFilterDate(bound, '2027-11-01', [q('bound')], 'due', TODAY)).toBeNull();
  });
  it('the soonest of several renewals', () => {
    const acct = { businessType: 'renewal' as const, renewals: [renewal({ id: 'a', renewalDate: '2026-12-01' }), renewal({ id: 'b', renewalDate: '2026-11-05' })] };
    expect(renewalFilterDate(acct, null, [], '60', TODAY)).toBe('2026-11-05');
  });
  it('an account that doesn’t track renewals works as before (effective date, not once a market is bound)', () => {
    expect(renewalFilterDate({}, '2026-11-01', [], 'due', TODAY)).toBe('2026-11-01');
    expect(renewalFilterDate({}, '2026-11-01', [q('bound')], 'due', TODAY)).toBeNull();
    expect(renewalFilterDate({}, '2026-11-01', [], 'any', TODAY)).toBeNull();
  });
});

describe('bound in', () => {
  it('ranges', () => {
    expect(boundRange('last_7_days', TODAY)).toEqual({ from: '2026-10-12', to: TODAY });
    expect(boundRange('this_month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(boundRange('last_month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(boundRange('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(boundRange('custom', TODAY, { from: '2026-08-01', to: '2026-08-31' })).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(boundRange('custom', TODAY, { from: '2026-08-01' })).toEqual({ from: '2026-08-01', to: '9999-12-31' });
    expect(boundRange('custom', TODAY, {})).toBeNull();
    expect(boundRange('any', TODAY)).toBeNull();
  });
  it('the latest bound date in range; markets no longer Bound, or without a date, don’t count', () => {
    const range = { from: '2026-10-01', to: '2026-10-18' };
    expect(latestBoundIn([q('bound', '2026-10-03'), q('bound', '2026-10-15'), q('bound', '2026-09-30')], range)).toBe('2026-10-15');
    expect(latestBoundIn([q('quoted', '2026-10-15'), q('bound')], range)).toBeNull();
  });
});
