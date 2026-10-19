import { describe, expect, it } from 'vitest';
import { CARRIER_COMMISSION_CATEGORY, checkMoneyEntry, monthLabel, profitAndLoss, type MoneyEntry } from '../money';
import { moneyReport, profitLossReport } from '../../reports/analyticsReports';
import { reportCsv } from '../../reports/report';
import type { PolicyRow } from '../../workflow/policies';
import type { PolicyRecord } from '../../../types';

// Fictional data only.
const entry = (patch: Partial<MoneyEntry>): MoneyEntry => ({ id: 'e', kind: 'expense', date: '2026-10-01', category: 'Rent', description: '', amountCents: 0, notes: '', createdAt: '', updatedAt: '', ...patch });
const row = (policy: Partial<PolicyRecord>, assignedUserId: string | null = 'agent-a'): PolicyRow => ({
  policy: { id: 'p', carrier: 'Sample Mutual', businessType: 'new', boundDate: '2026-10-03', netPremiumCents: 0, taxesCents: 0, feesCents: 0, createdAt: '', updatedAt: '', ...policy },
  accountId: 'a',
  insured: 'Sample Haulers',
  quoteId: 'q',
  marketName: 'Sample Mutual',
  marketBound: true,
  assignedUserId,
});

describe('checkMoneyEntry', () => {
  it('needs a date, a category and an amount over zero', () => {
    const r = checkMoneyEntry({ kind: 'expense', date: '', category: ' ', description: '', amount: '', notes: '' });
    expect(!r.ok && r.errors).toEqual(['Choose the date.', 'Choose or type a category.', 'Enter the amount.']);
    expect(checkMoneyEntry({ kind: 'expense', date: '2026-10-01', category: 'Rent', description: '', amount: '0', notes: '' }).ok).toBe(false);
    expect(checkMoneyEntry({ kind: 'expense', date: '2026-10-01', category: 'Rent', description: '', amount: '-5', notes: '' }).ok).toBe(false);
  });
  it('reads amounts with commas and cents', () => {
    const r = checkMoneyEntry({ kind: 'income', date: '2026-10-05', category: ' Carrier commission ', description: ' October ', amount: '$12,345.67', notes: '' });
    expect(r.ok && r.fields).toEqual({ kind: 'income', date: '2026-10-05', category: 'Carrier commission', description: 'October', amountCents: 1_234_567, notes: '' });
  });
});

describe('profitAndLoss', () => {
  it('flags income recorded by hand as carrier commission (it may now be counted twice)', () => {
    const entries = [
      entry({ id: 'a', kind: 'income', category: 'Carrier commission', amountCents: 50_000 }),
      entry({ id: 'b', kind: 'income', category: 'Agency fees', amountCents: 10_000 }),
      entry({ id: 'c', kind: 'income', category: 'Carrier commission', date: '2025-01-01', amountCents: 1 }),
    ];
    const pl = profitAndLoss(entries, [], {}, '2026-10-01', '2026-10-31');
    expect(pl.recordedCarrierEntries).toBe(1);
    expect(pl.otherIncomeCents).toBe(60_000);
    expect(profitAndLoss([entries[1]], [], {}, '2026-10-01', '2026-10-31').recordedCarrierEntries).toBe(0);
  });
  const entries = [
    entry({ id: 'i1', kind: 'income', date: '2026-10-05', category: 'Contingency / bonus', amountCents: 1_000_000 }),
    entry({ id: 'i2', kind: 'income', date: '2026-11-05', category: 'Agency fees', amountCents: 50_000 }),
    entry({ id: 'x1', kind: 'expense', date: '2026-10-01', category: 'Rent', amountCents: 250_000 }),
    entry({ id: 'x2', kind: 'expense', date: '2026-11-01', category: 'Rent', amountCents: 250_000 }),
    entry({ id: 'x3', kind: 'expense', date: '2026-09-30', category: 'Marketing', amountCents: 99_999 }), // outside the period
  ];
  const rows = [
    row({ id: 'p1', boundDate: '2026-10-03', netPremiumCents: 1_000_000 }), // Sample Mutual at 15%
    row({ id: 'e1', kind: 'endorsement', boundDate: '2026-11-10', netPremiumCents: -200_000 }),
    row({ id: 'p2', boundDate: '2026-10-20', netPremiumCents: 500_000, carrier: 'Other Specialty' }, null), // no agent; carrier at the 10% default
    row({ id: 'p3', boundDate: '2026-10-21', netPremiumCents: 500_000 }, 'agent-without-rate'),
  ];
  // Agent on 25% (always of 10% of net); Sample Mutual pays the agency 15%, Other Specialty is at the 10% default.
  const pl = profitAndLoss(entries, rows, { 'agent-a': 0.25 }, '2026-10-01', '2026-11-30', { 'sample mutual': 0.15 });

  it('the carrier % doesn’t change the agent commission: 25% of 10% of net', () => {
    expect(pl.commissionCents).toBe(20_000); // 10,000 × 10% × 25% = 250; −2,000 × 10% × 25% = −50
    expect(pl.commissionMissing).toBe(2);
  });
  it('carrier commission on the policies is income: net × each carrier’s %', () => {
    // 10,000 × 15% = 1,500; −2,000 × 15% = −300; 5,000 × 10% = 500; 5,000 × 15% = 750
    expect(pl.carrierCents).toBe(245_000);
    expect(pl.carrierDefaultCount).toBe(1);
    expect(pl.otherIncomeCents).toBe(1_050_000);
    expect(pl.incomeCents).toBe(1_295_000);
    expect(pl.expenseCents).toBe(500_000);
    expect(pl.profitCents).toBe(775_000);
    expect(pl.premiumNetCents).toBe(1_800_000);
  });
  it('by category, largest first (carrier commission as its own line)', () => {
    expect(pl.income.map((c) => [c.category, c.cents])).toEqual([['Contingency / bonus', 1_000_000], [CARRIER_COMMISSION_CATEGORY, 245_000], ['Agency fees', 50_000]]);
    expect(pl.expenses).toEqual([{ category: 'Rent', cents: 500_000, count: 2 }]);
  });
  it('by month', () => {
    expect(pl.months).toEqual([
      { month: '2026-10', carrierCents: 275_000, otherIncomeCents: 1_000_000, incomeCents: 1_275_000, expenseCents: 250_000, commissionCents: 25_000, profitCents: 1_000_000 },
      { month: '2026-11', carrierCents: -30_000, otherIncomeCents: 50_000, incomeCents: 20_000, expenseCents: 250_000, commissionCents: -5_000, profitCents: -225_000 },
    ]);
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
  it('a loss is negative', () => {
    expect(profitAndLoss([entry({ amountCents: 1000 })], [], {}, '', '').profitCents).toBe(-1000);
  });
  it('reports: entries (expenses negative, net total) and the P&L by month with totals', () => {
    const r = moneyReport([entries[0], entry({ date: '2026-10-02', description: 'Rent, "October"', amountCents: 250_000 })], '2026-10-01', '2026-10-31', []);
    expect(reportCsv(r)).toBe('Date,Type,Category,Description,Amount,Notes\n2026-10-02,Expense,Rent,"Rent, ""October""",-2500.00,\n2026-10-05,Income,Contingency / bonus,,10000.00,\nNet,,,,7500.00,\n');
    const csv = reportCsv(profitLossReport(pl, '2026-10-01', '2026-11-30')).split('\n');
    expect(csv[0]).toBe('Month,Carrier commission,Other income,Total income,Expenses,Agent commission,Profit / loss');
    expect(csv[1]).toBe('Oct 2026,2750.00,10000.00,12750.00,2500.00,250.00,10000.00');
    expect(csv[3]).toBe('Total,2450.00,10500.00,12950.00,5000.00,200.00,7750.00');
  });
});
