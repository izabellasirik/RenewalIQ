import { describe, expect, it } from 'vitest';
import { deriveAccountStage } from '../accountStage';
import type { MarketQuote, PolicyRecord } from '../../../types';

// Fictional markets only.
const policy = (id: string): PolicyRecord => ({ id, carrier: 'Sample Mutual', boundDate: '2026-10-01', netPremiumCents: 100000, taxesCents: 0, feesCents: 0, businessType: 'new', createdAt: '2026-10-01', updatedAt: '2026-10-01' }) as PolicyRecord;
const market = (id: string, status: MarketQuote['status'], policies: PolicyRecord[] = []): MarketQuote => ({ id, marketName: id, status, policies, notes: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }) as unknown as MarketQuote;

describe('account status after a cancellation', () => {
  it('every policy fully cancelled and nothing else in play → Cancelled', () => {
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1')])], (id) => id === 'p1')).toBe('cancelled');
  });
  it('another policy still in force → Bound', () => {
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1')]), market('m2', 'bound', [policy('p2')])], (id) => id === 'p1')).toBe('bound');
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1'), policy('p2')])], (id) => id === 'p1')).toBe('bound');
  });
  it('all cancelled but another market is quoted → Quoted', () => {
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1')]), market('m2', 'quoted')], (id) => id === 'p1')).toBe('quoted');
  });
  it('without cancellation info (or none cancelled) → Bound as before', () => {
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1')])])).toBe('bound');
    expect(deriveAccountStage([], [market('m1', 'bound', [policy('p1')])], () => false)).toBe('bound');
  });
});
