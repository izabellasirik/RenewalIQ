export interface AddressComponents {
  city: string;
  state: string;
  zip: string;
}

/**
 * Splits a "Street, City, ST 12345" address line into components. Returns null for anything that
 * doesn't match that exact shape — a partial/ambiguous address is left alone rather than guessing
 * which comma-separated segment is the city.
 */
export function parseAddressComponents(raw: string): AddressComponents | null {
  const m = raw.trim().match(/^(.+?),\s*([A-Za-z][A-Za-z .'-]*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  const [, , city, state, zip] = m;
  return { city: city.trim(), state: state.trim().toUpperCase(), zip: zip.trim() };
}
