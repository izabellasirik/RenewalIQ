import type { Account, AccountRenewal, MarketQuote, RenewalStatus } from '../../types';
import { addDays, daysBetween, formatShortDate, normalizeDateKey, parseDateKey, toLocalDateKey } from './dates';

/**
 * Renewal tracking — the one place that decides which renewals an account has, when work on each
 * starts, and when it's done.
 *
 * - The account's main renewal follows the account's Renewal / effective date (no second copy).
 * - Another policy renewing on another date is its own renewal with its own date.
 * - A renewal is closed only by a market bound *for it* (MarketQuote.renewalId) or by "Not renewing",
 *   so binding one policy never dismisses another renewal.
 * - Accounts from before renewal tracking (no renewals saved) keep the original reminder exactly:
 *   45 days before the effective date, until any market is bound.
 */

export const DEFAULT_LEAD_DAYS = 45;
export const MAX_LEAD_DAYS = 365;

export interface ResolvedRenewal {
  /** The saved renewal (absent for an account from before renewal tracking). */
  record?: AccountRenewal;
  id: string;
  main: boolean;
  /** An account from before renewal tracking: the original reminder rules apply. */
  legacy: boolean;
  /** YYYY-MM-DD, or null when it follows the account's date and none is set yet. */
  renewalDate: string | null;
  leadDays: number;
  /** When to start working on it (renewal date − lead days). */
  workStart: string | null;
  status: RenewalStatus;
  label?: string;
  boundQuoteId?: string;
}

export type RenewalPhase = 'no_date' | 'not_started' | 'working' | 'overdue' | 'closed';

export function resolveRenewals(account: Pick<Account, 'renewals' | 'businessType'>, effectiveDate: string | null | undefined, quotes: Pick<MarketQuote, 'status'>[]): ResolvedRenewal[] {
  const records = account.renewals ?? [];
  const eff = normalizeDateKey(effectiveDate ?? null);
  if (records.length === 0) {
    // Before renewal tracking: the effective date is the renewal, cleared by any bound market. A new
    // venture's effective date is when its first policy starts, not a renewal.
    if (!eff || account.businessType === 'new_venture') return [];
    return [withDates({ id: 'legacy', main: true, legacy: true, renewalDate: eff, leadDays: DEFAULT_LEAD_DAYS, status: quotes.some((q) => q.status === 'bound') ? 'bound' : 'open' })];
  }
  return records
    .map((r) =>
      withDates({
        record: r,
        id: r.id,
        main: !!r.main,
        legacy: false,
        renewalDate: r.main && r.status === 'open' ? eff : (normalizeDateKey(r.renewalDate ?? null) ?? (r.main ? eff : null)),
        leadDays: clampLead(r.leadDays),
        status: r.status,
        label: r.label?.trim() || undefined,
        boundQuoteId: r.boundQuoteId,
      })
    )
    .sort(byDate);
}

function withDates(r: Omit<ResolvedRenewal, 'workStart'>): ResolvedRenewal {
  return { ...r, workStart: r.renewalDate ? addDays(r.renewalDate, -r.leadDays) : null };
}

const byDate = (a: ResolvedRenewal, b: ResolvedRenewal) => (a.renewalDate ?? '9999').localeCompare(b.renewalDate ?? '9999') || a.id.localeCompare(b.id);

function clampLead(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_LEAD_DAYS, Math.max(0, Math.round(n))) : DEFAULT_LEAD_DAYS;
}

export function renewalPhase(r: ResolvedRenewal, today: string): RenewalPhase {
  if (r.status !== 'open') return 'closed';
  if (!r.renewalDate || !r.workStart) return 'no_date';
  if (today > r.renewalDate) return 'overdue';
  return today >= r.workStart ? 'working' : 'not_started';
}

/** Shown under "Upcoming renewals" and on Today's Plate: work has started and it isn't bound yet. */
export function isRenewalDue(r: ResolvedRenewal, today: string): boolean {
  const phase = renewalPhase(r, today);
  // The original reminder stopped on the effective date; tracked renewals stay until handled.
  if (r.legacy) return phase === 'working';
  return phase === 'working' || phase === 'overdue';
}

/**
 * The "Renewal" label beside the account's status. Automatic: on for a client that came in as a
 * renewal while its renewal is being worked — from the start-working date until a market is bound for
 * it (an overdue one stays on) — and off once bound: the renewal marked bound, or a market (for that
 * renewal, or not tied to one) bound on or after its start-working date, even if the broker hasn't
 * yet said which renewal it was. Last term's bound markets don't count. A broker's on / off choice wins.
 */
export function renewalLabelOn(
  account: Pick<Account, 'renewals' | 'businessType' | 'renewalLabel'>,
  effectiveDate: string | null | undefined,
  quotes: Pick<MarketQuote, 'status' | 'boundDate' | 'renewalId'>[],
  today: string
): { on: boolean; manual: boolean } {
  if (account.renewalLabel !== undefined) return { on: account.renewalLabel, manual: true };
  const boundSinceStart = (r: ResolvedRenewal) =>
    quotes.some((q) => q.status === 'bound' && (!q.renewalId || q.renewalId === r.id) && !!q.boundDate && !!r.workStart && q.boundDate >= r.workStart);
  const on = account.businessType === 'renewal' && resolveRenewals(account, effectiveDate, quotes).some((r) => isRenewalDue(r, today) && !boundSinceStart(r));
  return { on, manual: false };
}

/** The task id on Today's Plate. The main renewal keeps the original id, so a reminder marked done before tracking stays done. */
export function renewalTaskId(accountId: string, r: Pick<ResolvedRenewal, 'id' | 'main'>): string {
  return r.main ? `renewal-${accountId}` : `renewal-${accountId}-${r.id}`;
}

/** "Renewal effective Nov 16" — the original wording for the main renewal; another policy's says which. */
export function renewalTitle(r: Pick<ResolvedRenewal, 'renewalDate' | 'label'>): string {
  const date = formatShortDate(r.renewalDate);
  return r.label ? `${r.label} renewal effective ${date}` : `Renewal effective ${date}`;
}

/** The open renewal soonest to come up (for "Renewal:" on account cards and lists). */
export function nextOpenRenewal(resolved: ResolvedRenewal[]): ResolvedRenewal | undefined {
  return resolved.find((r) => r.status === 'open' && r.renewalDate);
}

/** Same day next year; Feb 29 becomes Feb 28. */
export function addYears(dateKey: string, years: number): string {
  const d = parseDateKey(dateKey);
  if (!d) return dateKey;
  const next = new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  if (next.getMonth() !== d.getMonth()) next.setDate(0);
  return toLocalDateKey(next);
}

/** Lead days for a chosen start date (null if the start is after the renewal date or more than a year before). */
export function leadDaysFor(renewalDate: string, startDate: string): number | null {
  const n = daysBetween(startDate, renewalDate);
  return n >= 0 && n <= MAX_LEAD_DAYS ? n : null;
}

export interface RenewalInput {
  renewalDate: string;
  startDate: string;
}

/** Problems with a renewal date and start date as typed (empty when fine). */
export function checkRenewalInput(input: RenewalInput): string[] {
  const errors: string[] = [];
  const date = strictDate(input.renewalDate);
  if (!input.renewalDate.trim()) errors.push('Enter the renewal date.');
  else if (!date) errors.push('The renewal date isn’t a valid date.');
  if (input.startDate.trim()) {
    const start = strictDate(input.startDate);
    if (!start) errors.push('The start date isn’t a valid date.');
    else if (date && start > date) errors.push('Start working on or before the renewal date.');
    else if (date && daysBetween(start, date) > MAX_LEAD_DAYS) errors.push('Start no more than a year before the renewal date.');
  }
  return errors;
}

function strictDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? value.trim() : null;
}

/** A saved renewal that's well-formed enough to use (anything else is left out when loading). */
export function isRenewalRecord(r: unknown): r is AccountRenewal {
  if (!r || typeof r !== 'object') return false;
  const x = r as Partial<AccountRenewal>;
  return typeof x.id === 'string' && (x.status === 'open' || x.status === 'bound' || x.status === 'not_renewing') && (!!x.main || typeof x.renewalDate === 'string');
}

// ─── Changes to an account's renewals (pure; the store saves and logs them) ───

type Now = { now: string; newId: () => string };

/** Starts tracking a renewal. The main one is never added twice: an open main renewal is updated instead. */
export function addRenewal(list: AccountRenewal[], input: { main?: boolean; renewalDate?: string; leadDays?: number; label?: string; policyId?: string; previousRenewalId?: string }, { now, newId }: Now): AccountRenewal[] {
  if (input.main) {
    const open = list.find((r) => r.main && r.status === 'open');
    if (open) return updateRenewal(list, open.id, { leadDays: input.leadDays, label: input.label }, now);
  }
  const record: AccountRenewal = {
    id: newId(),
    ...(input.main ? { main: true } : { renewalDate: input.renewalDate }),
    ...(input.leadDays !== undefined && input.leadDays !== DEFAULT_LEAD_DAYS ? { leadDays: input.leadDays } : {}),
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    ...(input.policyId ? { policyId: input.policyId } : {}),
    ...(input.previousRenewalId ? { previousRenewalId: input.previousRenewalId } : {}),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  return [...list, record];
}

export function updateRenewal(list: AccountRenewal[], id: string, patch: { renewalDate?: string; leadDays?: number; label?: string }, now: string): AccountRenewal[] {
  return list.map((r) => {
    if (r.id !== id) return r;
    const next: AccountRenewal = { ...r, updatedAt: now };
    if (patch.renewalDate !== undefined && !r.main) next.renewalDate = patch.renewalDate;
    if (patch.leadDays !== undefined) {
      if (patch.leadDays === DEFAULT_LEAD_DAYS) delete next.leadDays;
      else next.leadDays = patch.leadDays;
    }
    if (patch.label !== undefined) {
      if (patch.label.trim()) next.label = patch.label.trim();
      else delete next.label;
    }
    return next;
  });
}

/** Bound for this renewal, or not renewing. The main renewal keeps the date it was for. */
export function closeRenewal(list: AccountRenewal[], id: string, close: { status: 'bound' | 'not_renewing'; boundQuoteId?: string; date: string | null }, now: string): AccountRenewal[] {
  return list.map((r) =>
    r.id === id && r.status === 'open'
      ? { ...r, status: close.status, ...(close.boundQuoteId ? { boundQuoteId: close.boundQuoteId } : {}), ...(r.main && close.date ? { renewalDate: close.date } : {}), closedAt: now, updatedAt: now }
      : r
  );
}

/** Back to open (the bound market was un-bound or removed, or "not renewing" was undone). A main renewal follows the account's date again. */
export function reopenRenewal(list: AccountRenewal[], id: string, now: string): AccountRenewal[] {
  // Only one main renewal can be open; one that's been followed by next year's stays closed.
  const target = list.find((r) => r.id === id);
  if (!target || list.some((r) => r.previousRenewalId === id)) return list;
  if (target.main && list.some((r) => r.main && r.status === 'open' && r.id !== id)) return list;
  return list.map((r) => {
    if (r.id !== id || r.status === 'open') return r;
    const { boundQuoteId: _q, closedAt: _c, ...rest } = r;
    const next: AccountRenewal = { ...rest, status: 'open', updatedAt: now };
    if (next.main) delete next.renewalDate;
    return next;
  });
}

/** The renewals a market's binding closed — reopened if that market stops being bound. */
export function renewalsBoundBy(list: AccountRenewal[], quoteId: string): AccountRenewal[] {
  return list.filter((r) => r.status === 'bound' && r.boundQuoteId === quoteId);
}

/** Next year's renewal for a closed one — never twice for the same renewal. */
export function prepareNextRenewal(list: AccountRenewal[], fromId: string, input: { renewalDate: string; leadDays?: number }, clock: Now): { list: AccountRenewal[]; created?: AccountRenewal } {
  const from = list.find((r) => r.id === fromId);
  if (!from || list.some((r) => r.previousRenewalId === fromId)) return { list };
  // The main renewal's next one is the main renewal again (the account's date moves to it).
  if (from.main && list.some((r) => r.main && r.status === 'open')) return { list };
  const next = addRenewal(list, { main: from.main, renewalDate: from.main ? undefined : input.renewalDate, leadDays: input.leadDays ?? from.leadDays, label: from.label, previousRenewalId: from.id }, clock);
  return { list: next, created: next[next.length - 1] };
}

/** The date next year's renewal would be: the same day a year later (or the bound policy's expiration, when known). */
export function proposedNextDate(r: Pick<ResolvedRenewal, 'renewalDate'>, fallback: string): string {
  return addYears(r.renewalDate ?? fallback, 1);
}

// ─── Who works on it ───

export interface RenewalViewer {
  /** null outside an agency. */
  role: 'admin' | 'agent' | null;
  userId: string | null;
  /** Who created the account (personal accounts / unassigned agency accounts). */
  ownerId?: string | null;
}

/**
 * The assigned broker sets up and schedules the renewal; an admin can too. Outside an agency the
 * account is the broker's own. Someone only helping on the account sees it but doesn't change it.
 */
export function canManageRenewals(account: Pick<Account, 'assignedUserId'>, v: RenewalViewer): boolean {
  if (v.role === null || v.role === 'admin') return true;
  if (!v.userId) return false;
  return account.assignedUserId ? account.assignedUserId === v.userId : v.ownerId === v.userId;
}

/** Renewal reminders go to the assigned broker; admins see every broker's (and can filter by broker). */
export function receivesRenewalReminders(account: Pick<Account, 'assignedUserId'>, v: RenewalViewer): boolean {
  return canManageRenewals(account, v);
}

export function describeRenewalTiming(r: ResolvedRenewal, today: string): string {
  if (!r.renewalDate) return 'Set the renewal date';
  const days = daysBetween(today, r.renewalDate);
  if (r.status === 'bound') return 'Renewed';
  if (r.status === 'not_renewing') return 'Not renewing';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} past the renewal date · not bound yet`;
  if (days === 0) return 'Effective today — not bound yet';
  return `${days} day${days === 1 ? '' : 's'} out · not bound yet`;
}
