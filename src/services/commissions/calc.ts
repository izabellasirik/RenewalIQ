/**
 * Carrier 103 commission maths (sample version). Ported unchanged from the tested standalone
 * prototype: money is held in integer cents and percentages in thousandths of a percent ("milli"),
 * so every figure is exact; the only rounding is the one stated in assumption A1.
 *
 *   gross commission = signed premium × carrier commission %
 *   agent payout     = gross commission × producer split %
 *   Agency retained     = gross commission − agent payout   (every line ties to the cent)
 */

export type TransactionType = 'new_business' | 'renewal' | 'endorsement_add' | 'endorsement_return' | 'cancellation';

export const TRANSACTION_TYPES: Record<TransactionType, { label: string; short: string; sign: 1 | -1 }> = {
  new_business: { label: 'New business', short: 'New business', sign: 1 },
  renewal: { label: 'Renewal', short: 'Renewal', sign: 1 },
  endorsement_add: { label: 'Endorsement (added premium)', short: 'Endorsement +', sign: 1 },
  endorsement_return: { label: 'Endorsement (return premium)', short: 'Endorsement −', sign: -1 },
  cancellation: { label: 'Cancellation', short: 'Cancellation', sign: -1 },
};

export interface Producer {
  id: string;
  name: string;
  splitMilli: number;
}

export interface CommissionTransaction {
  id: string;
  /** YYYY-MM — the statement month (assumption A9: the effective date's month). */
  month: string;
  /** YYYY-MM-DD effective date. */
  date: string;
  account: string;
  policy: string;
  carrier: string;
  type: TransactionType;
  /** Always stored positive; the sign comes from the type (assumption A2). */
  premiumCents: number;
  rateMilli: number;
  producerId: string;
  /** Split fixed on the line when it was entered (assumption A7). */
  splitMilli: number;
}

export interface CommissionAdjustment {
  id: string;
  month: string;
  producerId: string;
  /** Signed: positive pays the producer more, negative deducts. */
  amountCents: number;
  reason: string;
  at: string;
  by: string;
  /** Set on a reversing entry: the adjustment it cancels. */
  reversesId?: string;
}

export interface CommissionLine extends CommissionTransaction {
  signedPremiumCents: number;
  gross: number;
  agent: number;
  retained: number;
}

// ---------- parsing and formatting ----------

/** "$1,234.56", "-500", "(500.00)" → signed cents; null when it isn't a number. */
export function parseMoney(input: unknown): number | null {
  let s = String(input ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$,]/g, '').replace(/^[−–]/, '-');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return null; // $100M ceiling for sample figures
  return negative && cents !== 0 ? -cents : cents;
}

/** "12.5", "12.5%" → 12500 (thousandths of a percent); null outside 0–100 or more than 3 decimals. */
export function parsePct(input: unknown): number | null {
  const s = String(input ?? '').trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{0,3})?$|^\.\d{1,3}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const milli = Number(whole || '0') * 1000 + Number((frac + '000').slice(0, 3));
  return milli > 100_000 ? null : milli;
}

const MINUS = '−';
export function fmtMoney(cents: number): string {
  const abs = Math.abs(cents);
  const s = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? MINUS + s : s;
}
export function fmtPct(milli: number): string {
  return `${(milli / 1000).toFixed(3).replace(/\.?0+$/, '')}%`;
}
/** Input-box form: "1234.56" / "-1234.56". */
export function moneyInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
/** Input-box form of a percentage: 12500 → "12.5". */
export const pctInput = (milli: number) => String(milli / 1000);

// ---------- the formula ----------

/** a × b / den, rounded half away from zero (assumption A1), exact for any safe integers. */
export function mulDivRound(a: number, b: number, den: number): number {
  const num = BigInt(a) * BigInt(b);
  const d = BigInt(den);
  let q = num / d;
  const r = num % d;
  if (2n * (r < 0n ? -r : r) >= d) q += num < 0n ? -1n : 1n;
  return Number(q);
}

export function calcLine({ premiumCents, rateMilli, splitMilli }: { premiumCents: number; rateMilli: number; splitMilli: number }) {
  const gross = mulDivRound(premiumCents, rateMilli, 100_000);
  const agent = mulDivRound(gross, splitMilli, 100_000);
  return { gross, agent, retained: gross - agent };
}

export const signedPremium = (type: TransactionType, cents: number) => (TRANSACTION_TYPES[type]?.sign ?? 1) * Math.abs(cents);

export function lineFor(tx: CommissionTransaction): CommissionLine {
  const premiumCents = signedPremium(tx.type, tx.premiumCents);
  return { ...tx, signedPremiumCents: premiumCents, ...calcLine({ premiumCents, rateMilli: tx.rateMilli, splitMilli: tx.splitMilli }) };
}

// ---------- monthly statement ----------

export interface LedgerState {
  producers: Producer[];
  transactions: CommissionTransaction[];
  adjustments: CommissionAdjustment[];
}

export const monthsOf = (state: LedgerState) => [...new Set([...state.transactions.map((t) => t.month), ...state.adjustments.map((a) => a.month)])].sort();

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export interface ProducerStatement {
  producer: Producer;
  lines: CommissionLine[];
  adjustments: CommissionAdjustment[];
  premium: number;
  gross: number;
  agent: number;
  adjTotal: number;
  /** The agency's share after payout adjustments (assumption A8). */
  retained: number;
  broughtForward: number;
  payable: number;
  carriedForward: number;
}
export type StatementTotals = Omit<ProducerStatement, 'producer' | 'lines' | 'adjustments'>;
export interface Statement {
  month: string;
  label: string;
  rows: ProducerStatement[];
  totals: StatementTotals;
}

/**
 * One month's statement for every producer (or one). A producer whose month ends below zero is paid
 * nothing and the shortfall is carried into the next month (assumption A4).
 */
export function statement(state: LedgerState, month: string, producerId?: string): Statement {
  const months = monthsOf(state).filter((m) => m <= month);
  if (!months.includes(month)) months.push(month);
  const carried = new Map<string, number>();
  let result: Statement | null = null;
  for (const m of months) {
    const rows: ProducerStatement[] = state.producers.map((p) => {
      const lines = state.transactions
        .filter((t) => t.month === m && t.producerId === p.id)
        .map(lineFor)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const adjustments = state.adjustments.filter((a) => a.month === m && a.producerId === p.id);
      const sum = (k: 'signedPremiumCents' | 'gross' | 'agent' | 'retained') => lines.reduce((s, l) => s + l[k], 0);
      const adjTotal = adjustments.reduce((s, a) => s + a.amountCents, 0);
      const broughtForward = carried.get(p.id) ?? 0;
      const agent = sum('agent');
      const balance = broughtForward + agent + adjTotal;
      return {
        producer: p,
        lines,
        adjustments,
        premium: sum('signedPremiumCents'),
        gross: sum('gross'),
        agent,
        retained: sum('retained') - adjTotal,
        adjTotal,
        broughtForward,
        payable: Math.max(0, balance),
        carriedForward: Math.min(0, balance),
      };
    });
    for (const r of rows) carried.set(r.producer.id, r.carriedForward);
    if (m === month) {
      const shown = producerId ? rows.filter((r) => r.producer.id === producerId) : rows;
      const tot = (k: keyof StatementTotals) => shown.reduce((s, r) => s + r[k], 0);
      result = {
        month,
        label: monthLabel(month),
        rows: shown,
        totals: { premium: tot('premium'), gross: tot('gross'), agent: tot('agent'), adjTotal: tot('adjTotal'), retained: tot('retained'), payable: tot('payable'), carriedForward: tot('carriedForward'), broughtForward: tot('broughtForward') },
      };
    }
  }
  return result!;
}

/** Gross = agent payouts + adjustments + Agency retained, for every producer and in total. */
export function ties(st: Statement): boolean {
  const ok = (r: Pick<StatementTotals, 'gross' | 'agent' | 'adjTotal' | 'retained'>) => r.gross === r.agent + r.adjTotal + r.retained;
  return st.rows.every(ok) && ok(st.totals);
}

// ---------- audit trail (append-only) ----------

export interface AuditEntry {
  readonly seq: number;
  readonly at: string;
  readonly by: string;
  readonly action: string;
  readonly detail: string;
  readonly reason: string;
}

/** Returns a new list with the entry added; existing entries are never changed or removed. */
export function appendAudit(audit: readonly AuditEntry[], entry: { at?: string; by?: string; action: string; detail: string; reason?: string }): readonly AuditEntry[] {
  const e: AuditEntry = Object.freeze({ seq: audit.length + 1, at: entry.at ?? new Date().toISOString(), by: entry.by ?? 'You', action: entry.action, detail: entry.detail, reason: entry.reason ?? '' });
  return Object.freeze([...audit, e]);
}

/** A manual adjustment needs a non-zero amount, a producer, a month and a reason. */
export function validateAdjustment({ producerId, month, amountCents, reason }: { producerId?: string; month?: string; amountCents: number | null; reason?: string }): string[] {
  const errors: string[] = [];
  if (!producerId) errors.push('Choose a producer.');
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) errors.push('Choose a month.');
  if (amountCents == null) errors.push('Enter an amount, e.g. 125.00 or -40.00.');
  else if (amountCents === 0) errors.push('The amount can’t be zero.');
  const r = String(reason ?? '').trim();
  if (!r || r.length < 5) errors.push('A reason is required (at least 5 characters).');
  return errors;
}
