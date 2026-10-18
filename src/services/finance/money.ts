import { normalizeDateKey } from '../workflow/dates';
import { agentCommissionCents, parseMoneyCents, type PolicyRow } from '../workflow/policies';

/**
 * The agency's income and expenses (0059) and its profit and loss. Admin-only records the owner keeps
 * so they can see whether the agency makes or loses money — records only, nothing here moves money.
 *
 * Profit = income recorded − expenses recorded − agent commission. Agent commission isn't recorded by
 * hand: it's worked out from the policies and endorsements bound / endorsed in the period (net × the
 * agent's %), so it must not also be entered as an expense.
 */

export type MoneyKind = 'income' | 'expense';

export interface MoneyEntry {
  id: string;
  kind: MoneyKind;
  /** YYYY-MM-DD */
  date: string;
  category: string;
  description: string;
  amountCents: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const INCOME_CATEGORIES = ['Carrier commission', 'Agency fees', 'Contingency / bonus', 'Other income'] as const;
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Payroll',
  'Marketing',
  'Software & subscriptions',
  'Office & utilities',
  'Licenses & insurance',
  'Professional services',
  'Travel',
  'Bank fees',
  'Other expense',
] as const;

export interface MoneyInput {
  kind: MoneyKind;
  date: string;
  category: string;
  description: string;
  amount: string;
  notes: string;
}

export type MoneyFields = Pick<MoneyEntry, 'kind' | 'date' | 'category' | 'description' | 'amountCents' | 'notes'>;

export function checkMoneyEntry(input: MoneyInput): { ok: true; fields: MoneyFields } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const date = normalizeDateKey(input.date.trim() || null);
  if (!input.date.trim()) errors.push('Choose the date.');
  else if (!date) errors.push('The date isn’t a valid date.');
  const category = input.category.trim();
  if (!category) errors.push('Choose or type a category.');
  else if (category.length > 80) errors.push('The category is too long.');
  const description = input.description.trim();
  if (description.length > 300) errors.push('The description is too long.');
  const notes = input.notes.trim();
  if (notes.length > 2000) errors.push('The notes are too long.');
  const amount = parseMoneyCents(input.amount);
  if (amount === null) errors.push('Enter the amount.');
  else if (Number.isNaN(amount)) errors.push('Enter the amount as a number, e.g. 2,500.00.');
  else if (amount <= 0) errors.push('The amount must be more than zero.');
  else if (amount >= 100_000_000_000) errors.push('The amount is too large.');
  if (errors.length || !date || amount === null || Number.isNaN(amount)) return { ok: false, errors };
  return { ok: true, fields: { kind: input.kind, date, category, description, amountCents: amount, notes } };
}

const inRange = (d: string, from: string, to: string) => (!from || d >= from) && (!to || d <= to);

export interface CategoryTotal {
  category: string;
  cents: number;
  count: number;
}

export interface MonthLine {
  /** YYYY-MM */
  month: string;
  incomeCents: number;
  expenseCents: number;
  commissionCents: number;
  profitCents: number;
}

export interface ProfitLoss {
  incomeCents: number;
  expenseCents: number;
  commissionCents: number;
  profitCents: number;
  /** Policies / endorsements in the period whose commission couldn't be worked out (no agent or no rate). */
  commissionMissing: number;
  /** Net premium bound / endorsed in the period — for context; it isn't the agency's income. */
  premiumNetCents: number;
  income: CategoryTotal[];
  expenses: CategoryTotal[];
  months: MonthLine[];
}

/** Commission on one policy / endorsement row, or null when it has no agent or the agent no rate. */
export function rowCommissionCents(row: Pick<PolicyRow, 'assignedUserId' | 'policy'>, rates: Record<string, number>): number | null {
  if (!row.assignedUserId) return null;
  const rate = rates[row.assignedUserId];
  return rate === undefined ? null : agentCommissionCents(row.policy.netPremiumCents, rate);
}

export function profitAndLoss(entries: MoneyEntry[], rows: PolicyRow[], rates: Record<string, number>, from: string, to: string): ProfitLoss {
  const months = new Map<string, MonthLine>();
  const month = (key: string) => {
    const m = key.slice(0, 7);
    let line = months.get(m);
    if (!line) months.set(m, (line = { month: m, incomeCents: 0, expenseCents: 0, commissionCents: 0, profitCents: 0 }));
    return line;
  };
  const byCat = { income: new Map<string, CategoryTotal>(), expense: new Map<string, CategoryTotal>() };
  let incomeCents = 0;
  let expenseCents = 0;
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    const t = byCat[e.kind].get(e.category) ?? { category: e.category, cents: 0, count: 0 };
    t.cents += e.amountCents;
    t.count++;
    byCat[e.kind].set(e.category, t);
    if (e.kind === 'income') {
      incomeCents += e.amountCents;
      month(e.date).incomeCents += e.amountCents;
    } else {
      expenseCents += e.amountCents;
      month(e.date).expenseCents += e.amountCents;
    }
  }
  let commissionCents = 0;
  let commissionMissing = 0;
  let premiumNetCents = 0;
  for (const r of rows) {
    const d = r.policy.boundDate;
    if (!d || !inRange(d, from, to)) continue;
    premiumNetCents += r.policy.netPremiumCents;
    const c = rowCommissionCents(r, rates);
    if (c === null) {
      commissionMissing++;
      continue;
    }
    commissionCents += c;
    month(d).commissionCents += c;
  }
  const list = (m: Map<string, CategoryTotal>) => [...m.values()].sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const monthLines = [...months.values()].map((l) => ({ ...l, profitCents: l.incomeCents - l.expenseCents - l.commissionCents })).sort((a, b) => a.month.localeCompare(b.month));
  return {
    incomeCents,
    expenseCents,
    commissionCents,
    profitCents: incomeCents - expenseCents - commissionCents,
    commissionMissing,
    premiumNetCents,
    income: list(byCat.income),
    expenses: list(byCat.expense),
    months: monthLines,
  };
}

/** "2026-10" → "Oct 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const plainCents = (c: number) => (c / 100).toFixed(2);

/** The entries as a CSV file (amounts as plain numbers; expenses negative so a spreadsheet can sum them). */
export function moneyEntriesCsv(entries: MoneyEntry[]): string {
  const lines = [['Date', 'Type', 'Category', 'Description', 'Amount', 'Notes']];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([e.date, e.kind === 'income' ? 'Income' : 'Expense', e.category, e.description, plainCents(e.kind === 'income' ? e.amountCents : -e.amountCents), e.notes]);
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

/** The profit-and-loss report (by month, then the totals) as a CSV file. */
export function profitLossCsv(pl: ProfitLoss): string {
  const lines = [['Month', 'Income', 'Expenses', 'Agent commission', 'Profit']];
  for (const m of pl.months) lines.push([monthLabel(m.month), plainCents(m.incomeCents), plainCents(m.expenseCents), plainCents(m.commissionCents), plainCents(m.profitCents)]);
  lines.push(['Total', plainCents(pl.incomeCents), plainCents(pl.expenseCents), plainCents(pl.commissionCents), plainCents(pl.profitCents)]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

