/**
 * Safe, deterministic display transformations for mapped application fields. Every function here
 * reformats an already-extracted value — it never invents or infers new information, and it never
 * mutates the underlying Risk Profile value (the transform only applies to what's displayed here).
 */

export function formatCurrency(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : String(value ?? '');
}

/** "1985-04-11" -> "04/11/1985". Parsed by string, not Date(), to avoid UTC-offset off-by-one. Returns the raw string unchanged if it isn't in a recognizable YYYY-MM-DD shape, rather than guessing. */
export function formatDateMDY(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

export function formatYesNo(value: unknown): string {
  return value ? 'Yes' : 'No';
}

/** Derived from years-in-business, not a separate tracked fact — a deterministic read of an existing field, never a guess. */
export function formatNewVenture(value: unknown): string {
  const years = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(years)) return '';
  return years < 2 ? 'Yes' : 'No';
}

export function formatStatus(value: unknown): string {
  if (value === 'open') return 'Open';
  if (value === 'closed') return 'Closed';
  return String(value ?? '');
}
