import { normalizeDateKey } from '../workflow/dates';
import { DEFAULT_CARRIER_RATE, agentCommissionCents, carrierCommissionCents, parseMoneyCents, type PolicyRow } from '../workflow/policies';
import type { LedgerTransaction } from './ledger';

/**
 * The agency's income and expenses (0059) and its profit and loss. Admin-only records the owner keeps
 * so they can see whether the agency makes or loses money — records only, nothing here moves money.
 *
 * Profit = income − expenses − agent commission. Two amounts aren't recorded by hand — they come from
 * the policies and endorsements of the period, so they must not also be entered here: the carrier
 * commission (net × that carrier's % on the bound date, 10% where none is set) is income, and the agent
 * commission (net × 10% × the agent's split) is a cost. With commission records (0064) both are the
 * amounts frozen in the records — corrections and cancellations included, in the period they're dated —
 * so later rate changes never move a past month; anything not recorded yet is estimated (and counted).
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

/** Recorded income. Carrier commission on policies isn't one: it's added from the policies themselves. */
export const INCOME_CATEGORIES = ['Agency fees', 'Contingency / bonus', 'Other income'] as const;
/** The income line worked out from the policies and endorsements (never recorded by hand). */
export const CARRIER_COMMISSION_CATEGORY = 'Carrier commission (policies & endorsements)';
/** Income recorded by hand as carrier commission (the category the form offered before it was added automatically). */
export const isRecordedCarrierCommission = (e: Pick<MoneyEntry, 'kind' | 'category'>) => e.kind === 'income' && /^\s*carrier\s+commission/i.test(e.category);
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
  /** From the policies and endorsements (net × the carrier's %). */
  carrierCents: number;
  /** Recorded income. */
  otherIncomeCents: number;
  /** carrierCents + otherIncomeCents */
  incomeCents: number;
  expenseCents: number;
  commissionCents: number;
  profitCents: number;
}

export interface ProfitLoss {
  /** Carrier commission + recorded income. */
  incomeCents: number;
  carrierCents: number;
  otherIncomeCents: number;
  /** Policies / endorsements in the period whose carrier has no % set yet (10% used). */
  carrierDefaultCount: number;
  /** From commission records (true), or worked out from the policies (false: no 0064). */
  fromRecords: boolean;
  /** Policies / endorsements of the period without a record yet (historical ones before the backfill), estimated. */
  estimatedCount: number;
  /** Cancellations and corrections in the period (records only). */
  adjustmentCount: number;
  /** Income entries in the period recorded by hand as carrier commission — possibly counted twice now. */
  recordedCarrierEntries: number;
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

/** The agent's commission on one policy / endorsement row — their % of 10% of net — or null when it has no agent or the agent no rate. */
export function rowCommissionCents(row: Pick<PolicyRow, 'assignedUserId' | 'policy'>, rates: Record<string, number>): number | null {
  if (!row.assignedUserId) return null;
  const rate = rates[row.assignedUserId];
  return rate === undefined ? null : agentCommissionCents(row.policy.netPremiumCents, rate);
}

export interface CarrierRateLookup {
  /** The carrier's % on a date (10% where none is set). */
  rateOn: (carrier: string, dateKey: string) => number;
  isSet: (carrier: string, dateKey: string) => boolean;
}
const DEFAULT_LOOKUP: CarrierRateLookup = { rateOn: () => DEFAULT_CARRIER_RATE, isSet: () => false };

/** What the carrier pays the agency on one row: net × the carrier's % on its bound / endorsed date (10% until set). */
export function rowCarrierCents(row: Pick<PolicyRow, 'policy'>, carrier: CarrierRateLookup = DEFAULT_LOOKUP): number {
  return carrierCommissionCents(row.policy.netPremiumCents, carrier.rateOn(row.policy.carrier, row.policy.boundDate));
}

export interface ProfitLossOptions {
  carrier?: CarrierRateLookup;
  /** The agency's commission records (0064): used instead of working the amounts out. */
  ledger?: LedgerTransaction[];
}

export function profitAndLoss(entries: MoneyEntry[], rows: PolicyRow[], rates: Record<string, number>, from: string, to: string, opts: ProfitLossOptions = {}): ProfitLoss {
  const carrierLookup = opts.carrier ?? DEFAULT_LOOKUP;
  const months = new Map<string, MonthLine>();
  const month = (key: string) => {
    const m = key.slice(0, 7);
    let line = months.get(m);
    if (!line) months.set(m, (line = { month: m, carrierCents: 0, otherIncomeCents: 0, incomeCents: 0, expenseCents: 0, commissionCents: 0, profitCents: 0 }));
    return line;
  };
  const byCat = { income: new Map<string, CategoryTotal>(), expense: new Map<string, CategoryTotal>() };
  let otherIncomeCents = 0;
  let expenseCents = 0;
  let recordedCarrierEntries = 0;
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    const t = byCat[e.kind].get(e.category) ?? { category: e.category, cents: 0, count: 0 };
    t.cents += e.amountCents;
    t.count++;
    byCat[e.kind].set(e.category, t);
    if (e.kind === 'income') {
      if (isRecordedCarrierCommission(e)) recordedCarrierEntries++;
      otherIncomeCents += e.amountCents;
      month(e.date).otherIncomeCents += e.amountCents;
    } else {
      expenseCents += e.amountCents;
      month(e.date).expenseCents += e.amountCents;
    }
  }
  let carrierCents = 0;
  let carrierCount = 0;
  let carrierDefaultCount = 0;
  let commissionCents = 0;
  let commissionMissing = 0;
  let premiumNetCents = 0;
  let estimatedCount = 0;
  let adjustmentCount = 0;
  const add = (date: string, net: number, carrier: number, commission: number | null, isDefault: boolean) => {
    premiumNetCents += net;
    carrierCents += carrier;
    carrierCount++;
    if (isDefault) carrierDefaultCount++;
    month(date).carrierCents += carrier;
    if (commission === null) {
      commissionMissing++;
      return;
    }
    commissionCents += commission;
    month(date).commissionCents += commission;
  };
  const ledger = opts.ledger;
  const recorded = new Set<string>();
  if (ledger) {
    for (const t of ledger) {
      if (t.policyId) recorded.add(`${t.submissionId}|${t.policyId}`);
      if (t.verificationStatus === 'void' || t.replacedBy || !inRange(t.eventDate, from, to)) continue;
      if (t.kind === 'cancellation' || t.kind === 'correction') adjustmentCount++;
      add(t.eventDate, t.netCents, t.carrierCents, t.agentCents, t.carrierRateSource === 'default' || t.carrierRateSource === 'historical');
    }
  }
  for (const r of rows) {
    const d = r.policy.boundDate;
    if (!d || !inRange(d, from, to)) continue;
    if (ledger && recorded.has(`${r.accountId}|${r.policy.id}`)) continue;
    if (ledger) estimatedCount++;
    add(d, r.policy.netPremiumCents, rowCarrierCents(r, carrierLookup), rowCommissionCents(r, rates), !carrierLookup.isSet(r.policy.carrier, d));
  }
  if (carrierCount) byCat.income.set(CARRIER_COMMISSION_CATEGORY, { category: CARRIER_COMMISSION_CATEGORY, cents: carrierCents, count: carrierCount });
  const list = (m: Map<string, CategoryTotal>) => [...m.values()].sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const monthLines = [...months.values()]
    .map((l) => {
      const incomeCents = l.carrierCents + l.otherIncomeCents;
      return { ...l, incomeCents, profitCents: incomeCents - l.expenseCents - l.commissionCents };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
  const incomeCents = carrierCents + otherIncomeCents;
  return {
    incomeCents,
    carrierCents,
    otherIncomeCents,
    carrierDefaultCount,
    fromRecords: !!ledger,
    estimatedCount,
    adjustmentCount,
    recordedCarrierEntries,
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
