import {
  TRANSACTION_TYPES,
  appendAudit,
  fmtMoney,
  fmtPct,
  lineFor,
  monthLabel,
  validateAdjustment,
  type AuditEntry,
  type CommissionAdjustment,
  type CommissionTransaction,
  type LedgerState,
  type Producer,
  type TransactionType,
} from './calc';
import { SAMPLE_ADJUSTMENTS, SAMPLE_PRODUCERS, SAMPLE_TRANSACTIONS } from './sampleData';

/**
 * The Commissions preview's working copy of the FICTIONAL sample data: the ledger plus its
 * append-only audit history, and every change a manager can make to it. Pure functions — each
 * returns a new ledger (or errors) and never touches RenewalIQ's database. The page keeps the
 * result in this browser only (see loadSampleLedger / saveSampleLedger).
 */
export interface SampleLedger extends LedgerState {
  audit: readonly AuditEntry[];
  nextId: number;
}

export const SAMPLE_STORAGE_VERSION = 2;
const storageKey = (userId: string) => `renewaliq-commissions-sample:v${SAMPLE_STORAGE_VERSION}:${userId}`;

export function freshSampleLedger(): SampleLedger {
  let audit: readonly AuditEntry[] = [];
  audit = appendAudit(audit, { at: '2026-10-01T15:00:00Z', by: 'System', action: 'Sample data loaded', detail: `${SAMPLE_TRANSACTIONS.length} fictional transactions for September–October 2026` });
  for (const a of SAMPLE_ADJUSTMENTS) {
    audit = appendAudit(audit, { at: a.at, by: a.by, action: 'Manual adjustment', detail: adjustmentDetail(a, SAMPLE_PRODUCERS), reason: a.reason });
  }
  return {
    producers: SAMPLE_PRODUCERS.map((p) => ({ ...p })),
    transactions: SAMPLE_TRANSACTIONS.map((t) => ({ ...t })),
    adjustments: SAMPLE_ADJUSTMENTS.map((a) => ({ ...a })),
    audit,
    nextId: 100,
  };
}

const producerName = (id: string, producers: Producer[]) => producers.find((p) => p.id === id)?.name ?? '—';
function adjustmentDetail(a: CommissionAdjustment, producers: Producer[]) {
  return `${producerName(a.producerId, producers)} · ${monthLabel(a.month)} · ${fmtMoney(a.amountCents)} (${a.id.toUpperCase()})`;
}

// ---------- browser storage (per signed-in user; never sent anywhere) ----------

function isLedger(v: unknown): v is SampleLedger {
  const l = v as SampleLedger;
  return !!l && Array.isArray(l.producers) && Array.isArray(l.transactions) && Array.isArray(l.adjustments) && Array.isArray(l.audit) && typeof l.nextId === 'number';
}

export function loadSampleLedger(userId: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): SampleLedger {
  try {
    const raw = storage?.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (isLedger(parsed)) return { ...parsed, audit: Object.freeze(parsed.audit.map((e) => Object.freeze({ ...e }))) };
  } catch {
    /* unreadable or blocked storage: start from the sample */
  }
  return freshSampleLedger();
}

export function saveSampleLedger(userId: string, ledger: SampleLedger, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(storageKey(userId), JSON.stringify(ledger));
  } catch {
    /* private mode or full storage: the preview still works for this visit */
  }
}

export function clearSampleLedger(userId: string, storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.removeItem(storageKey(userId));
  } catch {
    /* nothing stored */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ---------- changes (each one is recorded in the audit history) ----------

export type Result = { ok: true; ledger: SampleLedger; message: string } | { ok: false; errors: string[] };
const FIELD_LABEL = { premium: 'premium', rate: 'carrier commission %', split: 'producer split %' } as const;
export type EditableField = keyof typeof FIELD_LABEL;

/** Changes one transaction's premium, commission % or split. A premium is stored positive (the type gives the sign). */
export function editTransaction(l: SampleLedger, id: string, field: EditableField, value: number | null, by: string): Result {
  const tx = l.transactions.find((t) => t.id === id);
  if (!tx) return { ok: false, errors: ['That transaction no longer exists.'] };
  if (value == null) return { ok: false, errors: [`That ${FIELD_LABEL[field]} isn’t valid. Nothing was changed.`] };
  const key = field === 'premium' ? 'premiumCents' : field === 'rate' ? 'rateMilli' : 'splitMilli';
  const next = field === 'premium' ? Math.abs(value) : value;
  if (tx[key] === next) return { ok: true, ledger: l, message: 'No change.' };
  const fmt = field === 'premium' ? fmtMoney : fmtPct;
  const before = lineFor(tx);
  const updated = { ...tx, [key]: next };
  const after = lineFor(updated);
  return {
    ok: true,
    ledger: {
      ...l,
      transactions: l.transactions.map((t) => (t.id === id ? updated : t)),
      audit: appendAudit(l.audit, { by, action: `Changed ${FIELD_LABEL[field]}`, detail: `${tx.policy} (${tx.account}): ${fmt(tx[key])} → ${fmt(next)}. Payout ${fmtMoney(before.agent)} → ${fmtMoney(after.agent)}` }),
    },
    message: `Updated. ${producerName(tx.producerId, l.producers)}’s payout on this line is now ${fmtMoney(after.agent)}.`,
  };
}

export interface NewTransactionInput {
  date: string;
  account: string;
  policy: string;
  carrier: string;
  type: TransactionType;
  premiumCents: number | null;
  rateMilli: number | null;
  producerId: string;
  /** Blank = the producer's default split. */
  splitMilli: number | null | undefined;
}

export function addTransaction(l: SampleLedger, input: NewTransactionInput, by: string): Result {
  const producer = l.producers.find((p) => p.id === input.producerId);
  const split = input.splitMilli === undefined ? producer?.splitMilli : input.splitMilli;
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.push('Choose an effective date.');
  if (!input.account.trim()) errors.push('Enter an account name.');
  if (!input.policy.trim()) errors.push('Enter a policy number.');
  if (!TRANSACTION_TYPES[input.type]) errors.push('Choose a transaction type.');
  if (input.premiumCents == null || input.premiumCents === 0) errors.push('Enter a premium, e.g. 3500.');
  if (input.rateMilli == null) errors.push('Enter the carrier commission %, from 0 to 100.');
  if (!producer) errors.push('Choose a producer.');
  if (producer && split == null) errors.push('The split must be from 0 to 100%.');
  if (errors.length) return { ok: false, errors };
  const tx: CommissionTransaction = {
    id: `t${l.nextId}`,
    month: input.date.slice(0, 7),
    date: input.date,
    account: input.account.trim().slice(0, 80),
    policy: input.policy.trim().slice(0, 40),
    carrier: input.carrier.slice(0, 60),
    type: input.type,
    premiumCents: Math.abs(input.premiumCents!),
    rateMilli: input.rateMilli!,
    producerId: producer!.id,
    splitMilli: split!,
  };
  const line = lineFor(tx);
  return {
    ok: true,
    ledger: {
      ...l,
      transactions: [...l.transactions, tx],
      nextId: l.nextId + 1,
      audit: appendAudit(l.audit, { by, action: 'Added transaction', detail: `${tx.policy} (${tx.account}) · ${TRANSACTION_TYPES[tx.type].label} · premium ${fmtMoney(line.signedPremiumCents)} · ${producer!.name} payout ${fmtMoney(line.agent)}` }),
    },
    message: `Added. ${producer!.name}’s payout on it is ${fmtMoney(line.agent)}.`,
  };
}

export function addAdjustment(l: SampleLedger, input: { month: string; producerId: string; amountCents: number | null; reason: string }, by: string, now = new Date().toISOString()): Result {
  const errors = validateAdjustment(input);
  if (!l.producers.some((p) => p.id === input.producerId) && input.producerId) errors.push('Choose a producer.');
  if (errors.length) return { ok: false, errors };
  const a: CommissionAdjustment = { id: `a${l.nextId}`, month: input.month, producerId: input.producerId, amountCents: input.amountCents!, reason: input.reason.trim().slice(0, 300), at: now, by };
  return {
    ok: true,
    ledger: { ...l, adjustments: [...l.adjustments, a], nextId: l.nextId + 1, audit: appendAudit(l.audit, { by, at: now, action: 'Manual adjustment', detail: adjustmentDetail(a, l.producers), reason: a.reason }) },
    message: 'Adjustment recorded and added to the audit history.',
  };
}

/** The only way to undo an adjustment: an opposite entry with its own reason. The original stays. */
export function reverseAdjustment(l: SampleLedger, id: string, reason: string, by: string, now = new Date().toISOString()): Result {
  const orig = l.adjustments.find((a) => a.id === id);
  if (!orig) return { ok: false, errors: ['That adjustment no longer exists.'] };
  if (orig.reversesId) return { ok: false, errors: ['A reversal can’t itself be reversed — record a new adjustment instead.'] };
  if (l.adjustments.some((a) => a.reversesId === id)) return { ok: false, errors: ['This adjustment has already been reversed.'] };
  const why = reason.trim();
  if (why.length < 5) return { ok: false, errors: ['A reason is required (at least 5 characters).'] };
  const r: CommissionAdjustment = { id: `a${l.nextId}`, month: orig.month, producerId: orig.producerId, amountCents: -orig.amountCents, reason: `Reversal of ${orig.id.toUpperCase()}: ${why.slice(0, 280)}`, reversesId: orig.id, at: now, by };
  return {
    ok: true,
    ledger: {
      ...l,
      adjustments: [...l.adjustments, r],
      nextId: l.nextId + 1,
      audit: appendAudit(l.audit, { by, at: now, action: 'Reversed adjustment', detail: `${orig.id.toUpperCase()} reversed by ${r.id.toUpperCase()} · ${adjustmentDetail(r, l.producers)}`, reason: why }),
    },
    message: 'Reversal recorded. The original stays in the history.',
  };
}

/** A producer's default split — used for transactions added afterwards; existing lines keep theirs (assumption A7). */
export function setDefaultSplit(l: SampleLedger, producerId: string, splitMilli: number | null, by: string): Result {
  const p = l.producers.find((x) => x.id === producerId);
  if (!p) return { ok: false, errors: ['Unknown producer.'] };
  if (splitMilli == null) return { ok: false, errors: ['That split isn’t valid. Nothing was changed.'] };
  if (splitMilli === p.splitMilli) return { ok: true, ledger: l, message: 'No change.' };
  return {
    ok: true,
    ledger: {
      ...l,
      producers: l.producers.map((x) => (x.id === producerId ? { ...x, splitMilli } : x)),
      audit: appendAudit(l.audit, { by, action: 'Changed default split', detail: `${p.name}: ${fmtPct(p.splitMilli)} → ${fmtPct(splitMilli)} (new transactions only)` }),
    },
    message: `${p.name}’s default split is now ${fmtPct(splitMilli)}.`,
  };
}

// ---------- CSV (spreadsheet-safe) ----------

function cell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // never a spreadsheet formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n');
