import type { DriverEntry } from '../types';
import type { DurationValue } from './duration';
import { parseDateKey, todayKey, normalizeDateKey } from '../services/workflow/dates';

/** Whole months from a YYYY-MM-DD date to `asOf` (a license issued Mar 15 counts a month on Apr 15). */
export function monthsSince(dateKey: string, asOf: string = todayKey()): number | null {
  const from = parseDateKey(dateKey);
  const to = parseDateKey(asOf);
  if (!from || !to || from > to) return null;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/** A real calendar date as YYYY-MM-DD ("07/13/2013" or "2013-07-13"); null for anything else — never rolled over. */
function strictDateKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const [y, m, d] = us ? [+us[3], +us[1], +us[2]] : iso ? [+iso[1], +iso[2], +iso[3]] : [NaN, NaN, NaN];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return normalizeDateKey(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

/**
 * The original CDL issue date as a trustworthy YYYY-MM-DD, or null when it's missing or can't be
 * right: not a real date, in the future, before the driver was 18 (the federal CDL minimum), or
 * read two different ways. Null means experience shows "—" — never a guess.
 */
export function usableCdlIssueDate(d: Pick<DriverEntry, 'cdlOriginalIssueDate' | 'dob' | 'conflicts'>, asOf: string = todayKey()): string | null {
  const key = strictDateKey(d.cdlOriginalIssueDate);
  if (!key || key > asOf) return null;
  if (d.conflicts?.cdlOriginalIssueDate) return null;
  const dob = strictDateKey(d.dob);
  if (dob) {
    const [y, m, day] = dob.split('-');
    if (key < `${Number(y) + 18}-${m}-${day}`) return null;
  }
  return key;
}

export type ExperienceBasis = 'cdl' | 'stated' | 'manual';

/**
 * A driver's experience as it reads today, and what it rests on:
 *
 *  - 'manual' — the broker corrected it by hand;
 *  - 'cdl'    — counted from the original CDL issue date to today (keeps growing);
 *  - 'stated' — a figure a document or the broker gave outright ("Years Experience: 15").
 *
 * Undefined — shown as "—" — when none of those is known. Never counted from the date of birth or
 * the current license's issue/renewal date.
 */
export function driverExperienceWithBasis(
  d: Pick<DriverEntry, 'yearsExperience' | 'experienceFromIssueDate' | 'experienceManual' | 'cdlOriginalIssueDate' | 'dob' | 'conflicts'>,
  asOf?: string
): { value: DurationValue; basis: ExperienceBasis } | undefined {
  if (d.experienceManual && d.yearsExperience !== undefined) return { value: d.yearsExperience, basis: 'manual' };
  const cdl = usableCdlIssueDate(d, asOf);
  if (cdl) {
    const months = monthsSince(cdl, asOf);
    if (months !== null) return { value: { months }, basis: 'cdl' };
  }
  // A figure counted from the current license's issue date (the old behavior) was a renewal date, not experience.
  if (!d.experienceFromIssueDate && d.yearsExperience !== undefined) return { value: d.yearsExperience, basis: 'stated' };
  return undefined;
}

export function driverExperience(d: Parameters<typeof driverExperienceWithBasis>[0], asOf?: string): DurationValue | undefined {
  return driverExperienceWithBasis(d, asOf)?.value;
}
