import { addDays, parseDateKey, toLocalDateKey } from '../workflow/dates';
import type { AgentPayment } from '../supabase/agentPaymentsRepo';

/**
 * Paying agents from Analytics → Policies & endorsements (0084): which rows are paid, partly paid (the amount
 * changed after it was paid) or not paid, and which were entered after the week (policies, Monday–Sunday) or the
 * month (endorsements) they were bound in — so a late one is easy to spot when an agent asks about it.
 */
export type PayState = 'paid' | 'partly' | 'not_paid' | 'no_amount';

export interface PayStatus {
  state: PayState;
  /** Paid so far (payments not undone). */
  paidCents: number;
  /** Still to pay: the current amount less what was paid (0 when paid; may be negative after a cancellation). */
  dueCents: number;
  /** The latest payment's date, and that payment (to undo it). */
  lastPaidOn: string | null;
  last: AgentPayment | null;
}

export function payStatus(amountCents: number | null, payments: AgentPayment[]): PayStatus {
  const live = payments.filter((p) => !p.undoneAt).sort((a, b) => (a.paidOn === b.paidOn ? a.createdAt.localeCompare(b.createdAt) : a.paidOn.localeCompare(b.paidOn)));
  const paidCents = live.reduce((n, p) => n + p.totalCents, 0);
  const last = live.at(-1) ?? null;
  if (amountCents === null) return { state: live.length ? 'paid' : 'no_amount', paidCents, dueCents: 0, lastPaidOn: last?.paidOn ?? null, last };
  const dueCents = amountCents - paidCents;
  const state: PayState = dueCents === 0 ? (live.length || amountCents === 0 ? 'paid' : 'not_paid') : live.length ? 'partly' : 'not_paid';
  return { state, paidCents, dueCents, lastPaidOn: last?.paidOn ?? null, last };
}

/** The last day of the pay period a bound date falls in: its Monday–Sunday week (policies) or its month (endorsements). */
export function periodEnd(boundDate: string, monthly: boolean): string | null {
  const d = parseDateKey(boundDate);
  if (!d) return null;
  if (monthly) return toLocalDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const daysToSunday = (7 - d.getDay()) % 7;
  return addDays(boundDate, daysToSunday);
}

/** Entered in RenewalIQ after the week / month it was bound in ended. */
export function addedLate(boundDate: string | undefined, createdAt: string | undefined, monthly: boolean): boolean {
  if (!boundDate || !createdAt) return false;
  const end = periodEnd(boundDate, monthly);
  return !!end && toLocalDateKey(new Date(createdAt)) > end;
}
