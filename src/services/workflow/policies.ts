import type { Account, CoverageType, MarketQuote, PolicyBusinessType, PolicyRecord } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import { normalizeDateKey, parseDateKey, toLocalDateKey } from './dates';

/**
 * Policies written from bound markets (Carrier 103, Phase 1). They live on the market they were
 * bound with (MarketQuote.policies), so they sync, work offline and are visible exactly like the
 * market itself. Operational details only — commission is a later phase and never stored here.
 */

/** Off in production builds unless VITE_FEATURE_POLICIES=true; on in local development unless false. */
export function policiesFeatureEnabled(env: { DEV?: boolean; VITE_FEATURE_POLICIES?: string } = import.meta.env): boolean {
  const flag = String(env.VITE_FEATURE_POLICIES ?? '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.DEV === true;
}

/** "$1,234.56", "1234.5", "(12.00)" → cents; blank → null; anything else → NaN. Never floating-point dollars. */
export function parseMoneyCents(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-') || raw.startsWith('−');
  const digits = raw.replace(/[()$,\s−-]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(digits);
  if (!m) return Number.NaN;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** For prefilling an input: 123456 → "1,234.56"; 0 / undefined → "". */
export function centsInput(cents: number | undefined): string {
  return cents ? (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

export function policyTotalCents(p: Pick<PolicyRecord, 'netPremiumCents' | 'taxesCents' | 'feesCents'>): number {
  return p.netPremiumCents + p.taxesCents + p.feesCents;
}

/** A one-year term: 2026-11-01 → 2027-11-01 (29 Feb → 28 Feb in a non-leap year). */
export function oneYearAfter(dateKey: string): string {
  const d = parseDateKey(dateKey);
  if (!d) return '';
  const next = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
  if (next.getMonth() !== d.getMonth()) next.setDate(0);
  return toLocalDateKey(next);
}

/** For matching only: "smp-al 1001" and "SMP AL-1001" are the same policy (letters and digits, upper-cased). */
export function normalizePolicyNumber(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** What the policy form holds — strings, exactly as typed. */
export interface PolicyInput {
  quoteOptionId: string;
  policyNumber: string;
  carrier: string;
  coverage: string;
  businessType: PolicyBusinessType;
  boundDate: string;
  effectiveDate: string;
  expirationDate: string;
  netPremium: string;
  taxes: string;
  fees: string;
}

export type PolicyFields = Omit<PolicyRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdByName'>;

export type PolicyCheck = { ok: true; fields: PolicyFields; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

export interface PolicyCheckContext {
  /** Every policy the user can see, with where it lives — for the duplicate policy-number check. */
  existing: PolicyRow[];
  /** The policy being edited (excluded from the duplicate check). */
  editingId?: string;
}

const COVERAGES = Object.keys(COVERAGE_LABELS) as CoverageType[];

/** A real calendar date: "2026-02-30" is refused rather than rolled over to March. */
function strictDate(value: string): string | null {
  const v = value.trim();
  const key = normalizeDateKey(v);
  if (!key) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && key !== v) return null;
  return key;
}

export function checkPolicy(input: PolicyInput, ctx: PolicyCheckContext = { existing: [] }): PolicyCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const carrier = input.carrier.trim();
  if (!carrier) errors.push('Enter the carrier.');
  if (carrier.length > 200) errors.push('The carrier name is too long.');

  const boundDate = input.boundDate.trim() ? strictDate(input.boundDate) : null;
  if (!input.boundDate.trim()) errors.push('Enter the bound date.');
  else if (!boundDate) errors.push('The bound date isn’t a valid date.');
  const effectiveDate = input.effectiveDate.trim() ? strictDate(input.effectiveDate) : null;
  if (input.effectiveDate.trim() && !effectiveDate) errors.push('The effective date isn’t a valid date.');
  const expirationDate = input.expirationDate.trim() ? strictDate(input.expirationDate) : null;
  if (input.expirationDate.trim() && !expirationDate) errors.push('The expiration date isn’t a valid date.');
  if (effectiveDate && expirationDate && expirationDate <= effectiveDate) errors.push('The expiration date must be after the effective date.');

  const net = parseMoneyCents(input.netPremium);
  if (net === null) errors.push('Enter the net premium.');
  else if (Number.isNaN(net)) errors.push('Enter the net premium as an amount, e.g. 12,500.00.');
  else if (net < 0) errors.push('The net premium can’t be negative.');
  const money = (label: string, v: string) => {
    const c = parseMoneyCents(v);
    if (c === null) return 0;
    if (Number.isNaN(c)) errors.push(`Enter ${label} as an amount, e.g. 250.00 (or leave it blank).`);
    else if (c < 0) errors.push(`${label[0].toUpperCase()}${label.slice(1)} can’t be negative.`);
    return Number.isNaN(c) ? 0 : c;
  };
  const taxesCents = money('the taxes', input.taxes);
  const feesCents = money('the fees', input.fees);

  const policyNumber = input.policyNumber.trim();
  if (policyNumber.length > 100) errors.push('The policy number is too long.');
  const coverage = COVERAGES.includes(input.coverage as CoverageType) ? (input.coverage as CoverageType) : undefined;
  if (input.coverage && !coverage) errors.push('Choose a coverage from the list.');

  if (policyNumber) {
    const key = normalizePolicyNumber(policyNumber);
    const same = ctx.existing.find((r) => r.policy.id !== ctx.editingId && normalizePolicyNumber(r.policy.policyNumber) === key && r.policy.carrier.trim().toLowerCase() === carrier.toLowerCase());
    if (same) errors.push(`Policy ${policyNumber} with ${carrier} is already recorded on ${same.insured}.`);
  } else {
    warnings.push('No policy number yet — add it once the carrier issues the policy.');
  }
  if (boundDate && effectiveDate && effectiveDate < boundDate) warnings.push('The effective date is before the bound date.');

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    fields: {
      ...(input.quoteOptionId ? { quoteOptionId: input.quoteOptionId } : {}),
      ...(policyNumber ? { policyNumber } : {}),
      carrier,
      ...(coverage ? { coverage } : {}),
      businessType: input.businessType === 'renewal' ? 'renewal' : 'new',
      boundDate: boundDate!,
      ...(effectiveDate ? { effectiveDate } : {}),
      ...(expirationDate ? { expirationDate } : {}),
      netPremiumCents: net as number,
      taxesCents,
      feesCents,
    },
  };
}

/** The policies still in force on a market (removed ones stay in the data, hidden). */
export function activePolicies(q: Pick<MarketQuote, 'policies'>): PolicyRecord[] {
  return (q.policies ?? []).filter((p) => !p.removedAt);
}

/** Keeps only well-formed policies when a market is read back (bad entries are skipped, never invented). */
export function normalizePolicies(value: unknown): PolicyRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
  return value
    .filter((p): p is Partial<PolicyRecord> & { id: string; carrier: string; boundDate: string } => !!p && typeof p === 'object' && typeof (p as PolicyRecord).id === 'string' && typeof (p as PolicyRecord).carrier === 'string' && typeof (p as PolicyRecord).boundDate === 'string')
    .map((p) => ({
      ...p,
      businessType: p.businessType === 'renewal' ? 'renewal' : 'new',
      netPremiumCents: int(p.netPremiumCents),
      taxesCents: int(p.taxesCents),
      feesCents: int(p.feesCents),
      createdAt: p.createdAt ?? new Date().toISOString(),
      updatedAt: p.updatedAt ?? p.createdAt ?? new Date().toISOString(),
    }));
}

/** One policy with the account and market it belongs to — a row of the Policies list. */
export interface PolicyRow {
  policy: PolicyRecord;
  accountId: string;
  insured: string;
  quoteId: string;
  marketName: string;
  /** False when the market was later moved off "Bound" — the policy is kept, and flagged. */
  marketBound: boolean;
}

export function policyRows(accounts: Pick<Account, 'id' | 'namedInsured' | 'archived'>[], quotes: Record<string, MarketQuote[] | undefined>, { includeArchived = false } = {}): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const a of accounts) {
    if (a.archived && !includeArchived) continue;
    for (const q of quotes[a.id] ?? []) {
      for (const policy of q.policies ?? []) if (!policy.removedAt) rows.push({ policy, accountId: a.id, insured: a.namedInsured, quoteId: q.id, marketName: q.marketName, marketBound: q.status === 'bound' });
    }
  }
  return rows;
}

export type PolicyDateField = 'boundDate' | 'effectiveDate' | 'expirationDate';
export const POLICY_DATE_LABELS: Record<PolicyDateField, string> = { boundDate: 'Bound', effectiveDate: 'Effective', expirationDate: 'Expires' };

export interface PolicyFilter {
  dateField: PolicyDateField;
  /** Inclusive, YYYY-MM-DD; blank = open-ended. */
  from: string;
  to: string;
  search: string;
}

/** Rows whose chosen date falls in [from, to]; a policy without that date is left out once a range is set. Sorted by that date, newest first. */
export function filterPolicies(rows: PolicyRow[], f: PolicyFilter): PolicyRow[] {
  const q = f.search.trim().toLowerCase();
  const ranged = !!(f.from || f.to);
  return rows
    .filter((r) => {
      const d = r.policy[f.dateField];
      if (ranged && !d) return false;
      if (f.from && d! < f.from) return false;
      if (f.to && d! > f.to) return false;
      if (!q) return true;
      return [r.insured, r.policy.policyNumber, r.policy.carrier, r.marketName, r.policy.coverage ? COVERAGE_LABELS[r.policy.coverage] : ''].some((s) => (s ?? '').toLowerCase().includes(q));
    })
    .sort((a, b) => (b.policy[f.dateField] ?? '').localeCompare(a.policy[f.dateField] ?? '') || a.insured.localeCompare(b.insured));
}

export function policyTotals(rows: PolicyRow[]): { count: number; netPremiumCents: number; taxesCents: number; feesCents: number; totalCents: number } {
  const t = { count: rows.length, netPremiumCents: 0, taxesCents: 0, feesCents: 0, totalCents: 0 };
  for (const { policy } of rows) {
    t.netPremiumCents += policy.netPremiumCents;
    t.taxesCents += policy.taxesCents;
    t.feesCents += policy.feesCents;
  }
  t.totalCents = t.netPremiumCents + t.taxesCents + t.feesCents;
  return t;
}

export type DatePreset = 'this_month' | 'last_month' | 'this_year' | 'next_60_days' | 'all';
export const DATE_PRESET_LABELS: Record<DatePreset, string> = { this_month: 'This month', last_month: 'Last month', this_year: 'This year', next_60_days: 'Next 60 days', all: 'All dates' };

export function presetRange(preset: DatePreset, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const key = (d: Date) => toLocalDateKey(d);
  switch (preset) {
    case 'this_month':
      return { from: key(new Date(y, m, 1)), to: key(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) };
    case 'this_year':
      return { from: key(new Date(y, 0, 1)), to: key(new Date(y, 11, 31)) };
    case 'next_60_days':
      return { from: key(today), to: key(new Date(y, m, today.getDate() + 60)) };
    default:
      return { from: '', to: '' };
  }
}
