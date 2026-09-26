/**
 * Follow-up dates are plain local calendar dates (YYYY-MM-DD) rather than timestamps — "follow up
 * Sep 25" means Sep 25 wherever the broker is, and string comparison orders them correctly.
 */

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toLocalDateKey(new Date());
}

/** Adds business days (skips Sat/Sun) — the default follow-up cadence for a client or carrier request. */
export function addBusinessDays(from: Date, days: number): string {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return toLocalDateKey(d);
}

export function addDays(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey) ?? new Date();
  d.setDate(d.getDate() + days);
  return toLocalDateKey(d);
}

/** Parses a YYYY-MM-DD key (or an ISO timestamp) as a local date; null if unparseable. */
export function parseDateKey(value: string | undefined | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalizes anything date-like (an ISO timestamp, a YYYY-MM-DD key, "09/25/2026") to a YYYY-MM-DD key, or null. */
export function normalizeDateKey(value: string | undefined | null): string | null {
  if (!value) return null;
  const direct = parseDateKey(value);
  if (direct) return toLocalDateKey(direct);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value.trim());
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return toLocalDateKey(new Date(year, Number(us[1]) - 1, Number(us[2])));
  }
  return null;
}

/** "Sep 25" (adds the year only when it isn't the current one). */
export function formatShortDate(value: string | undefined | null): string {
  const d = parseDateKey(value);
  if (!d) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** "due today" / "3 days overdue" / "due in 2 days" / "due Sep 25". */
export function describeDue(dateKey: string, today = todayKey()): string {
  const diff = daysBetween(today, dateKey);
  if (diff === 0) return 'Follow-up due today';
  if (diff < 0) return `Follow-up ${-diff} day${diff === -1 ? '' : 's'} overdue`;
  if (diff === 1) return 'Follow-up due tomorrow';
  return `Follow-up ${formatShortDate(dateKey)}`;
}
