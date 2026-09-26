import type { Account, IntakeSubmission, RiskProfile } from '../../types';
import { getFieldValueByPath } from '../../utils/riskProfilePath';

const NAME_SUFFIXES = /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited)\b\.?/g;

/** Case/punctuation/common-suffix-insensitive so "ABC Trucking, LLC" and "abc trucking" compare equal. */
function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(NAME_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits/letters only, so "12-3456789" and "123456789" compare equal. */
function normalizeIdentifier(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface DuplicateMatch {
  account: Account;
  /** Plain-language reason for the confirmation dialog (e.g. "same DOT number, 1234567"). */
  reason: string;
}

/**
 * Conservative same-account check before importing a submission — never automatic deduplication,
 * just a warning the broker can override. Only DOT number and normalized named insured are strong
 * enough on their own; contact email isn't used (a shared office inbox shows up on genuinely
 * different insureds). Only compares against the accounts this user can see — the rest are
 * invisible to them by design (agency permissions).
 */
export function findLikelyDuplicateAccount(submission: IntakeSubmission, accounts: Account[], riskProfiles: Record<string, RiskProfile>): DuplicateMatch | null {
  const subDot = normalizeIdentifier(submission.dotNumber);
  const subName = normalizeName(submission.namedInsured);
  if (!subDot && !subName) return null;

  for (const account of accounts) {
    const profile = riskProfiles[account.id];
    const accountDot = profile ? normalizeIdentifier(getFieldValueByPath(profile, 'transportation.dotNumber')?.value as string | null | undefined) : '';
    if (subDot && accountDot && subDot === accountDot) {
      return { account, reason: `same DOT number, ${submission.dotNumber}` };
    }

    const accountName = normalizeName(account.namedInsured);
    if (subName && accountName && subName === accountName) {
      return { account, reason: 'same business name' };
    }
  }

  return null;
}
