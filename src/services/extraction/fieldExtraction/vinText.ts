import type { VehicleEntry } from '../../../types';
import type { TextLine } from './textLines';
import { hasValidVinCheckDigit, normalizeVin } from './tableMappers';

/** Truck, trailer and light-vehicle makes as printed on schedules and declarations pages. */
const MAKES = [
  'Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'Mack', 'International', 'Western Star', 'Navistar', 'Ford', 'Chevrolet', 'Chevy', 'GMC', 'Ram', 'Dodge',
  'Isuzu', 'Hino', 'Toyota', 'Nissan', 'Mercedes-Benz', 'Mercedes', 'Sprinter', 'Utility', 'Great Dane', 'Wabash', 'Hyundai Translead', 'Hyundai', 'Stoughton',
  'Vanguard', 'Fontaine', 'Wilson', 'Trail King', 'Dorsey', 'Manac', 'Reitnouer', 'Timpte', 'Transcraft', 'Strick', 'Pines', 'Kentucky', 'Mac Trailer',
];
const MAKE_RE = new RegExp(`\\b(${MAKES.map((m) => m.replace(/[-]/g, '[- ]?')).join('|')})\\b\\s*([A-Z0-9][A-Za-z0-9-]{1,14})?`, 'i');
const CANDIDATE_RE = /\b[A-Z0-9]{17}\b/gi;

export interface TextVehicle {
  entry: Omit<VehicleEntry, 'id' | 'source'>;
  line: TextLine;
}

/**
 * VINs printed outside a table (declarations pages, emails, questionnaires), with the year, make
 * and model printed on the same line. A 17-character token is taken as a VIN only when the line
 * labels it ("VIN", "Serial") or its check digit is valid — never a random 17-character code.
 */
export function extractVehiclesFromText(lines: TextLine[], skipVins: Set<string>): TextVehicle[] {
  const out: TextVehicle[] = [];
  const seen = new Set(skipVins);
  for (const line of lines) {
    const labeled = /\bvin\b|\bserial\b|\bv\.?i\.?n\.?\s*#/i.test(line.text);
    for (const m of line.text.matchAll(CANDIDATE_RE)) {
      const vin = normalizeVin(m[0]);
      if (!vin || seen.has(vin) || (vin.match(/\d/g) ?? []).length < 4) continue;
      if (!labeled && !hasValidVinCheckDigit(vin)) continue;
      seen.add(vin);
      const rest = line.text.replace(m[0], ' ');
      const entry: Omit<VehicleEntry, 'id' | 'source'> = { vin };
      const year = rest.match(/\b(19[89]\d|20[0-4]\d)\b/);
      if (year) entry.year = Number(year[1]);
      const make = rest.match(MAKE_RE);
      if (make) {
        entry.make = make[1].replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/^([A-Z])([A-Z]+)$/, (_, a, b) => a + b.toLowerCase());
        if (make[2] && !/^(?:vin|serial|value|stated|year)$/i.test(make[2]) && !/^(19|20)\d\d$/.test(make[2])) entry.model = make[2];
      }
      out.push({ entry, line });
    }
  }
  return out;
}
