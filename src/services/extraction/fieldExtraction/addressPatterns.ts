import { parseStateName } from '../../../utils/usStates';

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
  const m = raw.trim().match(/^(.+?),\s*([A-Za-z][A-Za-z .'-]*?),\s*([A-Za-z]{2})\.?,?\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  const [, , city, stateRaw, zip] = m;
  const state = parseStateName(stateRaw);
  if (!state) return null;
  return { city: city.trim(), state, zip: zip.trim() };
}

/**
 * The state at the end of an address: "… Chicago, IL 60601", "… Chicago IL 60601-1234",
 * "… Springfield, Illinois 62701" or "… Chicago, IL". Only where a state normally sits (right
 * before the ZIP, or last after a comma) — a word like "in" or "or" elsewhere is never read as one.
 */
export function stateFromAddress(raw: string): string | null {
  const t = raw.trim().replace(/[.\s]+$/, '');
  const beforeZip = t.match(/(?:^|[\s,])([A-Za-z]{2}|[A-Za-z]+(?: [A-Za-z]+)?)\.?,?\s+\d{5}(?:-\d{4})?(?:\s*,?\s*(?:USA|US|United States))?$/i);
  if (beforeZip) {
    const code = /^[A-Za-z]{2}$/.test(beforeZip[1]) ? parseStateName(beforeZip[1]) : null;
    const name = code ?? parseStateName(beforeZip[1]) ?? parseStateName(beforeZip[1].split(' ').pop() ?? '');
    if (name) return name;
  }
  const last = t.match(/,\s*([A-Z]{2}|[A-Za-z]+(?: [A-Za-z]+)?)(?:\s*,?\s*(?:USA|US|United States))?$/);
  if (last && (/^[A-Z]{2}$/.test(last[1]) || last[1].length > 3)) return parseStateName(last[1]);
  return null;
}
