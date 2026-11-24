import type { MoneyEntry, MoneyKind } from './money';

/**
 * Reading an income & expense statement (PDF, Excel or CSV — like the agency's weekly statements) into
 * entries for Income & expenses. Read from the file's own text, no AI: section headings say income or
 * expense ("INCOME", "EXPENSES - STAFF & REFERRALS"), each line with a description and an amount is an
 * entry, totals and the result section are skipped. Nothing is saved until the admin ticks what to add.
 */

export interface StatementLine {
  key: string;
  kind: MoneyKind;
  category: string;
  description: string;
  amountCents: number;
  /** The heading it was under, as written. */
  section: string;
  /** Not ticked at first, and why — e.g. Profit & loss already counts it from the policies. */
  hold?: string;
}

export interface ParsedStatement {
  /** YYYY-MM-DD — the statement's period end (or the date it was prepared), when it says one. */
  date: string | null;
  period: string;
  lines: StatementLine[];
  /** Lines left out (a $0 amount), for the admin to see. */
  skipped: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONEY = /^\(?-?\$?\s?-?[\d,]+(\.\d{1,2})?\)?$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function cents(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (!MONEY.test(t) || !/\d/.test(t)) return null;
  const n = Math.round(Number(t.replace(/[^\d.]/g, '')) * 100);
  return Number.isFinite(n) ? (t.includes('-') || t.startsWith('(') ? -n : n) : null;
}

const key2 = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "November 16–22, 2026" → the 22nd; "Nov 30 – Dec 6, 2026" → Dec 6; else "Prepared November 23, 2026". */
function statementDate(text: string): { date: string | null; period: string } {
  const month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const range = new RegExp(`${month}\\s+(\\d{1,2})\\s*[–—-]\\s*(?:${month}\\s+)?(\\d{1,2}),?\\s*(\\d{4})`, 'i').exec(text);
  const mIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
  if (range) {
    const endMonth = range[3] ? mIndex(range[3]) : mIndex(range[1]);
    return { date: key2(Number(range[5]), endMonth, Number(range[4])), period: clean(range[0]) };
  }
  const single = new RegExp(`${month}\\s+(\\d{1,2}),?\\s*(\\d{4})`, 'i').exec(text);
  if (single) return { date: key2(Number(single[3]), mIndex(single[1]), Number(single[2])), period: clean(single[0]) };
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  return numeric ? { date: key2(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2])), period: numeric[0] } : { date: null, period: '' };
}

/** The category an entry gets, and whether Profit & loss already counts it on its own. */
function categorize(kind: MoneyKind, section: string, description: string): { category: string; hold?: string } {
  const d = description.toLowerCase();
  const s = section.toLowerCase();
  if (kind === 'income') {
    if (/carrier\s+commission/.test(d)) return { category: 'Carrier commission', hold: 'Profit & loss already adds carrier commission from the policies — adding it here would count it twice.' };
    if (/broker\s+fee/.test(d)) return { category: 'Broker fees' };
    if (/contingen|bonus/.test(d)) return { category: 'Contingency / bonus' };
    return { category: 'Other income' };
  }
  if (/referral|partner/.test(d)) return { category: 'Referral partners' };
  if (/producer|sales|agent|commission/.test(s) || /\(\d+\s+sales?\)/.test(d)) {
    return { category: 'Agent commission', hold: 'Profit & loss already subtracts agent commission on the policies — tick it only if this payout isn’t that commission.' };
  }
  if (/staff|payroll|salar|wage/.test(s) || /\bbase\b|\bdays?\b|salary|payroll/.test(d)) return { category: 'Payroll' };
  if (/rent/.test(d)) return { category: 'Rent' };
  if (/software|subscription/.test(d)) return { category: 'Software & subscriptions' };
  if (/marketing|ads?\b/.test(d)) return { category: 'Marketing' };
  return { category: 'Other expense' };
}

/** Reads a statement from its lines of text (each line's cells, left to right). Null when it isn't one. */
export function parseStatement(lines: string[][]): ParsedStatement | null {
  const all = lines.map((cells) => clean(cells.join(' ')));
  const { date, period } = statementDate(all.slice(0, 6).join(' ') || all.join(' '));
  let kind: MoneyKind | null = null;
  let section = '';
  const out: StatementLine[] = [];
  const skipped: string[] = [];
  for (const [i, cells] of lines.entries()) {
    const text = all[i];
    if (!text) continue;
    const heading = text.toUpperCase();
    // A heading: "INCOME", "EXPENSES - SALES PRODUCERS", "RESULT" (nothing after it is an entry).
    if (!cells.some((c) => cents(c) !== null)) {
      if (/^(income|revenue)\b/i.test(text) && heading === text) [kind, section] = ['income', text];
      else if (/^(expenses?|costs?|payouts?)\b/i.test(text) && heading === text) [kind, section] = ['expense', text];
      else if (/^(result|summary|net|totals?)\b/i.test(text) && heading === text) kind = null;
      continue;
    }
    if (!kind) continue;
    const amountCell = [...cells].reverse().find((c) => cents(c) !== null)!;
    const description = clean(cells.filter((c) => c !== amountCell).join(' '));
    if (!description || /^description$/i.test(description) || /\btotal\b|^less:|^net\b|subtotal/i.test(description)) continue;
    const amount = cents(amountCell)!;
    if (amount === 0) {
      skipped.push(`${description} ($0.00)`);
      continue;
    }
    const { category, hold } = categorize(kind, section, description);
    out.push({ key: `${i}`, kind, category, description: description.slice(0, 300), amountCents: Math.abs(amount), section, ...(hold ? { hold } : {}) });
  }
  return out.length ? { date, period, lines: out, skipped } : null;
}

/** Already in Income & expenses (same day, kind, amount and description) — not added twice. */
export function alreadyAdded(line: Pick<StatementLine, 'kind' | 'amountCents' | 'description'>, date: string, entries: Pick<MoneyEntry, 'kind' | 'date' | 'amountCents' | 'description'>[]): boolean {
  const d = clean(line.description).toLowerCase();
  return entries.some((e) => e.kind === line.kind && e.date === date && e.amountCents === line.amountCents && clean(e.description).toLowerCase() === d);
}
