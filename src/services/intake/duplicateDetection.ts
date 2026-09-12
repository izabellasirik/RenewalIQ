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
  /** Plain-language reason to show the broker in the confirmation dialog (e.g. "matching DOT number"). */
  reason: string;
}

/**
 * Conservative same-account detection for Re-import — never automatic deduplication, just a
 * warning before the broker creates a second account from the same intake answers. Only DOT number
 * and normalized named insured are treated as strong enough to trigger a match on their own; FEIN
 * would be checked the same way if the intake form ever collected one (it doesn't today — see
 * IntakeSubmission — so that comparison never fires yet). Contact email is deliberately NOT used as
 * a standalone signal: a shared office inbox or a broker's own address showing up as "contact" on
 * two genuinely different insureds is common enough that treating it as sufficient on its own
 * would produce false positives more often than it would catch a real duplicate.
 */
export function findLikelyDuplicateAccount(submission: IntakeSubmission, accounts: Account[], riskProfiles: Record<string, RiskProfile>): DuplicateMatch | null {
  const subDot = normalizeIdentifier(submission.dotNumber);
  const subName = normalizeName(submission.namedInsured);
  if (!subDot && !subName) return null;

  for (const account of accounts) {
    const profile = riskProfiles[account.id];
    const accountDot = profile ? normalizeIdentifier(getFieldValueByPath(profile, 'transportation.dotNumber')?.value as string | null | undefined) : '';
    if (subDot && accountDot && subDot === accountDot) {
      return { account, reason: `matching DOT number (${submission.dotNumber})` };
    }

    const accountName = normalizeName(account.namedInsured);
    if (subName && accountName && subName === accountName) {
      return { account, reason: `matching named insured ("${account.namedInsured}")` };
    }
  }

  return null;
}
