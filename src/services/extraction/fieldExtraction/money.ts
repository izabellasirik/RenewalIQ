/** Parses a currency-ish string ("$5,200,000", "5.2 million", "5.2M") into a plain number, or null if it isn't one. */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,]/g, '').trim();
  const match = cleaned.match(/^([\d.]+)\s*(million|mm|m|thousand|k)?$/i);
  if (!match) return null;
  const [, numStr, suffix] = match;
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === 'million' || s === 'mm' || s === 'm') return n * 1_000_000;
  if (s === 'thousand' || s === 'k') return n * 1_000;
  return n;
}

/** Parses a plain integer/decimal count ("24", "1,200") — no currency suffix handling. */
export function parseCount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
