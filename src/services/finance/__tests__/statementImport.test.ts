import { describe, expect, it } from 'vitest';
import { alreadyAdded, parseStatement } from '../statementImport';

// A made-up weekly statement in the same shape as the agency's (each line's cells, left to right).
const statement = [
  ['SAMPLE AGENCY, INC.'],
  ['Weekly Income & Expense Statement | November 16–22, 2026 | Prepared November 23, 2026'],
  ['INCOME'],
  ['Description', 'Amount'],
  ['Carrier commissions earned', '$1,000.00'],
  ['Broker fees recorded', '$600.00'],
  ['TOTAL INCOME', '$1,600.00'],
  ['EXPENSES - SALES PRODUCERS'],
  ['Description', 'Amount'],
  ['Ben (2 sales)', '$300.00'],
  ['Ada (0 sales)', '$0.00'],
  ['TOTAL PRODUCER PAYOUTS', '$300.00'],
  ['EXPENSES - STAFF & REFERRALS'],
  ['Description', 'Amount'],
  ['Casey - weekly base', '$500.00'],
  ['Riley - 2 days', '$120.00'],
  ['Total staff payroll', '$620.00'],
  ['Referral partners - payouts', '$95.50'],
  ['TOTAL EXPENSES (ALL LISTED)', '$1,015.50'],
  ['RESULT'],
  ['Description', 'Amount'],
  ['TOTAL INCOME', '$1,600.00'],
  ['Less: total listed payouts', '($1,015.50)'],
  ['ESTIMATED AGENCY EARNINGS', '$584.50'],
  ['Production: 3 policies bound; $14,000.00 in written premium.'],
];

describe('reading an income & expense statement', () => {
  const s = parseStatement(statement)!;
  it('reads the week, every line (no totals, no result), with a category', () => {
    expect(s.date).toBe('2026-11-22');
    expect(s.period).toBe('November 16–22, 2026');
    expect(s.lines.map((l) => [l.kind, l.category, l.description, l.amountCents])).toEqual([
      ['income', 'Carrier commission', 'Carrier commissions earned', 100000],
      ['income', 'Broker fees', 'Broker fees recorded', 60000],
      ['expense', 'Agent commission', 'Ben (2 sales)', 30000],
      ['expense', 'Payroll', 'Casey - weekly base', 50000],
      ['expense', 'Payroll', 'Riley - 2 days', 12000],
      ['expense', 'Referral partners', 'Referral partners - payouts', 9550],
    ]);
    expect(s.skipped).toEqual(['Ada (0 sales) ($0.00)']);
  });
  it('carrier commission and agent payouts take the place of the automatic amounts for the week', () => {
    expect(s.from).toBe('2026-11-16');
    expect(s.lines.filter((l) => l.replaces).map((l) => l.description)).toEqual(['Carrier commissions earned', 'Ben (2 sales)']);
  });
  it('a line already in Income & expenses is recognised', () => {
    const line = s.lines[3];
    expect(alreadyAdded(line, '2026-11-22', [{ kind: 'expense', date: '2026-11-22', amountCents: 50000, description: 'Casey -  weekly base' }])).toBe(true);
    expect(alreadyAdded(line, '2026-11-22', [{ kind: 'expense', date: '2026-11-21', amountCents: 50000, description: 'Casey - weekly base' }])).toBe(false);
  });
  it('other dates: a range across months, or a plain date', () => {
    expect(parseStatement([['Statement Nov 30 – Dec 6, 2026'], ['EXPENSES'], ['Rent', '$2,500.00']])).toMatchObject({ from: '2026-11-30', date: '2026-12-06' });
    expect(parseStatement([['Statement Dec 28 – Jan 3, 2027'], ['EXPENSES'], ['Rent', '$2,500.00']])).toMatchObject({ from: '2026-12-28', date: '2027-01-03' });
    expect(parseStatement([['Prepared 11/23/2026'], ['INCOME'], ['Agency fees', '250']])!.date).toBe('2026-11-23');
    expect(parseStatement([['Driver schedule'], ['Name', 'DOB']])).toBeNull();
  });
});
