export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/** Parses a comma/"and"-separated run of 2-letter tokens into validated, deduped US state codes. */
export function parseStateList(raw: string): string[] {
  const tokens = raw
    .toUpperCase()
    .split(/,|\band\b/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const codes = tokens
    .map((t) => t.match(/^[A-Z]{2}$/)?.[0])
    .filter((t): t is string => !!t && US_STATE_CODES.has(t));
  return Array.from(new Set(codes));
}
