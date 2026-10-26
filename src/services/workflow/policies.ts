import type { Account, CoverageType, MarketQuote, PolicyBusinessType, PolicyEntryKind, PolicyRecord } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import { normalizeDateKey, parseDateKey, toLocalDateKey } from './dates';

/**
 * Policies written from bound markets, and endorsements recorded on endorsed ones. They live on the
 * market (MarketQuote.policies), so they sync, work offline and are visible exactly like the market
 * itself. No commission is stored here: it's worked out on display. What the carrier pays the agency is
 * the net × the carrier's commission % on the bound / endorsed date (0063, set by an admin per carrier),
 * the agency's income (carrierCommissionCents); the agent's commission is their split (0058) of that
 * (agentCommissionCents). Without a carrier % there's no commission yet (not set).
 */

export function entryKind(p: Pick<PolicyRecord, 'kind'>): PolicyEntryKind {
  return p.kind === 'endorsement' ? 'endorsement' : 'policy';
}

/** cents × rate, to the cent (half away from zero, so a return premium mirrors its charge). */
function applyRate(cents: number, rate: number): number {
  const micro = Math.round(rate * 1e6);
  const raw = Math.abs(cents) * micro;
  const out = Math.floor(raw / 1e6) + (raw % 1e6 >= 5e5 ? 1 : 0);
  return cents < 0 ? -out : out;
}

/** What the carrier pays the agency (its income): the net premium × that carrier's commission % (null: not set). */
export function carrierCommissionCents(netCents: number, carrierRate: number | null): number | null {
  return carrierRate === null ? null : applyRate(netCents, carrierRate);
}

/**
 * The agent's share: their split of the carrier commission, rounded at each step — the same as
 * finance_agent_cents() in 0067. $10,000 net at 12% → $1,200; an agent on 25% gets $300. Null while the
 * carrier has no % set.
 */
export function agentCommissionCents(netCents: number, carrierRate: number | null, agentRate: number): number | null {
  return carrierRate === null ? null : applyRate(applyRate(netCents, carrierRate), agentRate);
}

/**
 * The carrier commission % typed on a policy / endorsement ("12", "12.5", "12%") as a share (0.12), or null
 * when it's missing or out of range: more than 0% and at most 50%, up to two decimals (as 0073 accepts).
 */
export function parseCarrierPercent(raw: string): number | null {
  const t = raw.trim().replace(/%$/, '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const pct = Number(t);
  if (!(pct > 0 && pct <= 50)) return null;
  return Math.round(pct * 100) / 10000;
}

/** One carrier, however it's typed: "Granite  Mutual " and "granite mutual" share a commission %. Same as carrier_key() in 0063. */
export const carrierKey = (carrier: string) => carrier.trim().replace(/\s+/g, ' ').toLowerCase();

/** On, unless switched off with VITE_FEATURE_POLICIES=false (a kill switch: the data stays, only the screens hide). */
export function policiesFeatureEnabled(env: { DEV?: boolean; VITE_FEATURE_POLICIES?: string } = import.meta.env): boolean {
  return String(env.VITE_FEATURE_POLICIES ?? '').trim().toLowerCase() !== 'false';
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

/**
 * What a bound / endorsed market adds up to: the totals of its policies plus its endorsements'
 * premium changes (net + taxes + fees, removed ones left out). Null when nothing is recorded yet.
 */
export function marketTotalCents(quote: { policies?: PolicyRecord[] }): number | null {
  const entries = (quote.policies ?? []).filter((p) => !p.removedAt);
  return entries.length ? entries.reduce((sum, p) => sum + policyTotalCents(p), 0) : null;
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
  kind?: PolicyEntryKind;
  notes?: string;
  description?: string;
  /** An endorsement: the policy it changes. */
  forPolicyId?: string;
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
  /** An endorsement's possible policies (ids on the same account). A new endorsement must name one. */
  accountPolicyIds?: string[];
  /** True for a new endorsement (one recorded before links were required may be saved without one). */
  requirePolicyLink?: boolean;
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
  const kind: PolicyEntryKind = input.kind === 'endorsement' ? 'endorsement' : 'policy';
  // An endorsement can lower the premium (a vehicle removed): its amounts may be negative.
  const signedOk = kind === 'endorsement';
  const dateLabel = kind === 'endorsement' ? 'endorsed date' : 'bound date';
  const carrier = input.carrier.trim();
  if (!carrier) errors.push('Enter the carrier.');
  if (carrier.length > 200) errors.push('The carrier name is too long.');

  const boundDate = input.boundDate.trim() ? strictDate(input.boundDate) : null;
  if (!input.boundDate.trim()) errors.push(`Enter the ${dateLabel}.`);
  else if (!boundDate) errors.push(`The ${dateLabel} isn’t a valid date.`);
  const effectiveDate = input.effectiveDate.trim() ? strictDate(input.effectiveDate) : null;
  if (input.effectiveDate.trim() && !effectiveDate) errors.push('The effective date isn’t a valid date.');
  const expirationDate = input.expirationDate.trim() ? strictDate(input.expirationDate) : null;
  if (input.expirationDate.trim() && !expirationDate) errors.push('The expiration date isn’t a valid date.');
  if (effectiveDate && expirationDate && expirationDate <= effectiveDate) errors.push('The expiration date must be after the effective date.');

  const net = parseMoneyCents(input.netPremium);
  if (net === null) errors.push('Enter the net premium.');
  else if (Number.isNaN(net)) errors.push('Enter the net premium as an amount, e.g. 12,500.00.');
  else if (net < 0 && !signedOk) errors.push('The net premium can’t be negative.');
  const money = (label: string, v: string) => {
    const c = parseMoneyCents(v);
    if (c === null) return 0;
    if (Number.isNaN(c)) errors.push(`Enter ${label} as an amount, e.g. 250.00 (or leave it blank).`);
    else if (c < 0 && !signedOk) errors.push(`${label[0].toUpperCase()}${label.slice(1)} can’t be negative.`);
    return Number.isNaN(c) ? 0 : c;
  };
  const taxesCents = money('the taxes', input.taxes);
  const feesCents = money('the fees', input.fees);

  const policyNumber = input.policyNumber.trim();
  if (!policyNumber) errors.push('Enter the policy number.');
  else if (policyNumber.length > 100) errors.push('The policy number is too long.');
  const coverage = COVERAGES.includes(input.coverage as CoverageType) ? (input.coverage as CoverageType) : undefined;
  if (input.coverage && !coverage) errors.push('Choose a coverage from the list.');

  const notes = (input.notes ?? '').trim();
  if (notes.length > 2000) errors.push('The notes are too long.');
  const description = (input.description ?? '').trim();
  if (description.length > 300) errors.push('The description is too long (300 characters at most).');

  const forPolicyId = kind === 'endorsement' ? (input.forPolicyId ?? '').trim() : '';
  if (kind === 'endorsement') {
    if (forPolicyId && ctx.accountPolicyIds && !ctx.accountPolicyIds.includes(forPolicyId)) errors.push('Choose the policy this endorsement changes from this account.');
    else if (!forPolicyId && ctx.requirePolicyLink) errors.push('Choose the policy this endorsement changes.');
  }

  if (policyNumber && kind === 'policy') {
    // The same policy can't be recorded twice: same number and carrier on another client (or this one).
    const key = normalizePolicyNumber(policyNumber);
    const same = ctx.existing.find((r) => r.policy.id !== ctx.editingId && entryKind(r.policy) === 'policy' && normalizePolicyNumber(r.policy.policyNumber) === key && r.policy.carrier.trim().toLowerCase() === carrier.toLowerCase());
    if (same) errors.push(`Policy ${policyNumber} with ${carrier} is already recorded on ${same.insured}.`);
  }
  if (kind === 'policy' && boundDate && effectiveDate && effectiveDate < boundDate) warnings.push('The effective date is before the bound date.');

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    fields: {
      ...(kind === 'endorsement' ? { kind } : {}),
      ...(forPolicyId ? { forPolicyId } : {}),
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
      ...(description ? { description } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

/** The policies still in force on a market (removed ones stay in the data, hidden). Endorsements: see activeEndorsements. */
export function activePolicies(q: Pick<MarketQuote, 'policies'>): PolicyRecord[] {
  return (q.policies ?? []).filter((p) => !p.removedAt && entryKind(p) === 'policy');
}

export function activeEndorsements(q: Pick<MarketQuote, 'policies'>): PolicyRecord[] {
  return (q.policies ?? []).filter((p) => !p.removedAt && entryKind(p) === 'endorsement');
}

/** Keeps only well-formed policies when a market is read back (bad entries are skipped, never invented). */
export function normalizePolicies(value: unknown): PolicyRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
  return value
    .filter((p): p is Partial<PolicyRecord> & { id: string; carrier: string; boundDate: string } => !!p && typeof p === 'object' && typeof (p as PolicyRecord).id === 'string' && typeof (p as PolicyRecord).carrier === 'string' && typeof (p as PolicyRecord).boundDate === 'string')
    .map((p) => ({
      ...p,
      ...(p.kind === 'endorsement' ? { kind: 'endorsement' as const } : { kind: undefined }),
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
  /** The account's assigned agent (whose commission rate applies), if any. */
  assignedUserId: string | null;
}

export function policyRows(accounts: Pick<Account, 'id' | 'namedInsured' | 'archived' | 'assignedUserId'>[], quotes: Record<string, MarketQuote[] | undefined>, { includeArchived = false } = {}): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const a of accounts) {
    if (a.archived && !includeArchived) continue;
    for (const q of quotes[a.id] ?? []) {
      for (const policy of q.policies ?? []) if (!policy.removedAt) rows.push({ policy, accountId: a.id, insured: a.namedInsured, quoteId: q.id, marketName: q.marketName, marketBound: q.status === 'bound' && (entryKind(policy) === 'policy' || !!q.endorsed), assignedUserId: a.assignedUserId ?? null });
    }
  }
  return rows;
}

export type PolicyDateField = 'boundDate' | 'effectiveDate' | 'expirationDate';
export const POLICY_DATE_LABELS: Record<PolicyDateField, string> = { boundDate: 'Bound / endorsed', effectiveDate: 'Effective', expirationDate: 'Expires' };

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
      return [r.insured, r.policy.policyNumber, r.policy.carrier, r.marketName, r.policy.coverage ? COVERAGE_LABELS[r.policy.coverage] : '', r.policy.description, r.policy.notes].some((s) => (s ?? '').toLowerCase().includes(q));
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

export type DatePreset = 'all' | 'last_7_days' | 'this_month' | 'last_month';
/** The Period menu, in this order. */
export const DATE_PRESET_LABELS: Record<DatePreset, string> = { all: 'All dates', last_7_days: 'Last 7 days', this_month: 'This month', last_month: 'Last month' };

export function presetRange(preset: DatePreset, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const key = (d: Date) => toLocalDateKey(d);
  switch (preset) {
    case 'this_month':
      return { from: key(new Date(y, m, 1)), to: key(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) };
    case 'last_7_days':
      return { from: key(new Date(y, m, today.getDate() - 6)), to: key(today) };
    default:
      return { from: '', to: '' };
  }
}
