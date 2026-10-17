/**
 * What a vehicle or driver row's text has to look like before it's put into the account. A form
 * read as a table (a registration, a license record, a scanned receipt) puts its labels and
 * boilerplate into the columns — "Address:", "Color —— Primary Brand ——", "N COUNTRY CLUB DR" —
 * and none of that is a make, a model or a driver's name.
 */

/** Manufacturer codes printed on registrations and titles (NCIC style) → the make. */
const MAKE_CODES: Record<string, string> = {
  FRHT: 'Freightliner', FRHL: 'Freightliner', FREI: 'Freightliner', FTL: 'Freightliner', FREIGHTLINER: 'Freightliner',
  KW: 'Kenworth', KENW: 'Kenworth', KENWORTH: 'Kenworth',
  PTRB: 'Peterbilt', PETE: 'Peterbilt', PTRBLT: 'Peterbilt', PETERBILT: 'Peterbilt',
  INTL: 'International', INTERNATIONAL: 'International', NAVI: 'Navistar', NAVISTAR: 'Navistar',
  VOLV: 'Volvo', VOLVO: 'Volvo', MACK: 'Mack', WSTR: 'Western Star', WSTAR: 'Western Star',
  CHEV: 'Chevrolet', CHEVROLET: 'Chevrolet', CHEVY: 'Chevrolet', FORD: 'Ford', GMC: 'GMC', DODG: 'Dodge', DODGE: 'Dodge', RAM: 'Ram',
  ISU: 'Isuzu', ISZU: 'Isuzu', ISUZU: 'Isuzu', HINO: 'Hino', TOYT: 'Toyota', TOYOTA: 'Toyota', NISS: 'Nissan', NISSAN: 'Nissan',
  MERZ: 'Mercedes-Benz', MERCEDES: 'Mercedes-Benz', STRN: 'Sterling', STERLING: 'Sterling',
  GRDN: 'Great Dane', GDAN: 'Great Dane', WABA: 'Wabash', WBSH: 'Wabash', WABASH: 'Wabash', UTIL: 'Utility', UTILITY: 'Utility',
  HYUN: 'Hyundai', HYDI: 'Hyundai', HYUNDAI: 'Hyundai', STOU: 'Stoughton', STOUGHTON: 'Stoughton', VANG: 'Vanguard', VANGUARD: 'Vanguard',
};

/** Words a form's labels use — never a make, model or name. */
const LABEL_WORDS = /^(?:year|make|model|body|color|colour|vin|plate|title|type|use|weight|name|address|city|state|zip|jurisdiction|number|code|phone|date|issue|brand|primary|secondary|odometer|class|license|driver|information|messages?|additional|reg|registration|owner|n\/a|none|unknown)$/i;

/** A form label or rule line rather than a value: "Address:", "City/State/Zip: …", "Color ——— …". */
export function looksLikeLabel(raw: string): boolean {
  return /[A-Za-z)]\s*[:：](?:\s|$)/.test(raw) || /[—–]{2,}|-{3,}|_{3,}/.test(raw);
}

/** The make a registration's code or a schedule's make cell names, e.g. "2015 FRHT" → Freightliner. */
export function makeFromCode(raw: string): string | null {
  for (const token of raw.toUpperCase().split(/[^A-Z]+/)) {
    if (MAKE_CODES[token]) return MAKE_CODES[token];
  }
  return null;
}

/**
 * A make/model as printed: a few plain words, not a sentence, a label or an address. A make has
 * letters; a model may be a number ("579", "T680") but not a ZIP-sized one.
 */
export function plausibleMakeOrModel(raw: string, kind: 'make' | 'model'): string | null {
  const maxWords = kind === 'make' ? 3 : 4;
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 30 || looksLikeLabel(t)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&'/-]*$/.test(t)) return null;
  const words = t.split(' ');
  if (words.length > maxWords || words.every((w) => LABEL_WORDS.test(w))) return null;
  if (kind === 'make' ? !/[A-Za-z]{2}/.test(t) : !/[A-Za-z]/.test(t) && !/^\d{1,4}$/.test(t)) return null;
  return t;
}

export function plausiblePlate(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '');
  return /^(?=.*\d)[A-Z0-9-]{2,10}$/.test(t) ? t : null;
}

/** A person's name: 2–5 words of letters (initials, hyphens, apostrophes, "Last, First"), no label, no digits. */
export function plausiblePersonName(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 60 || looksLikeLabel(t) || /\d/.test(t)) return null;
  if (!/^[\p{L}][\p{L} .,'-]*$/u.test(t)) return null;
  const words = t.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5 || words.some((w) => LABEL_WORDS.test(w.replace(/\.$/, '')))) return null;
  return t;
}

/** A license number: letters/digits with at least one digit, 4–25 characters. */
export function plausibleLicenseNumber(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (looksLikeLabel(t)) return null;
  const compact = t.replace(/[\s-]/g, '');
  return /^(?=.*\d)[A-Z0-9*]{4,25}$/.test(compact) ? t : null;
}
