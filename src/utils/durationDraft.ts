import { fromParts, toParts, type Duration } from './duration';

/** Editing state for a duration: the two boxes as typed, plus the "or more" flag. */
export interface DurationDraft {
  years: string;
  months: string;
  orMore: boolean;
}

export const EMPTY_DURATION_DRAFT: DurationDraft = { years: '', months: '', orMore: false };

export function durationToDraft(v: unknown): DurationDraft {
  const p = toParts(v);
  if (!p) return EMPTY_DURATION_DRAFT;
  return { years: p.years ? String(p.years) : p.months ? '' : '0', months: p.months ? String(p.months) : '', orMore: p.orMore };
}

export function part(s: string): number | null {
  const t = s.trim();
  if (!t) return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Whole, non-negative years and months (0–11). Empty boxes are fine. */
export function isValidDurationDraft(d: DurationDraft): boolean {
  const y = part(d.years);
  const m = part(d.months);
  return y !== null && m !== null && m <= 11;
}

/** null when both boxes are empty (nothing entered) or invalid. */
export function draftToDuration(d: DurationDraft): Duration | null {
  if (!d.years.trim() && !d.months.trim()) return null;
  if (!isValidDurationDraft(d)) return null;
  return fromParts(part(d.years)!, part(d.months)!, d.orMore);
}

/** A 'duration' draft travels through the shared string-draft plumbing as "years|months|orMore". */
export function encodeDurationDraft(value: unknown): string {
  const p = toParts(value);
  return p ? `${p.years}|${p.months || ''}|${p.orMore ? 1 : 0}` : '';
}

export function decodeDurationDraft(raw: string): DurationDraft {
  const [years = '', months = '', more = '0'] = raw.split('|');
  return { years, months, orMore: more === '1' };
}
