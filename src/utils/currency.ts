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

/**
 * For a free-text-but-often-numeric field (coverage current/requested limits, stored as plain
 * strings so a broker can still write "$1M/$2M CSL" when a bare number isn't enough): if `raw`,
 * once stripped of $/commas/whitespace, is a clean non-negative number, returns it normalized to
 * "$X,XXX" — otherwise returns `raw` completely unchanged. Idempotent: normalizing an
 * already-formatted "$100,000" strips right back down to "100000" and reformats to the exact same
 * string, so re-saving an unedited value never drifts.
 */
export function normalizeCurrencyText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;
  const cleaned = trimmed.replace(/[$,\s]/g, '');
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return formatCurrencyValue(Number(cleaned));
  }
  return trimmed;
}
