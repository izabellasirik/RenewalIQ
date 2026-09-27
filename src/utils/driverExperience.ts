import type { DriverEntry } from '../types';
import type { DurationValue } from './duration';
import { parseDateKey, todayKey } from '../services/workflow/dates';

/** Whole months from a YYYY-MM-DD date to `asOf` (a license issued Mar 15 counts a month on Apr 15). */
export function monthsSince(dateKey: string, asOf: string = todayKey()): number | null {
  const from = parseDateKey(dateKey);
  const to = parseDateKey(asOf);
  if (!from || !to || from > to) return null;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * A driver's experience as it should read today: counted from the license issue date when that's
 * where it came from (so it keeps growing), otherwise the value entered, corrected or read from a
 * document. Month-based, like the rest of the app.
 */
export function driverExperience(d: Pick<DriverEntry, 'yearsExperience' | 'experienceFromIssueDate' | 'issueDate'>, asOf?: string): DurationValue | undefined {
  if (d.experienceFromIssueDate && d.issueDate) {
    const months = monthsSince(d.issueDate, asOf);
    if (months !== null) return { months };
  }
  return d.yearsExperience;
}
