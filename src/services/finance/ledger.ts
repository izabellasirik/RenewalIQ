import { formatShortDate, parseDateKey, toLocalDateKey } from '../workflow/dates';

/**
 * Commission records (0064), as the app reads them. The database writes them — one per policy and
 * endorsement, freezing the agent, split, carrier rate and amounts when it's first recorded — and every
 * change goes through its functions. What's here only labels and works out what's shown: statuses,
 * review flags, expected payout dates (same rules as finance_pay_date) and what's left on a policy.
 */

export type LedgerKind = 'policy' | 'endorsement' | 'cancellation' | 'correction';
export type LedgerStream = 'weekly' | 'monthly';
export type LedgerOrigin = 'recorded' | 'historical' | 'admin';
export type LedgerStatus = 'missing_proof' | 'pending_verification' | 'verified' | 'historical_review' | 'settled_outside' | 'void';

export interface LedgerTransaction {
  id: string;
  submissionId: string;
  clientName: string;
  quoteId: string | null;
  policyId: string | null;
  kind: LedgerKind;
  stream: LedgerStream;
  origin: LedgerOrigin;
  originalTransactionId: string | null;
  cancellationId: string | null;
  replacedBy: string | null;
  policyNumber: string | null;
  carrierName: string;
  carrierKey: string;
  businessType: string | null;
  eventDate: string;
  payableFrom: string;
  netCents: number;
  agentUserId: string | null;
  agentName: string | null;
  agentRate: number | null;
  agentCents: number | null;
  carrierRate: number;
  /** 'policy_rate': the carrier % entered on the policy / endorsement itself (0073). */
  carrierRateSource: 'carrier_rate' | 'default' | 'historical' | 'confirmed' | 'actual' | 'policy_rate';
  carrierCents: number;
  proofStatus: 'missing_proof' | 'has_proof';
  verificationStatus: 'unverified' | 'verified' | 'void';
  verifiedAt: string | null;
  verifiedWithoutProof: boolean;
  verificationReason: string | null;
  rateEvidence: string | null;
  rateConfirmedAt: string | null;
  voidReason: string | null;
  settlement: 'open' | 'settled_outside';
  settledReason: string | null;
  reviewFlags: string[];
  createdAt: string;
}

export interface LedgerCancellation {
  id: string;
  transactionId: string;
  submissionId: string;
  cancelType: 'full' | 'partial';
  effectiveDate: string;
  reason: string;
  expectedRefundCents: number | null;
  documentIds: string[];
  status: 'requested' | 'awaiting_amount' | 'approved' | 'rejected' | 'withdrawn';
  requestedBy: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  returnedNetCents: number | null;
  carrierAdjustmentCents: number | null;
  resultTransactionId: string | null;
}

export interface CarrierReceipt {
  id: string;
  transactionId: string;
  amountCents: number;
  receivedDate: string;
  reference: string | null;
  note: string | null;
  voidedAt: string | null;
}

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export interface PayoutSchedule {
  weeklyPeriodStartDow: number;
  weeklyPayDow: number;
  monthlyPayRule: 'first_weekday' | 'day_of_month';
  monthlyPayDow: number;
  monthlyPayDay: number | null;
}

/** Monday–Sunday, paid the following Friday; endorsements on the first Friday of the next month (until confirmed). */
export const DEFAULT_PAYOUT_SCHEDULE: PayoutSchedule = { weeklyPeriodStartDow: 1, weeklyPayDow: 5, monthlyPayRule: 'first_weekday', monthlyPayDow: 5, monthlyPayDay: null };

export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const STATUS_LABELS: Record<LedgerStatus, string> = {
  missing_proof: 'Missing Document',
  pending_verification: 'Pending Verification',
  verified: 'Verified',
  historical_review: 'Historical – needs review',
  settled_outside: 'Settled outside RenewalIQ',
  void: 'Void',
};

export const KIND_LABELS: Record<LedgerKind, string> = { policy: 'Policy', endorsement: 'Endorsement', cancellation: 'Cancellation', correction: 'Correction' };

export const FLAG_LABELS: Record<string, string> = {
  carrier_rate_differs: 'Carrier % entered differs from the agency’s rate',
  historical: 'Recorded before commission tracking',
  uncertain_carrier_rate: 'Carrier rate not confirmed',
  uncertain_agent: 'Agent not confirmed',
  uncertain_agent_rate: 'Agent split not confirmed',
  no_agent: 'No agent on the account when recorded',
  no_agent_rate: 'Agent had no split when recorded',
  default_carrier_rate: 'Carrier at the 10% default',
  no_carrier_rate: 'Carrier % not set',
  unlinked_endorsement: 'Endorsement not linked to its policy',
  changed_since_recorded: 'Changed on the account since recorded',
  removed: 'Removed from the account',
  account_deleted: 'Account deleted',
  created_before_ledger: 'Created before commission tracking',
  invalid_amount: 'Net premium unreadable',
  invalid_date: 'Date unreadable',
  invalid_carrier: 'Carrier missing',
};

/** Same list as finance_blocking_flags(): verification waits until these are dealt with. */
export const BLOCKING_FLAGS = ['no_agent', 'no_agent_rate', 'unlinked_endorsement', 'changed_since_recorded', 'removed', 'account_deleted', 'invalid_amount', 'invalid_date', 'invalid_carrier', 'no_carrier_rate'];

/** Same rules as finance_status(). */
export function ledgerStatus(t: Pick<LedgerTransaction, 'verificationStatus' | 'settlement' | 'origin' | 'rateConfirmedAt' | 'proofStatus'>): LedgerStatus {
  if (t.verificationStatus === 'void') return 'void';
  if (t.settlement === 'settled_outside') return 'settled_outside';
  if (t.verificationStatus === 'verified') return 'verified';
  if (t.origin === 'historical' && !t.rateConfirmedAt) return 'historical_review';
  if (t.proofStatus === 'missing_proof') return 'missing_proof';
  return 'pending_verification';
}

export const blockingFlags = (t: Pick<LedgerTransaction, 'reviewFlags'>) => t.reviewFlags.filter((f) => BLOCKING_FLAGS.includes(f));

/** What stops this record from being verified now, in words (empty when it can be). */
export function verificationBlockers(t: LedgerTransaction): string[] {
  if (t.verificationStatus !== 'unverified' || t.settlement !== 'open') return [];
  const out: string[] = [];
  if (t.origin === 'historical' && !t.rateConfirmedAt) out.push('Confirm the agent, split and carrier rate first');
  for (const f of blockingFlags(t)) out.push(FLAG_LABELS[f] ?? f);
  return out;
}

const isoDow = (d: Date) => ((d.getDay() + 6) % 7) + 1;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The payout date for a record of this stream payable from this date. Same rules as finance_pay_date(). */
export function payoutDate(schedule: PayoutSchedule, stream: LedgerStream, dateKey: string): string {
  const d = parseDateKey(dateKey);
  if (!d) return '';
  if (stream === 'weekly') {
    const periodStart = addDays(d, -((isoDow(d) - schedule.weeklyPeriodStartDow + 7) % 7));
    const afterEnd = addDays(periodStart, 7);
    return toLocalDateKey(addDays(afterEnd, (schedule.weeklyPayDow - isoDow(afterEnd) + 7) % 7));
  }
  const firstOfNext = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  if (schedule.monthlyPayRule === 'day_of_month') return toLocalDateKey(addDays(firstOfNext, (schedule.monthlyPayDay ?? 1) - 1));
  return toLocalDateKey(addDays(firstOfNext, (schedule.monthlyPayDow - isoDow(firstOfNext) + 7) % 7));
}

/**
 * "payout Oct 23", "payout Oct 23 once verified", or — when that payday has passed and the commission
 * still isn't verified — "next payout once verified" (it's paid with the first payout after it's verified).
 */
export function payoutWords(payDate: string | null | undefined, verified: boolean, today = toLocalDateKey(new Date())): string {
  if (!payDate) return '';
  if (verified) return `payout ${formatShortDate(payDate)}`;
  return payDate < today ? 'next payout once verified' : `payout ${formatShortDate(payDate)} once verified`;
}

/** "Policies bound Monday–Sunday are paid the following Friday." */
export function describeSchedule(s: PayoutSchedule): { weekly: string; monthly: string } {
  const end = ((s.weeklyPeriodStartDow + 5) % 7) + 1;
  return {
    weekly: `Policies bound ${WEEKDAYS[s.weeklyPeriodStartDow]}–${WEEKDAYS[end]} are paid the following ${WEEKDAYS[s.weeklyPayDow]}.`,
    monthly:
      s.monthlyPayRule === 'day_of_month'
        ? `Endorsements dated in a month are paid on day ${s.monthlyPayDay} of the next month.`
        : `Endorsements dated in a month are paid on the first ${WEEKDAYS[s.monthlyPayDow]} of the next month.`,
  };
}

/** Whether a record would go into its next payout, and if not, why (shown, never paid automatically). */
export function payoutReadiness(t: LedgerTransaction): { payable: boolean; note: string } {
  const status = ledgerStatus(t);
  if (status === 'void') return { payable: false, note: 'Void — not paid' };
  if (status === 'settled_outside') return { payable: false, note: 'Settled outside RenewalIQ — not paid again' };
  if (status === 'historical_review') return { payable: false, note: 'Historical — excluded until reviewed' };
  if (status !== 'verified') return { payable: false, note: 'Awaiting verification — flagged for admin review' };
  if (!t.agentUserId || t.agentCents === null) return { payable: false, note: 'No agent commission on this record' };
  return { payable: true, note: 'Verified — eligible for its payout' };
}

/** Net premium still on a policy: it, its corrections, its endorsements (and theirs), less earlier cancellations. Same as finance_remaining_net(). */
export function remainingNetCents(policyId: string, all: LedgerTransaction[]): number {
  const live = (t: LedgerTransaction) => t.verificationStatus !== 'void';
  const policy = all.find((t) => t.id === policyId);
  if (!policy) return 0;
  const endorsements = all.filter((t) => t.originalTransactionId === policyId && t.kind === 'endorsement' && live(t) && !t.replacedBy);
  const related = new Set([policyId, ...endorsements.map((e) => e.id)]);
  const corrections = all.filter((t) => t.kind === 'correction' && live(t) && t.originalTransactionId && related.has(t.originalTransactionId));
  const cancellations = all.filter((t) => t.kind === 'cancellation' && live(t) && t.originalTransactionId === policyId);
  const sum = (list: LedgerTransaction[]) => list.reduce((s, t) => s + t.netCents, 0);
  return policy.netCents + sum(endorsements) + sum(corrections) + sum(cancellations);
}

/** Carrier receipts against a record: what was received, and how it compares with the carrier commission expected. */
export function carrierReceived(t: Pick<LedgerTransaction, 'id' | 'carrierCents'>, receipts: CarrierReceipt[]): { receivedCents: number; state: 'none' | 'partial' | 'received' | 'over' } {
  const receivedCents = receipts.filter((r) => r.transactionId === t.id && !r.voidedAt).reduce((s, r) => s + r.amountCents, 0);
  if (receivedCents === 0) return { receivedCents, state: 'none' };
  if (Math.abs(receivedCents) < Math.abs(t.carrierCents)) return { receivedCents, state: 'partial' };
  if (receivedCents === t.carrierCents) return { receivedCents, state: 'received' };
  return { receivedCents, state: Math.abs(receivedCents) > Math.abs(t.carrierCents) ? 'over' : 'received' };
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** A database row (snake_case, numerics as strings) → LedgerTransaction. */
export function toTransaction(r: Record<string, unknown>): LedgerTransaction {
  return {
    id: String(r.id),
    submissionId: String(r.submission_id),
    clientName: String(r.client_name ?? ''),
    quoteId: str(r.quote_id),
    policyId: str(r.policy_id),
    kind: r.kind as LedgerKind,
    stream: r.stream as LedgerStream,
    origin: r.origin as LedgerOrigin,
    originalTransactionId: str(r.original_transaction_id),
    cancellationId: str(r.cancellation_id),
    replacedBy: str(r.replaced_by),
    policyNumber: str(r.policy_number),
    carrierName: String(r.carrier_name ?? ''),
    carrierKey: String(r.carrier_key ?? ''),
    businessType: str(r.business_type),
    eventDate: String(r.event_date),
    payableFrom: String(r.payable_from),
    netCents: num(r.net_cents),
    agentUserId: str(r.agent_user_id),
    agentName: str(r.agent_name),
    agentRate: numOrNull(r.agent_rate),
    agentCents: numOrNull(r.agent_cents),
    carrierRate: num(r.carrier_rate),
    carrierRateSource: r.carrier_rate_source as LedgerTransaction['carrierRateSource'],
    carrierCents: num(r.carrier_cents),
    proofStatus: r.proof_status === 'has_proof' ? 'has_proof' : 'missing_proof',
    verificationStatus: r.verification_status as LedgerTransaction['verificationStatus'],
    verifiedAt: str(r.verified_at),
    verifiedWithoutProof: r.verified_without_proof === true,
    verificationReason: str(r.verification_reason),
    rateEvidence: str(r.rate_evidence),
    rateConfirmedAt: str(r.rate_confirmed_at),
    voidReason: str(r.void_reason),
    settlement: r.settlement === 'settled_outside' ? 'settled_outside' : 'open',
    settledReason: str(r.settled_reason),
    reviewFlags: Array.isArray(r.review_flags) ? (r.review_flags as string[]) : [],
    createdAt: String(r.created_at ?? ''),
  };
}

export function toCancellation(r: Record<string, unknown>): LedgerCancellation {
  return {
    id: String(r.id),
    transactionId: String(r.transaction_id),
    submissionId: String(r.submission_id),
    cancelType: r.cancel_type === 'full' ? 'full' : 'partial',
    effectiveDate: String(r.effective_date),
    reason: String(r.reason ?? ''),
    expectedRefundCents: numOrNull(r.expected_refund_cents),
    documentIds: Array.isArray(r.document_ids) ? (r.document_ids as string[]) : [],
    status: r.status as LedgerCancellation['status'],
    requestedBy: String(r.requested_by ?? ''),
    requestedAt: String(r.requested_at ?? ''),
    decidedAt: str(r.decided_at),
    decisionNote: str(r.decision_note),
    returnedNetCents: numOrNull(r.returned_net_cents),
    carrierAdjustmentCents: numOrNull(r.carrier_adjustment_cents),
    resultTransactionId: str(r.result_transaction_id),
  };
}

export function toReceipt(r: Record<string, unknown>): CarrierReceipt {
  return {
    id: String(r.id),
    transactionId: String(r.transaction_id),
    amountCents: num(r.amount_cents),
    receivedDate: String(r.received_date),
    reference: str(r.reference),
    note: str(r.note),
    voidedAt: str(r.voided_at),
  };
}

export function toSchedule(r: Record<string, unknown> | null | undefined): PayoutSchedule {
  if (!r) return DEFAULT_PAYOUT_SCHEDULE;
  return {
    weeklyPeriodStartDow: num(r.weekly_period_start_dow) || 1,
    weeklyPayDow: num(r.weekly_pay_dow) || 5,
    monthlyPayRule: r.monthly_pay_rule === 'day_of_month' ? 'day_of_month' : 'first_weekday',
    monthlyPayDow: num(r.monthly_pay_dow) || 5,
    monthlyPayDay: numOrNull(r.monthly_pay_day),
  };
}

/** The current record for each policy / endorsement on the accounts (the one not replaced). */
export function currentRecordsByPolicy(all: LedgerTransaction[]): Map<string, LedgerTransaction> {
  const out = new Map<string, LedgerTransaction>();
  for (const t of all) if (t.policyId && !t.replacedBy) out.set(`${t.submissionId}|${t.policyId}`, t);
  return out;
}
