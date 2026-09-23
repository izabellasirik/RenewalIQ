/**
 * Lengths of time like driver experience or years in business, precise to the month:
 * "8 months", "1 year 6 months", "16+ years". Stored as a whole number of MONTHS (so matching
 * stays plain numeric comparison) plus an optional "or more" flag.
 *
 * Backward compatible by design: a plain number is the old storage format and means YEARS
 * (16 → 192 months) — every saved account, extracted value, intake answer, and carrier appetite
 * record written before months existed keeps its meaning.
 */
export interface Duration {
  months: number;
  /** "or more" — e.g. 16+ years. Informational; comparisons use `months` as the floor. */
  orMore?: boolean;
}

export type DurationValue = number | Duration;

export function isDuration(v: unknown): v is Duration {
  return typeof v === 'object' && v !== null && typeof (v as Duration).months === 'number' && Number.isFinite((v as Duration).months);
}

/** Months for a stored value: a Duration's months, or a legacy/plain number of years × 12. null when absent/unreadable. */
export function toMonths(v: unknown): number | null {
  if (isDuration(v)) return Math.max(0, Math.round(v.months));
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v * 12));
  if (typeof v === 'string') return parseDurationText(v)?.months ?? null;
  return null;
}

/** Years (possibly fractional) for places that still speak in years (application export, summaries). */
export function toYears(v: unknown): number | null {
  const m = toMonths(v);
  return m === null ? null : m / 12;
}

export function fromParts(years: number, months: number, orMore = false): Duration {
  const total = Math.max(0, Math.round((Number.isFinite(years) ? years : 0) * 12 + (Number.isFinite(months) ? months : 0)));
  return orMore ? { months: total, orMore: true } : { months: total };
}

/** Split into whole years + remaining months (for the Years/Months inputs). */
export function toParts(v: unknown): { years: number; months: number; orMore: boolean } | null {
  const m = toMonths(v);
  if (m === null) return null;
  return { years: Math.floor(m / 12), months: m % 12, orMore: isDuration(v) ? !!v.orMore : false };
}

/** "8 months", "1 year", "1 year 6 months", "16+ years", "1 year 6 months or more". */
export function formatDuration(v: unknown): string {
  const parts = toParts(v);
  if (!parts) return '';
  const { years, months, orMore } = parts;
  const y = years === 1 ? 'year' : 'years';
  const mo = months === 1 ? 'month' : 'months';
  if (years === 0 && months === 0) return orMore ? 'Less than 1 month or more' : '0 months';
  if (months === 0) return orMore ? `${years}+ ${y}` : `${years} ${y}`;
  if (years === 0) return orMore ? `${months}+ ${mo}` : `${months} ${mo}`;
  return `${years} ${y} ${months} ${mo}${orMore ? ' or more' : ''}`;
}

/**
 * Reads free text: "8 months", "1 year 2 months", "1 yr 6 mo", "16+ years", "2.5" (years),
 * "18 mos". A bare number is years, matching the legacy convention. null if nothing readable.
 */
export function parseDurationText(text: string): Duration | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const orMore = /\+|or more|plus/.test(t);
  const yMatch = t.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|y)\b/);
  const mMatch = t.match(/(\d+)\s*\+?\s*(?:months?|mos?|m)\b/);
  if (yMatch || mMatch) return fromParts(yMatch ? Number(yMatch[1]) : 0, mMatch ? Number(mMatch[1]) : 0, orMore);
  const bare = t.match(/^(\d+(?:\.\d+)?)\s*\+?$/);
  if (bare) return fromParts(Number(bare[1]), 0, orMore);
  return null;
}
