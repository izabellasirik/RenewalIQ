import { COVERAGE_LABELS } from '../../types';
import { entryKind, policyTotalCents, POLICY_DATE_LABELS, type PolicyDateField, type PolicyRow } from '../workflow/policies';
import { monthLabel, type MoneyEntry, type ProfitLoss } from '../finance/money';
import type { Cell, Report, ReportColumn } from './report';

/** The three Analytics reports, built from exactly what the screen shows (the filtered list). */

const stamp = () => new Date().toLocaleDateString('en-CA');
const periodText = (from: string, to: string) => (from || to ? `${from || 'the start'} to ${to || 'today and later'}` : 'All dates');
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export interface PoliciesReportOptions {
  /** Admins see the carrier commission (confidential carrier agreements). */
  isAdmin: boolean;
  /** In an agency: the agent commission column (an agent sees only their own). */
  withCommission: boolean;
  carrierRateOf: (row: PolicyRow) => number;
  carrierCentsOf: (row: PolicyRow) => number;
  commissionOf: (row: PolicyRow) => number | null;
  agentNameOf: (row: PolicyRow) => string;
  /** "Show: Policies", "Agent: …", "Search: …". */
  filters: string[];
  dateField: PolicyDateField;
  from: string;
  to: string;
}

export function policiesReport(rows: PolicyRow[], o: PoliciesReportOptions): Report {
  const columns: ReportColumn[] = [
    { header: 'Client' },
    { header: 'Policy number' },
    { header: 'Type' },
    { header: 'Description' },
    { header: 'Carrier' },
    { header: 'Market' },
    { header: 'Coverage' },
    { header: 'Bound / endorsed', kind: 'date' },
    { header: 'Effective', kind: 'date' },
    { header: 'Expires', kind: 'date' },
    { header: 'Net', kind: 'money' },
    { header: 'Taxes', kind: 'money' },
    { header: 'Fees', kind: 'money' },
    { header: 'Total', kind: 'money' },
    ...(o.isAdmin ? [{ header: 'Carrier %' }, { header: 'Carrier commission', kind: 'money' as const }] : []),
    ...(o.withCommission ? [{ header: 'Agent' }, { header: 'Agent commission', kind: 'money' as const }] : []),
    { header: 'Documents', kind: 'count' },
  ];
  const t = { net: 0, taxes: 0, fees: 0, carrier: 0, commission: 0, docs: 0 };
  const body: Cell[][] = rows.map((r) => {
    const p = r.policy;
    const endorsement = entryKind(p) === 'endorsement';
    const carrier = o.carrierCentsOf(r);
    const commission = o.commissionOf(r);
    t.net += p.netPremiumCents;
    t.taxes += p.taxesCents;
    t.fees += p.feesCents;
    t.carrier += carrier;
    t.commission += commission ?? 0;
    t.docs += (p.attachments ?? []).length;
    return [
      r.insured,
      p.policyNumber ?? '',
      endorsement ? 'Endorsement' : p.businessType === 'renewal' ? 'Renewal' : 'New business',
      p.description ?? '',
      p.carrier,
      r.marketName,
      p.coverage ? COVERAGE_LABELS[p.coverage] : '',
      p.boundDate,
      p.effectiveDate ?? null,
      p.expirationDate ?? null,
      p.netPremiumCents,
      p.taxesCents,
      p.feesCents,
      policyTotalCents(p),
      ...(o.isAdmin ? [`${Math.round(o.carrierRateOf(r) * 1e6) / 1e4}%`, carrier] : []),
      ...(o.withCommission ? [o.agentNameOf(r), commission] : []),
      (p.attachments ?? []).length,
    ];
  });
  const policies = rows.filter((r) => entryKind(r.policy) === 'policy').length;
  const totals: Cell[] = [
    `Total: ${policies} ${policies === 1 ? 'policy' : 'policies'}, ${rows.length - policies} ${rows.length - policies === 1 ? 'endorsement' : 'endorsements'}`,
    '', '', '', '', '', '', null, null, null,
    t.net, t.taxes, t.fees, t.net + t.taxes + t.fees,
    ...(o.isAdmin ? ['', t.carrier] : []),
    ...(o.withCommission ? ['', t.commission] : []),
    t.docs,
  ];
  return {
    title: 'Policies & endorsements',
    subtitle: [`${POLICY_DATE_LABELS[o.dateField]} date: ${periodText(o.from, o.to)}`, ...(o.filters.length ? [o.filters.join(' · ')] : []), `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`],
    columns,
    rows: body,
    totals,
    fileBase: `policies-and-endorsements-${slug(`${o.from || 'all'}-${o.to || 'all'}`)}-${stamp()}`,
  };
}

export function profitLossReport(pl: ProfitLoss, from: string, to: string): Report {
  return {
    title: 'Profit & loss',
    subtitle: [
      `Period: ${periodText(from, to)}`,
      'Income = carrier commission on the policies and endorsements bound in the period + income recorded. Profit = income - expenses - agent commission.',
    ],
    columns: [{ header: 'Month' }, { header: 'Carrier commission', kind: 'money' }, { header: 'Other income', kind: 'money' }, { header: 'Total income', kind: 'money' }, { header: 'Expenses', kind: 'money' }, { header: 'Agent commission', kind: 'money' }, { header: 'Profit / loss', kind: 'money' }],
    rows: pl.months.map((m) => [monthLabel(m.month), m.carrierCents, m.otherIncomeCents, m.incomeCents, m.expenseCents, m.commissionCents, m.profitCents]),
    totals: ['Total', pl.carrierCents, pl.otherIncomeCents, pl.incomeCents, pl.expenseCents, pl.commissionCents, pl.profitCents],
    fileBase: `profit-and-loss-${slug(`${from || 'all'}-${to || 'all'}`)}-${stamp()}`,
  };
}

export function moneyReport(entries: MoneyEntry[], from: string, to: string, filters: string[]): Report {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const income = sorted.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amountCents, 0);
  const expenses = sorted.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amountCents, 0);
  return {
    title: 'Income & expenses',
    subtitle: [`Period: ${periodText(from, to)}`, ...(filters.length ? [filters.join(' · ')] : []), `Income ${(income / 100).toFixed(2)} · Expenses ${(expenses / 100).toFixed(2)} (expenses are negative below)`],
    columns: [{ header: 'Date', kind: 'date' }, { header: 'Type' }, { header: 'Category' }, { header: 'Description' }, { header: 'Amount', kind: 'money' }, { header: 'Notes' }],
    rows: sorted.map((e) => [e.date, e.kind === 'income' ? 'Income' : 'Expense', e.category, e.description, e.kind === 'income' ? e.amountCents : -e.amountCents, e.notes]),
    totals: ['Net', '', '', '', income - expenses, ''],
    fileBase: `income-and-expenses-${slug(`${from || 'all'}-${to || 'all'}`)}-${stamp()}`,
  };
}
