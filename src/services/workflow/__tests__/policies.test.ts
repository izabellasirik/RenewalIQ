import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountsStore } from '../../../state/useAccountsStore';
import type { MarketQuote, PolicyRecord } from '../../../types';
import { mergeQuotes } from '../mergeCloud';
import {
  activePolicies,
  checkPolicy,
  filterPolicies,
  formatCents,
  normalizePolicies,
  oneYearAfter,
  parseMoneyCents,
  policiesFeatureEnabled,
  policyRows,
  policyTotalCents,
  policyTotals,
  presetRange,
  type PolicyFields,
  type PolicyInput,
} from '../policies';

const store = () => useAccountsStore.getState();

beforeEach(() => {
  useAccountsStore.setState({ accounts: [], hiddenAccounts: [], accountOwners: {}, cloudAccountIds: {}, missingItems: {}, quotes: {}, riskProfiles: {}, documents: {}, activityLog: {}, currentUserId: null, currentUserEmail: null });
});

const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  quoteOptionId: '',
  policyNumber: 'SMP-AL-1001',
  carrier: 'Prairie Mutual (sample)',
  coverage: 'auto_liability',
  businessType: 'new',
  boundDate: '2026-10-14',
  effectiveDate: '2026-11-01',
  expirationDate: '2027-11-01',
  netPremium: '$18,750.00',
  taxes: '562.50',
  fees: '150',
  ...over,
});

const fields = (over: Partial<PolicyInput> = {}): PolicyFields => {
  const r = checkPolicy(input(over));
  if (!r.ok) throw new Error(r.errors.join(' '));
  return r.fields;
};

describe('money in cents', () => {
  it('parses typed amounts exactly, without floating-point dollars', () => {
    expect(parseMoneyCents('$18,750.00')).toBe(1_875_000);
    expect(parseMoneyCents('0.1')).toBe(10);
    expect(parseMoneyCents('1234.5')).toBe(123_450);
    expect(parseMoneyCents('(12.00)')).toBe(-1200);
    expect(parseMoneyCents('  ')).toBeNull();
    expect(parseMoneyCents('12.345')).toBeNaN();
    expect(parseMoneyCents('abc')).toBeNaN();
    expect(formatCents(1_946_250)).toBe('$19,462.50');
    expect(formatCents(-1200)).toBe('−$12.00');
  });
  it('total = net + taxes + fees', () => {
    expect(policyTotalCents(fields())).toBe(1_875_000 + 56_250 + 15_000);
  });
});

describe('checking a policy', () => {
  it('accepts a complete policy and stores net premium, taxes and fees separately', () => {
    expect(fields()).toEqual({
      policyNumber: 'SMP-AL-1001',
      carrier: 'Prairie Mutual (sample)',
      coverage: 'auto_liability',
      businessType: 'new',
      boundDate: '2026-10-14',
      effectiveDate: '2026-11-01',
      expirationDate: '2027-11-01',
      netPremiumCents: 1_875_000,
      taxesCents: 56_250,
      feesCents: 15_000,
    });
  });
  it('requires carrier, bound date and net premium; taxes and fees may be blank (= 0)', () => {
    const r = checkPolicy(input({ carrier: ' ', boundDate: '', netPremium: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(['Enter the carrier.', 'Enter the bound date.', 'Enter the net premium.']);
    expect(fields({ taxes: '', fees: '' })).toMatchObject({ taxesCents: 0, feesCents: 0 });
  });
  it('refuses impossible dates, a term that ends before it starts, and negative or malformed amounts', () => {
    const r = checkPolicy(input({ boundDate: '2026-02-30', expirationDate: '2026-10-01', netPremium: '-5', taxes: 'ten', fees: '-1' }));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        'The bound date isn’t a valid date.',
        'The expiration date must be after the effective date.',
        'The net premium can’t be negative.',
        'Enter the taxes as an amount, e.g. 250.00 (or leave it blank).',
        'The fees can’t be negative.',
      ]);
  });
  it('the policy number is required; an effective date before binding is a warning', () => {
    const missing = checkPolicy(input({ policyNumber: '  ' }));
    expect(!missing.ok && missing.errors).toEqual(['Enter the policy number.']);
    const r = checkPolicy(input({ effectiveDate: '2026-10-01' }));
    expect(r.ok && r.warnings).toEqual(['The effective date is before the bound date.']);
  });
  it('refuses the same policy number with the same carrier on another account (case, spaces and dashes ignored)', () => {
    const existing = [{ policy: { id: 'p1', carrier: 'Prairie Mutual (sample)', policyNumber: 'smp-al 1001' } as PolicyRecord, accountId: 'a1', insured: 'Lone Pine Freight LLC', quoteId: 'q1', marketName: 'M', marketBound: true, assignedUserId: null }];
    const r = checkPolicy(input(), { existing });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(['Policy SMP-AL-1001 with Prairie Mutual (sample) is already recorded on Lone Pine Freight LLC.']);
    expect(checkPolicy(input(), { existing, editingId: 'p1' }).ok).toBe(true);
    expect(checkPolicy(input({ carrier: 'Summit Casualty (sample)' }), { existing }).ok).toBe(true);
  });
  it('a one-year term handles leap days', () => {
    expect(oneYearAfter('2026-11-01')).toBe('2027-11-01');
    expect(oneYearAfter('2028-02-29')).toBe('2029-02-28');
  });
});

describe('policies on bound markets (store)', () => {
  it('one client holds several policies across markets; each links to its market and quote', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q1 = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'submitted' });
    const opt = store().addQuoteOption(id, q1, { label: 'Option A', premium: 18750 });
    store().updateQuote(id, q1, { status: 'bound' });
    const q2 = store().addQuote(id, { marketName: 'Gulf Coast Specialty (sample)', status: 'bound' });
    const p1 = store().addPolicy(id, q1, fields({ quoteOptionId: opt }));
    store().addPolicy(id, q1, fields({ policyNumber: 'SMP-PD-1002', coverage: 'physical_damage', netPremium: '4,200' }));
    store().addPolicy(id, q2, fields({ policyNumber: 'SMP-MTC-2001', carrier: 'Gulf Coast Specialty (sample)', coverage: 'motor_truck_cargo', netPremium: '3,100' }));

    const rows = policyRows(store().accounts, store().quotes);
    expect(rows.map((r) => r.policy.policyNumber).sort()).toEqual(['SMP-AL-1001', 'SMP-MTC-2001', 'SMP-PD-1002']);
    expect(rows.find((r) => r.policy.id === p1)).toMatchObject({ quoteId: q1, insured: 'Lone Pine Freight LLC', marketBound: true, policy: { quoteOptionId: opt } });
    expect(store().activityLog[id].some((e) => e.type === 'policy_bound' && /Policy SMP-AL-1001 recorded with Prairie Mutual \(sample\): bound Oct 14.*total \$19,462\.50/.test(e.message))).toBe(true);
  });

  it('editing replaces the fields, keeps identity and creation, and logs what changed; an unchanged save does nothing', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'bound' });
    const p = store().addPolicy(id, q, fields({ policyNumber: 'SMP-TEMP-1' }));
    const before = store().quotes[id][0].policies![0];
    const logLength = store().activityLog[id].length;
    store().updatePolicy(id, q, p, { ...fields({ policyNumber: 'SMP-TEMP-1' }) });
    expect(store().activityLog[id]).toHaveLength(logLength);
    store().updatePolicy(id, q, p, fields({ policyNumber: 'SMP-AL-1001', fees: '' }));
    const after = store().quotes[id][0].policies![0];
    expect(after).toMatchObject({ id: before.id, createdAt: before.createdAt, policyNumber: 'SMP-AL-1001', feesCents: 0 });
    expect(store().activityLog[id].at(-1)!.message).toMatch(/Edited policy SMP-AL-1001: policy number SMP-AL-1001, net \$18,750\.00, total \$19,312\.50/);
  });

  it('removing a policy leaves the market and its quotes untouched', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'submitted' });
    store().addQuoteOption(id, q, { premium: 18750 });
    store().updateQuote(id, q, { status: 'bound' });
    const p = store().addPolicy(id, q, fields());
    store().removePolicy(id, q, p);
    const quote = store().quotes[id][0];
    // Kept in the data, marked removed, and hidden everywhere.
    expect(quote.policies).toHaveLength(1);
    expect(quote.policies![0]).toMatchObject({ id: p, policyNumber: 'SMP-AL-1001', netPremiumCents: 1_875_000 });
    expect(quote.policies![0].removedAt).toBeTruthy();
    expect(activePolicies(quote)).toEqual([]);
    expect(policyRows(store().accounts, store().quotes)).toEqual([]);
    expect(quote).toMatchObject({ status: 'bound', premium: 18750 });
    expect(quote.options).toHaveLength(1);
    // A removed policy can't be edited or removed again.
    const removedAt = quote.policies![0].removedAt;
    store().updatePolicy(id, q, p, fields({ netPremium: '1' }));
    store().removePolicy(id, q, p);
    expect(store().quotes[id][0].policies![0]).toMatchObject({ removedAt, netPremiumCents: 1_875_000 });
  });

  it('a market moved off "Bound" keeps its policies, flagged', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'bound' });
    store().addPolicy(id, q, fields());
    store().updateQuote(id, q, { status: 'quoted' });
    expect(policyRows(store().accounts, store().quotes)[0]).toMatchObject({ marketBound: false });
  });

  it('markets saved before policies existed still work (no policies field at all)', () => {
    const id = store().createAccount('Old Co', 'TX');
    store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'bound' });
    expect(store().quotes[id][0].policies).toBeUndefined();
    expect(policyRows(store().accounts, store().quotes)).toEqual([]);
  });
});

describe('reading policies back', () => {
  it('keeps well-formed policies, skips broken entries, and fills safe defaults', () => {
    const out = normalizePolicies([
      { id: 'p1', carrier: 'Prairie Mutual (sample)', boundDate: '2026-10-14', netPremiumCents: 100, businessType: 'renewal', createdAt: '2026-10-14T00:00:00Z' },
      { id: 'p2', carrier: 'X', boundDate: '2026-10-14', netPremiumCents: 1.5 },
      { carrier: 'no id' },
      null,
      'junk',
    ]);
    expect(out).toHaveLength(2);
    expect(out![0]).toMatchObject({ businessType: 'renewal', netPremiumCents: 100, taxesCents: 0, feesCents: 0, updatedAt: '2026-10-14T00:00:00Z' });
    expect(out![1]).toMatchObject({ businessType: 'new', netPremiumCents: 0 });
    expect(normalizePolicies(undefined)).toBeUndefined();
  });
});

describe('filtering by date', () => {
  const row = (id: string, insured: string, bound: string, eff?: string, exp?: string, net = 100_000) => ({
    policy: { id, carrier: 'Prairie Mutual (sample)', policyNumber: `SMP-${id}`, businessType: 'new', boundDate: bound, effectiveDate: eff, expirationDate: exp, netPremiumCents: net, taxesCents: 1000, feesCents: 500, createdAt: '', updatedAt: '' } as PolicyRecord,
    accountId: id,
    insured,
    quoteId: 'q',
    marketName: 'M',
    marketBound: true,
    assignedUserId: null,
  });
  const rows = [row('1', 'Alpha', '2026-09-30', '2026-10-01', '2027-10-01'), row('2', 'Bravo', '2026-10-01', '2026-10-15', '2027-10-15'), row('3', 'Charlie', '2026-10-31'), row('4', 'Delta', '2026-11-01', '2026-11-01', '2027-11-01')];

  it('bound date range is inclusive at both ends, newest first', () => {
    expect(filterPolicies(rows, { dateField: 'boundDate', from: '2026-10-01', to: '2026-10-31', search: '' }).map((r) => r.insured)).toEqual(['Charlie', 'Bravo']);
  });
  it('filtering by effective or expiration date leaves out policies without that date', () => {
    expect(filterPolicies(rows, { dateField: 'effectiveDate', from: '2026-10-01', to: '', search: '' }).map((r) => r.insured)).toEqual(['Delta', 'Bravo', 'Alpha']);
    expect(filterPolicies(rows, { dateField: 'expirationDate', from: '', to: '2027-10-31', search: '' }).map((r) => r.insured)).toEqual(['Bravo', 'Alpha']);
    expect(filterPolicies(rows, { dateField: 'effectiveDate', from: '', to: '', search: '' })).toHaveLength(4);
  });
  it('search matches insured, policy number and carrier; totals add up', () => {
    expect(filterPolicies(rows, { dateField: 'boundDate', from: '', to: '', search: 'smp-3' }).map((r) => r.insured)).toEqual(['Charlie']);
    expect(policyTotals(rows)).toEqual({ count: 4, netPremiumCents: 400_000, taxesCents: 4000, feesCents: 2000, totalCents: 406_000 });
  });
  it('quick ranges', () => {
    const today = new Date(2026, 9, 17);
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_7_days', today)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(presetRange('last_7_days', new Date(2026, 2, 3))).toEqual({ from: '2026-02-25', to: '2026-03-03' });
    expect(presetRange('all', today)).toEqual({ from: '', to: '' });
  });
  it('archived accounts are left out unless asked for', () => {
    useAccountsStore.setState({ accounts: [] });
    const id = store().createAccount('Archived Co', 'TX');
    const q = store().addQuote(id, { marketName: 'M', status: 'bound' });
    store().addPolicy(id, q, fields());
    useAccountsStore.setState((s) => ({ accounts: s.accounts.map((a) => ({ ...a, archived: true })) }));
    expect(policyRows(store().accounts, store().quotes)).toHaveLength(0);
    expect(policyRows(store().accounts, store().quotes, { includeArchived: true })).toHaveLength(1);
  });
  it('a description is written, changed or cleared from Analytics without touching the rest of the policy', () => {
    useAccountsStore.setState({ accounts: [] });
    const id = store().createAccount('Described Co', 'TX');
    const q = store().addQuote(id, { marketName: 'M', status: 'bound' });
    const p = store().addPolicy(id, q, fields());
    const get = () => store().quotes[id].find((x) => x.id === q)!.policies!.find((x) => x.id === p)!;
    const before = get();
    store().setPolicyDescription(id, q, p, '  Added two trucks  ');
    expect(get().description).toBe('Added two trucks');
    const { description, updatedAt, ...rest } = get();
    expect(description).toBeTruthy();
    expect(updatedAt).toBeTruthy();
    const { updatedAt: _u, description: _d, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    store().setPolicyDescription(id, q, p, 'x'.repeat(400));
    expect(get().description).toHaveLength(300);
    store().setPolicyDescription(id, q, p, '');
    expect('description' in get()).toBe(false);
  });
});

describe('switched on only where intended', () => {
  it('on in every build unless switched off with VITE_FEATURE_POLICIES=false', () => {
    expect(policiesFeatureEnabled({ DEV: false })).toBe(true);
    expect(policiesFeatureEnabled({ DEV: false, VITE_FEATURE_POLICIES: 'true' })).toBe(true);
    expect(policiesFeatureEnabled({ DEV: false, VITE_FEATURE_POLICIES: ' FALSE ' })).toBe(false);
    expect(policiesFeatureEnabled({ DEV: true })).toBe(true);
    expect(policiesFeatureEnabled({ DEV: true, VITE_FEATURE_POLICIES: 'false' })).toBe(false);
  });
});

describe('two copies of the same account (someone else saved in the meantime)', () => {
  const pol = (id: string, updatedAt: string, over: Partial<PolicyRecord> = {}): PolicyRecord => ({ id, carrier: 'Prairie Mutual (sample)', businessType: 'new', boundDate: '2026-10-14', netPremiumCents: 100_000, taxesCents: 0, feesCents: 0, createdAt: updatedAt, updatedAt, ...over });
  const quote = (updatedAt: string, policies: PolicyRecord[]): MarketQuote => ({ id: 'q1', accountId: 'a1', marketName: 'Prairie Mutual (sample)', status: 'bound', notes: [], policies, createdAt: '2026-10-01T00:00:00Z', updatedAt });
  const SEEN = '2026-10-14T09:00:00Z';

  it('policies added on both sides to the same market are all kept', () => {
    const local = [quote('2026-10-14T10:05:00Z', [pol('p-mine', '2026-10-14T10:05:00Z')])];
    const cloud = [quote('2026-10-14T10:00:00Z', [pol('p-theirs', '2026-10-14T10:00:00Z')])];
    expect(mergeQuotes(local, cloud, SEEN)[0].policies!.map((p) => p.id).sort()).toEqual(['p-mine', 'p-theirs']);
    // …whichever side saved last.
    expect(mergeQuotes(cloud, local, SEEN)[0].policies!.map((p) => p.id).sort()).toEqual(['p-mine', 'p-theirs']);
  });
  it('the same policy edited on both sides: the newest edit wins', () => {
    const local = [quote('2026-10-14T10:00:00Z', [pol('p1', '2026-10-14T10:00:00Z', { netPremiumCents: 111 })])];
    const cloud = [quote('2026-10-14T11:00:00Z', [pol('p1', '2026-10-14T11:00:00Z', { netPremiumCents: 222 })])];
    expect(mergeQuotes(local, cloud, SEEN)[0].policies).toEqual([expect.objectContaining({ id: 'p1', netPremiumCents: 222 })]);
  });
  it('a removal is not undone by an older copy that still has the policy', () => {
    const removed = [quote('2026-10-14T12:00:00Z', [pol('p1', '2026-10-14T12:00:00Z', { removedAt: '2026-10-14T12:00:00Z' })])];
    const stale = [quote('2026-10-14T10:00:00Z', [pol('p1', '2026-10-14T10:00:00Z')])];
    for (const [l, c] of [[removed, stale], [stale, removed]]) {
      const out = mergeQuotes(l, c, SEEN)[0];
      expect(out.policies).toHaveLength(1);
      expect(out.policies![0].removedAt).toBe('2026-10-14T12:00:00Z');
    }
  });
  it('other market changes still follow the newest copy, and markets without policies are untouched', () => {
    const local = [{ ...quote('2026-10-14T10:00:00Z', [pol('p1', '2026-10-14T10:00:00Z')]), notes: [] }];
    const cloud = [{ ...quote('2026-10-14T11:00:00Z', []), status: 'quoted' as const }];
    const out = mergeQuotes(local, cloud, SEEN)[0];
    expect(out.status).toBe('quoted');
    expect(out.policies!.map((p) => p.id)).toEqual(['p1']);
    const plain = [quote('2026-10-14T10:00:00Z', [])];
    expect(mergeQuotes(plain, plain, SEEN)).toEqual(plain);
  });
});
