import { describe, expect, it } from 'vitest';
import { CARRIER_COMMISSION_CATEGORY, checkMoneyEntry, monthLabel, profitAndLoss, type MoneyEntry } from '../money';
import { moneyReport, profitLossReport } from '../../reports/analyticsReports';
import { reportCsv } from '../../reports/report';
import { carrierKey, type PolicyRow } from '../../workflow/policies';
import { toTransaction } from '../ledger';
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
  const sample = (c: string) => carrierKey(c) === 'sample mutual';
  const carrier = { rateOn: (c: string) => (sample(c) ? 0.15 : 0.1), isSet: (c: string) => sample(c) };
  const pl = profitAndLoss(entries, rows, { 'agent-a': 0.25 }, '2026-10-01', '2026-11-30', { carrier });

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

describe('profitAndLoss from commission records (0064)', () => {
  const rec = (patch: Record<string, unknown>) =>
    toTransaction({ id: 't', submission_id: 'a', client_name: 'Sample Haulers', kind: 'policy', stream: 'weekly', origin: 'recorded', carrier_name: 'Sample Mutual', carrier_key: 'sample mutual',
      event_date: '2026-10-03', payable_from: '2026-10-03', net_cents: 0, agent_rate: '0.25', agent_cents: 0, carrier_rate: '0.12', carrier_rate_source: 'carrier_rate', carrier_cents: 0,
      proof_status: 'has_proof', verification_status: 'verified', settlement: 'open', review_flags: [], ...patch });
  const rows = [row({ id: 'p1', boundDate: '2026-10-03', netPremiumCents: 1_000_000 }), row({ id: 'p9', boundDate: '2026-10-08', netPremiumCents: 200_000 })];
  // p1 was recorded at 12% (frozen); today the carrier is at 15% and the agent at 50% — the records don't move.
  const ledger = [
    rec({ id: 't1', policy_id: 'p1', net_cents: 1_000_000, agent_cents: 25_000, carrier_cents: 120_000 }),
    rec({ id: 't2', kind: 'cancellation', original_transaction_id: 't1', event_date: '2026-11-02', net_cents: -400_000, agent_cents: -10_000, carrier_cents: -48_000, carrier_rate_source: 'actual' }),
    rec({ id: 't3', kind: 'correction', original_transaction_id: 't1', event_date: '2026-10-20', net_cents: 100_000, agent_cents: 2_500, carrier_cents: 12_000 }),
    rec({ id: 't4', policy_id: 'p8', net_cents: 999_999, carrier_cents: 99_999, agent_cents: 9_999, verification_status: 'void' }),
    rec({ id: 't5', policy_id: 'p7', net_cents: 777_777, carrier_cents: 77_777, agent_cents: 7_777, replaced_by: 't6', verification_status: 'void' }),
  ];
  const carrier = { rateOn: () => 0.15, isSet: () => true };
  const pl = profitAndLoss([], rows, { 'agent-a': 0.5 }, '2026-10-01', '2026-11-30', { carrier, ledger });
  it('uses the frozen amounts, corrections and cancellations included, in the month they are dated', () => {
    // records: 1,200 + 120 − 480 carrier; 250 + 25 − 100 agent. p9 has no record yet: estimated at today's 15% / 50%.
    expect(pl.fromRecords).toBe(true);
    expect(pl.carrierCents).toBe(120_000 + 12_000 - 48_000 + 30_000);
    expect(pl.commissionCents).toBe(25_000 + 2_500 - 10_000 + 10_000);
    expect(pl.adjustmentCount).toBe(2);
    expect(pl.estimatedCount).toBe(1);
    expect(pl.months.map((m) => [m.month, m.carrierCents, m.commissionCents])).toEqual([['2026-10', 162_000, 37_500], ['2026-11', -48_000, -10_000]]);
  });
  it('void and replaced records are left out', () => {
    expect(pl.premiumNetCents).toBe(1_000_000 + 100_000 - 400_000 + 200_000);
  });
});
