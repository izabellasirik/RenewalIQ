import { parseAddressComponents, stateFromAddress } from '../services/extraction/fieldExtraction/addressPatterns';

interface AddressParts {
  address: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  zip: string | null | undefined;
}

/** One line: line breaks (a multi-line address off a document) become ", ", repeated commas/spaces collapse. */
export function singleLineAddress(v: string | null | undefined): string {
  if (typeof v !== 'string') return '';
  return v
    .split(/\s*[\r\n]+\s*/)
    .map((part) => part.replace(/^[\s,]+|[\s,]+$/g, ''))
    .filter(Boolean)
    .join(', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',');
}

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * The Risk Profile shows one Address field (full address, city, state, ZIP). Older accounts may hold
 * the street alone with city/state/ZIP stored separately — those pieces are appended for display,
 * only when the address doesn't already contain them. Nothing is invented.
 */
export function composeFullAddress(p: AddressParts): string {
  const address = singleLineAddress(p.address);
  const city = clean(p.city);
  const state = clean(p.state);
  const zip = clean(p.zip);
  const has = (piece: string) => !piece || new RegExp(`(^|[\\s,])${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,.])`, 'i').test(address);
  if (has(city) && has(state) && has(zip)) return address;
  const tail = [city && !has(city) ? city : '', [state && !has(state) ? state : '', zip && !has(zip) ? zip : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address, tail].filter(Boolean).join(', ');
}

/**
 * City/state/ZIP read off a full address the broker typed, so the fields other features rely on
 * (State drives carrier appetite; the application prints City/State/ZIP) stay in step. Only what the
 * address clearly states is returned — an ambiguous address changes nothing.
 */
export function addressComponentsFrom(full: string): { city?: string; state?: string; zip?: string } {
  const parsed = parseAddressComponents(full);
  if (parsed) return parsed;
  const state = stateFromAddress(full);
  return state ? { state } : {};
}
