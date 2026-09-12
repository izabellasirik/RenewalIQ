/**
 * The broker/client-facing title for a generated application — always the account's own Named
 * Insured, never the internal template name (which can carry labeling like "... - Demo" meant only
 * for Renewal IQ's own template picker). Takes `namedInsured` as a plain string — callers already
 * have `account.namedInsured` (always present, unlike a Risk Profile field that could be missing)
 * so there's no risk of the title depending on data that hasn't been extracted yet.
 */
export function applicationTitleFor(namedInsured: string | null | undefined, fallback: string): string {
  const trimmed = namedInsured?.trim();
  return trimmed ? `${trimmed} Application` : fallback;
}
