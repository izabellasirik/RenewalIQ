/**
 * Shared currency formatting/parsing for every monetary field in the app (annual revenue, coverage
 * limits, vehicle stated value, loss amounts, ...) — one implementation reused everywhere a broker
 * types plain digits and expects to see them read back as "$100,000", rather than each editor
 * inventing its own regex.
 */

/** "100000" (number or numeric string) -> "$100,000". Anything not cleanly numeric is returned as-is (never corrupted into "$NaN" or silently dropped). */
export function formatCurrencyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : String(value);
}

/** For a true numeric field (e.g. FieldValue<number> like annualRevenue): strips $/commas/whitespace and returns a clean number, or null for an empty input. Returns null (never NaN) for anything unparseable, so a bad edit can't silently corrupt the stored value into NaN. */
export function parseCurrencyInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** One amount as brokers and documents write it: "1,000,000", "$1,000,000", "1M", "1.5 mm", "500k". Null for anything else. */
function parseLimitAmount(part: string): number | null {
  const m = part.replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)(million|mm|m|thousand|k)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const s = m[2]?.toLowerCase();
  return s === 'million' || s === 'mm' || s === 'm' ? n * 1_000_000 : s === 'thousand' || s === 'k' ? n * 1_000 : n;
}

/**
 * For a free-text-but-often-numeric field (coverage current/requested limits, deductibles, stored as
 * plain strings so a broker can still write "$1M/$2M CSL" when a bare number isn't enough): a clean
 * amount becomes "$X,XXX", and a split limit — up to three amounts separated by "/" (per occurrence /
 * aggregate) — becomes "$1,000,000/$2,000,000", each part formatted on its own and never run together
 * into one number. Anything else is returned unchanged. Idempotent: re-normalizing a formatted value
 * gives the same string, so re-saving an unedited value never drifts.
 */
export function normalizeCurrencyText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;
  const parts = trimmed.split(/\s*\/\s*/);
  if (parts.length <= 3) {
    const amounts = parts.map(parseLimitAmount);
    if (amounts.every((n): n is number => n !== null)) {
      const repaired = amounts.length === 1 ? unmergeSplitLimit(amounts[0]) : null;
      return (repaired ?? amounts).map((n) => formatCurrencyValue(n)).join('/');
    }
  }
  return trimmed;
}

/**
 * Repairs a split limit that an earlier version read as one number ("$1,000,000/$2,000,000" →
 * 10000002000000). Only for an amount no trucking limit reaches (over $1 billion) whose digits split
 * exactly one way into two round limits (each at least $10,000, ending in four or more zeros, the
 * first no larger than the second). Anything else is left alone.
 */
function unmergeSplitLimit(n: number): [number, number] | null {
  if (!Number.isInteger(n) || n <= 1_000_000_000) return null;
  const digits = String(n);
  const round = (d: string) => /^[1-9]\d*0000$/.test(d) && Number(d) >= 10_000;
  const splits: [number, number][] = [];
  for (let i = 5; i <= digits.length - 5; i++) {
    const a = digits.slice(0, i);
    const b = digits.slice(i);
    if (round(a) && round(b) && Number(a) <= Number(b)) splits.push([Number(a), Number(b)]);
  }
  return splits.length === 1 ? splits[0] : null;
}
