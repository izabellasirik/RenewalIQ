import { describe, expect, it } from 'vitest';
import { checkMoneyEntry, moneyEntriesCsv, monthLabel, profitAndLoss, profitLossCsv, type MoneyEntry } from '../money';
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
  const entries = [
    entry({ id: 'i1', kind: 'income', date: '2026-10-05', category: 'Carrier commission', amountCents: 1_000_000 }),
    entry({ id: 'i2', kind: 'income', date: '2026-11-05', category: 'Agency fees', amountCents: 50_000 }),
    entry({ id: 'x1', kind: 'expense', date: '2026-10-01', category: 'Rent', amountCents: 250_000 }),
    entry({ id: 'x2', kind: 'expense', date: '2026-11-01', category: 'Rent', amountCents: 250_000 }),
    entry({ id: 'x3', kind: 'expense', date: '2026-09-30', category: 'Marketing', amountCents: 99_999 }), // outside the period
  ];
  const rows = [
    row({ id: 'p1', boundDate: '2026-10-03', netPremiumCents: 1_000_000 }), // 10% → 100,000
    row({ id: 'e1', kind: 'endorsement', boundDate: '2026-11-10', netPremiumCents: -200_000 }), // → −20,000
    row({ id: 'p2', boundDate: '2026-10-20', netPremiumCents: 500_000 }, null), // no agent
    row({ id: 'p3', boundDate: '2026-10-21', netPremiumCents: 500_000 }, 'agent-without-rate'),
  ];
  // Agent on 30%; p1's carrier commission set to 15%, the rest at the 10% default.
  const pl = profitAndLoss(entries, rows, { 'agent-a': 0.3 }, '2026-10-01', '2026-11-30', { 'a:p1': 0.15 });

  it('profit = income − expenses − agent commission, in the period only', () => {
    expect(pl.incomeCents).toBe(1_050_000);
    expect(pl.expenseCents).toBe(500_000);
    expect(pl.commissionCents).toBe(39_000); // 10,000 × 15% × 30% = 450; −2,000 × 10% × 30% = −60
    expect(pl.profitCents).toBe(511_000);
    expect(pl.commissionMissing).toBe(2);
    expect(pl.premiumNetCents).toBe(1_800_000);
  });
  it('by category, largest first', () => {
    expect(pl.income.map((c) => [c.category, c.cents])).toEqual([['Carrier commission', 1_000_000], ['Agency fees', 50_000]]);
    expect(pl.expenses).toEqual([{ category: 'Rent', cents: 500_000, count: 2 }]);
  });
  it('by month', () => {
    expect(pl.months).toEqual([
      { month: '2026-10', incomeCents: 1_000_000, expenseCents: 250_000, commissionCents: 45_000, profitCents: 705_000 },
      { month: '2026-11', incomeCents: 50_000, expenseCents: 250_000, commissionCents: -6_000, profitCents: -194_000 },
    ]);
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
  it('a loss is negative', () => {
    expect(profitAndLoss([entry({ amountCents: 1000 })], [], {}, '', '').profitCents).toBe(-1000);
  });
  it('CSV: entries (expenses negative) and the report', () => {
    expect(moneyEntriesCsv([entries[0], entry({ date: '2026-10-02', description: 'Rent, "October"', amountCents: 250_000 })])).toBe(
      'Date,Type,Category,Description,Amount,Notes\n2026-10-02,Expense,Rent,"Rent, ""October""",-2500.00,\n2026-10-05,Income,Carrier commission,,10000.00,\n'
    );
    expect(profitLossCsv(pl).split('\n')[1]).toBe('Oct 2026,10000.00,2500.00,450.00,7050.00');
    expect(profitLossCsv(pl).split('\n')[3]).toBe('Total,10500.00,5000.00,390.00,5110.00');
  });
});
