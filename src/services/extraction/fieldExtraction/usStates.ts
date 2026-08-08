export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/** Full state name (lowercase) -> 2-letter code, so questionnaires that spell states out still resolve. */
export const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

/** Resolves a single state reference — 2-letter code or full name — to its code, or null if unrecognized. */
export function parseStateName(raw: string): string | null {
  const trimmed = raw.trim();
  const asCode = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(asCode) && US_STATE_CODES.has(asCode)) return asCode;
  return US_STATE_NAMES[trimmed.toLowerCase()] ?? null;
}

/** Like parseStateName, but tolerates trailing content on the line ("TX (domicile)", "Texas, since 2015") by also trying just the leading token(s). */
export function parseStateFromPhrase(raw: string): string | null {
  const exact = parseStateName(raw);
  if (exact) return exact;
  const lead = raw.trim().split(/[,(]/)[0]?.trim();
  if (lead && lead !== raw.trim()) return parseStateName(lead);
  return null;
}

/** Parses a comma/"and"-separated run of state references (codes or full names) into validated, deduped codes. */
export function parseStateList(raw: string): string[] {
  const tokens = raw
    .split(/,|\band\b/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const codes = tokens.map(parseStateName).filter((t): t is string => !!t);
  return Array.from(new Set(codes));
}
