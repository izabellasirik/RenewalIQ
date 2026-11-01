import { entryKind, POLICY_DATE_LABELS, type PolicyDateField, type PolicyRow } from '../workflow/policies';
import { monthLabel, type MoneyEntry, type ProfitLoss } from '../finance/money';
import type { Cell, Report, ReportColumn } from './report';

/** The three Analytics reports, built from exactly what the screen shows (the filtered list). */

const stamp = () => new Date().toLocaleDateString('en-CA');
const periodText = (from: string, to: string) => (from || to ? `${from || 'the start'} to ${to || 'today and later'}` : 'All dates');
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export interface PoliciesReportOptions {
  /** Admins see the carrier commission (confidential carrier agreements). */
  isAdmin: boolean;
  /** In an agency: the agent columns (an agent sees only their own). */
  withCommission: boolean;
  carrierCentsOf: (row: PolicyRow) => number | null;
  /** The agent commission as on screen: commission + broker fee share − referral partner shortfall = total. */
  payOf: (row: PolicyRow) => { commission: number; share: number; shortfall: number; total: number } | null;
  agentNameOf: (row: PolicyRow) => string;
  /** "Show: Policies", "Agent: …", "Search: …". */
  filters: string[];
  dateField: PolicyDateField;
  from: string;
  to: string;
}

/** Policy, Endorsement or Cancellation — as the Client / policy column says. */
export function policyRowType(r: PolicyRow): string {
  return r.cancellation ? 'Cancellation' : entryKind(r.policy) === 'endorsement' ? 'Endorsement' : 'Policy';
}

/**
 * The Policies & endorsements report: client with its policy number and type under it (as on screen), carrier / MGA,
 * date, net premium, carrier commission (admins), agent, agent commission, broker fee share and the total.
 */
export function policiesReport(rows: PolicyRow[], o: PoliciesReportOptions): Report {
  const columns: ReportColumn[] = [
    { header: 'Client / policy' },
    { header: 'Carrier / MGA' },
    { header: 'Bound / endorsed', kind: 'date' },
    { header: 'Net premium', kind: 'money' },
    ...(o.isAdmin ? [{ header: 'Carrier commission', kind: 'money' as const }] : []),
    ...(o.withCommission ? [{ header: 'Agent' }, { header: 'Agent commission', kind: 'money' as const }, { header: 'Broker fee share', kind: 'money' as const }, { header: 'Agent commission total', kind: 'money' as const }] : []),
  ];
  const t = { net: 0, carrier: 0, commission: 0, share: 0, total: 0 };
  const body: Cell[][] = rows.map((r) => {
    const p = r.policy;
    const carrier = o.carrierCentsOf(r);
    const pay = o.payOf(r);
    t.net += p.netPremiumCents;
    t.carrier += carrier ?? 0;
    t.commission += pay?.commission ?? 0;
    t.share += pay?.share ?? 0;
    t.total += pay?.total ?? 0;
    return [
      `${r.insured}\n${p.policyNumber ?? 'Number to come'} · ${policyRowType(r)}`,
      !r.cancellation && p.carrier !== r.marketName ? `${p.carrier} via ${r.marketName}` : p.carrier,
      p.boundDate || null,
      p.netPremiumCents,
      ...(o.isAdmin ? [carrier] : []),
      ...(o.withCommission ? [o.agentNameOf(r), pay?.commission ?? null, pay ? pay.share : null, pay?.total ?? null] : []),
    ];
  });
  const policies = rows.filter((r) => !r.cancellation && entryKind(r.policy) === 'policy').length;
  const endorsements = rows.filter((r) => !r.cancellation && entryKind(r.policy) === 'endorsement').length;
  const totals: Cell[] = [
    `Total: ${policies} ${policies === 1 ? 'policy' : 'policies'}, ${endorsements} ${endorsements === 1 ? 'endorsement' : 'endorsements'}`,
    '',
    null,
    t.net,
    ...(o.isAdmin ? [t.carrier] : []),
    ...(o.withCommission ? ['', t.commission, t.share, t.total] : []),
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

export interface BrokerFeeReportRow {
  boundDate: string;
  clientName: string;
  policyNumber: string | null;
  brokerFeeCents: number;
  partnerName: string | null;
  partnerCents: number | null;
  agentName: string | null;
  agentCents: number | null;
  agencyCents: number | null;
  partnerShortfallCents: number;
}

/** Analytics → Broker fees as shown (admins: partner, agent, agency; an agent: their share). */
export function brokerFeesReport(rows: BrokerFeeReportRow[], admin: boolean, from: string, to: string, filters: string[]): Report {
  const columns: ReportColumn[] = [
    { header: 'Bound', kind: 'date' },
    { header: 'Client' },
    { header: 'Policy' },
    { header: 'Broker fee', kind: 'money' },
    ...(admin
      ? [{ header: 'Partner' }, { header: 'To partner', kind: 'money' as const }, { header: 'Agent' }, { header: 'To agent', kind: 'money' as const }, { header: 'From agent commission to partner', kind: 'money' as const }, { header: 'Agency keeps', kind: 'money' as const }]
      : [{ header: 'Your share', kind: 'money' as const }, { header: 'From your commission to partner', kind: 'money' as const }]),
  ];
  const sum = (f: (r: BrokerFeeReportRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    title: 'Broker fees',
    subtitle: [`Bound date: ${periodText(from, to)}`, ...(filters.length ? [filters.join(' · ')] : []), `${rows.length} ${rows.length === 1 ? 'policy' : 'policies'}`],
    columns,
    rows: rows.map((r) => [
      r.boundDate,
      r.clientName,
      r.policyNumber ?? '',
      r.brokerFeeCents,
      ...(admin
        ? [r.partnerName ?? '', r.partnerCents ? r.partnerCents - r.partnerShortfallCents : null, r.agentName ?? '', r.agentCents ?? 0, r.partnerShortfallCents ? -r.partnerShortfallCents : null, r.agencyCents ?? 0]
        : [r.agentCents ?? 0, r.partnerShortfallCents ? -r.partnerShortfallCents : null]),
    ]),
    totals: [
      'Total', '', '', sum((r) => r.brokerFeeCents),
      ...(admin
        ? ['', sum((r) => (r.partnerCents ?? 0) - r.partnerShortfallCents), '', sum((r) => r.agentCents ?? 0), -sum((r) => r.partnerShortfallCents) || null, sum((r) => r.agencyCents ?? 0)]
        : [sum((r) => r.agentCents ?? 0), -sum((r) => r.partnerShortfallCents) || null]),
    ],
    fileBase: `broker-fees-${slug(`${from || 'all'}-${to || 'all'}`)}-${stamp()}`,
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
