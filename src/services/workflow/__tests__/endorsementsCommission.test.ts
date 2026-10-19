import { describe, expect, it } from 'vitest';
import { activeEndorsements, activePolicies, agentCommissionCents, carrierCommissionCents, carrierKey, checkPolicy, policyRows, type PolicyInput } from '../policies';
import { renewalLabelOn } from '../renewals';
import { marketStatusChoice, marketStatusLabel, type AccountRenewal, type MarketQuote, type PolicyRecord } from '../../../types';

// Fictional data only.
const input = (patch: Partial<PolicyInput> = {}): PolicyInput => ({
  kind: 'policy', notes: '', quoteOptionId: '', policyNumber: 'SMP-1', carrier: 'Sample Mutual', coverage: '', businessType: 'new',
  boundDate: '2026-10-01', effectiveDate: '2026-10-05', expirationDate: '2027-10-05', netPremium: '10,000', taxes: '300', fees: '150', ...patch,
});
const rec = (patch: Partial<PolicyRecord>): PolicyRecord => ({ id: 'p', carrier: 'Sample Mutual', businessType: 'new', boundDate: '2026-10-01', netPremiumCents: 0, taxesCents: 0, feesCents: 0, createdAt: '', updatedAt: '', ...patch });

describe('agent commission = the agent’s % of 10% of net, whatever the carrier pays', () => {
  it('$10,000 net → an agent on 25% gets $250; a carrier at 15% pays the agency $1,500', () => {
    expect(agentCommissionCents(1_000_000, 0.25)).toBe(25_000);
    expect(carrierCommissionCents(1_000_000)).toBe(100_000);
    expect(carrierCommissionCents(1_000_000, 0.15)).toBe(150_000);
    expect(carrierCommissionCents(1_000_000, 0)).toBe(0);
  });
  it('one carrier however it is typed', () => {
    expect(carrierKey('  Granite   Mutual ')).toBe('granite mutual');
    expect(carrierKey('GRANITE MUTUAL')).toBe(carrierKey('granite mutual'));
  });
  it('a description is kept (trimmed, 300 characters at most)', () => {
    const ok = checkPolicy(input({ description: '  Added 2023 Freightliner  ' }));
    expect(ok.ok && ok.fields.description).toBe('Added 2023 Freightliner');
    expect(checkPolicy(input({ description: 'x'.repeat(301) })).ok).toBe(false);
  });
  it('rounds half away from zero at each step, so a return premium mirrors its charge', () => {
    expect(carrierCommissionCents(123_455)).toBe(12_346); // 12,345.5 → 12,346
    expect(agentCommissionCents(123_455, 0.125)).toBe(1543); // 12,346 × 12.5% = 1,543.25 → 1,543
    expect(agentCommissionCents(-123_455, 0.125)).toBe(-1543);
    expect(agentCommissionCents(-500_000, 0.25)).toBe(-12_500);
    expect(agentCommissionCents(0, 0.25)).toBe(0);
  });
});

describe('endorsements', () => {
  it('may be negative (a return premium); a policy may not', () => {
    const e = checkPolicy(input({ kind: 'endorsement', netPremium: '-1,250.00', taxes: '-37.50', fees: '0' }));
    expect(e.ok && e.fields).toMatchObject({ kind: 'endorsement', netPremiumCents: -125_000, taxesCents: -3750, feesCents: 0 });
    const p = checkPolicy(input({ netPremium: '-1,250.00' }));
    expect(p.ok).toBe(false);
  });
  it('ask for the endorsed date by name', () => {
    const e = checkPolicy(input({ kind: 'endorsement', boundDate: '' }));
    expect(!e.ok && e.errors).toContain('Enter the endorsed date.');
  });
  it('several endorsements on one policy number are fine; a second policy with that number is refused', () => {
    const existing = policyRows([{ id: 'a1', namedInsured: 'Sample Haulers', archived: false, assignedUserId: null }], {
      a1: [{ id: 'q1', accountId: 'a1', marketName: 'M', status: 'bound', notes: [], createdAt: '', updatedAt: '', policies: [rec({ id: 'p1', policyNumber: 'SMP-1' }), rec({ id: 'e1', kind: 'endorsement', policyNumber: 'SMP-1' })] }],
    });
    expect(checkPolicy(input({ kind: 'endorsement' }), { existing }).ok).toBe(true);
    const dup = checkPolicy(input(), { existing });
    expect(!dup.ok && dup.errors[0]).toMatch(/already recorded on Sample Haulers/);
  });
  it('keep notes; policies and endorsements are listed apart', () => {
    const ok = checkPolicy(input({ notes: '  Binder by email  ' }));
    expect(ok.ok && ok.fields.notes).toBe('Binder by email');
    const q = { policies: [rec({ id: 'p1' }), rec({ id: 'e1', kind: 'endorsement' }), rec({ id: 'e2', kind: 'endorsement', removedAt: 'x' })] };
    expect(activePolicies(q).map((p) => p.id)).toEqual(['p1']);
    expect(activeEndorsements(q).map((p) => p.id)).toEqual(['e1']);
  });
});

describe('Endorsed status', () => {
  it('is a bound market with the endorsed flag', () => {
    expect(marketStatusChoice({ status: 'bound', endorsed: true })).toBe('endorsed');
    expect(marketStatusChoice({ status: 'bound' })).toBe('bound');
    expect(marketStatusChoice({ status: 'quoted', endorsed: true } as Pick<MarketQuote, 'status' | 'endorsed'>)).toBe('quoted');
    expect(marketStatusLabel('endorsed')).toBe('Endorsed');
  });
});

describe('Renewal label', () => {
  const today = '2026-10-18';
  const main = (patch: Partial<AccountRenewal> = {}): AccountRenewal => ({ id: 'r1', main: true, status: 'open', createdAt: '', updatedAt: '', ...patch }) as AccountRenewal;
  it('automatic: on for a renewal client from the start-working date until bound', () => {
    expect(renewalLabelOn({ businessType: 'renewal', renewals: [main()] }, '2026-11-20', [], today)).toEqual({ on: true, manual: false }); // 45-day lead: started Oct 6
    expect(renewalLabelOn({ businessType: 'renewal', renewals: [main()] }, '2027-01-20', [], today).on).toBe(false); // starts Dec 6
    expect(renewalLabelOn({ businessType: 'renewal', renewals: [main()] }, '2026-10-01', [], today).on).toBe(true); // overdue, still not bound
    expect(renewalLabelOn({ businessType: 'renewal', renewals: [main({ status: 'bound', renewalDate: '2026-11-20' })] }, '2027-11-20', [{ status: 'bound' }], today).on).toBe(false);
  });
  it('automatic: off as soon as a market is bound for it, before the broker says which renewal it was', () => {
    const acct = { businessType: 'renewal' as const, renewals: [main()] };
    expect(renewalLabelOn(acct, '2026-11-20', [{ status: 'bound', boundDate: '2026-10-17' }], today).on).toBe(false);
    expect(renewalLabelOn(acct, '2026-11-20', [{ status: 'bound', boundDate: '2025-11-02' }], today).on).toBe(true); // last term's market
    expect(renewalLabelOn(acct, '2026-11-20', [{ status: 'bound', boundDate: '2026-10-17', renewalId: 'another' }], today).on).toBe(true); // bound for another renewal
    expect(renewalLabelOn(acct, '2026-11-20', [{ status: 'quoted', boundDate: '2026-10-17' }], today).on).toBe(true);
  });
  it('automatic: off for a new venture or an account that doesn’t track renewals', () => {
    expect(renewalLabelOn({ businessType: 'new_venture' }, '2026-11-01', [], today).on).toBe(false);
    expect(renewalLabelOn({}, '2026-11-01', [], today).on).toBe(false);
  });
  it('a hand choice holds until the next start-working date, then it’s automatic again', () => {
    const acct = { businessType: 'renewal' as const, renewals: [main()] };
    // Renewal Nov 20, 45-day lead: work started Oct 6.
    expect(renewalLabelOn({ ...acct, renewalLabel: false, renewalLabelSetOn: '2026-10-10' }, '2026-11-20', [], today)).toEqual({ on: false, manual: true });
    expect(renewalLabelOn({ ...acct, renewalLabel: false, renewalLabelSetOn: '2026-09-01' }, '2026-11-20', [], today)).toEqual({ on: true, manual: false });
    expect(renewalLabelOn({ ...acct, renewalLabel: true, renewalLabelSetOn: '2026-09-01' }, '2027-01-20', [], today)).toEqual({ on: true, manual: true }); // next start (Dec 6) not here yet
  });
  it('switched on or off by hand wins', () => {
    expect(renewalLabelOn({ renewalLabel: true }, null, [], today)).toEqual({ on: true, manual: true });
    expect(renewalLabelOn({ businessType: 'renewal', renewals: [main()], renewalLabel: false }, '2026-11-20', [], today)).toEqual({ on: false, manual: true });
  });
});
