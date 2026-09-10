import type { Confidence, DriverEntry, VehicleEntry } from '../../../types';
import type { TextLine } from './textLines';
import { parseCount } from './money';
import { parseStateFromPhrase, parseStateName } from '../../../utils/usStates';
import { isValidVin } from './tableMappers';

/**
 * Card/ID-style documents (driver's licenses, vehicle registrations, insurance ID cards) are laid
 * out as short abbreviated labels next to a value ("DOB 01/15/1985", "4b EXP 03/22/2027") rather
 * than the "Label: long sentence" prose SCALAR_FIELD_PATTERNS was built for — so a license image
 * that OCRs cleanly still produced zero matches there. These patterns are the dedicated,
 * narrowly-scoped fix for that gap: run only when the document's own text reads as the relevant
 * card type (see detectDriverLicense/detectVehicleRegistration below), so they can't misfire
 * against an insurance application that happens to mention "class" or "make" in passing.
 *
 * Every value is captured as a whole whitespace-delimited token (`\S+`) and then validated as a
 * complete unit — never truncated to "the first few characters that looked plausible". A corrupted
 * OCR read like "D12345?8" fails the identifier check as a whole and the field is simply omitted,
 * rather than silently becoming "D1234568". This mirrors the "coerce returns null, never guesses a
 * replacement" rule the rest of this pattern library already follows.
 */

interface LineMatch {
  raw: string;
  line: TextLine;
}

function firstMatch(lines: TextLine[], patterns: RegExp[]): LineMatch | null {
  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.text.match(pattern);
      if (m && m[1]) return { raw: m[1], line };
    }
  }
  return null;
}

interface ValidMatch<T> {
  value: T;
  raw: string;
  line: TextLine;
}

/**
 * Like firstMatch, but keeps searching past a pattern that matched if the captured text fails
 * `validate` — an OCR artifact stray character directly after a label ("Restrictions: ~~ None",
 * confirmed against real Tesseract output) means the FIRST \S+ token isn't the real value, so
 * `patterns` should include both a plain "label: (value)" form and a "label: (garbage) (value)"
 * form that skips exactly one throwaway token; this tries every pattern against every line in
 * order and returns the first candidate that actually validates, rather than the first that merely
 * matches the regex. Never invents a value — a label with no validating candidate anywhere still
 * resolves to null, same as today.
 */
function firstValidMatch<T>(lines: TextLine[], patterns: RegExp[], validate: (raw: string) => T | null): ValidMatch<T> | null {
  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.text.match(pattern);
      if (!m || !m[1]) continue;
      const value = validate(m[1]);
      if (value !== null) return { value, raw: m[1], line };
    }
  }
  return null;
}

/** Appends a fallback pattern that tolerates exactly one throwaway token between the label and the real value (a stray OCR-artifact character glued to the label) — e.g. "Restrictions: ~~ None" where the first token after the colon is noise, not the value. */
function withSkipOneTokenFallback(primary: RegExp): RegExp[] {
  const skipOne = new RegExp(primary.source.replace(/\(\\S\+\)$/, '\\S+\\s+(\\S+)'), primary.flags);
  return [primary, skipOne];
}

/**
 * Real AAMVA-style license cards print a small field number directly against the label with no
 * gap ("1LN", "3DOB", "9CLASS") — confirmed against actual Tesseract output on a synthetic license
 * card, not assumed. A plain `\bln\b` label match never fires on "1LN" because there's no word
 * boundary between the digit and the letter, so every label pattern below tolerates an optional
 * 1-2 digit + subscript-letter prefix glued directly onto the label.
 */
const FIELD_NUM_PREFIX = '(?:^|\\s)\\d{0,2}[a-d]?';

const NAME_TOKEN = /^[A-Za-z][A-Za-z'-]*$/;
const DATE_TOKEN = /^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const ID_TOKEN = /^[A-Z0-9-]{5,17}$/;
const CLASS_TOKEN = /^(?:CDL[-\s]?)?[A-Z]{1,2}[0-9]?$/;

function normalizeDate(raw: string): string | null {
  const t = raw.trim().replace(/[.,;]+$/, '');
  return DATE_TOKEN.test(t) ? t : null;
}

function normalizeIdToken(raw: string): string | null {
  const t = raw.trim().replace(/[.,;]+$/, '').toUpperCase();
  return ID_TOKEN.test(t) ? t : null;
}

function normalizeClassToken(raw: string): string | null {
  const t = raw.trim().replace(/[.,;]+$/, '').toUpperCase();
  return CLASS_TOKEN.test(t) ? t : null;
}

function normalizeNamePart(raw: string): string | null {
  const t = raw.trim().replace(/[.,;]+$/, '');
  if (!NAME_TOKEN.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function normalizePlainName(raw: string): string | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0 || parts.length > 4) return null;
  const normalized = parts.map(normalizeNamePart);
  if (normalized.some((p) => !p)) return null;
  return normalized.join(' ');
}

// ---------------------------------------------------------------------------
// Driver's license
// ---------------------------------------------------------------------------

/**
 * True when the document's own text reads as a driver's license/CDL — either an explicit mention,
 * or at least three of the abbreviated field labels a license card always carries together. A
 * document that only mentions one of these in passing (e.g. an application asking for "class of
 * vehicle") won't hit the threshold, so this can't misfire against ordinary insurance documents.
 */
export function detectDriverLicense(text: string): boolean {
  const t = text.toLowerCase();
  if (/driver'?s?\s+licen[cs]e/.test(t) || /\bcommercial\s+driver'?s?\s+licen[cs]e\b/.test(t) || /\bcdl\b/.test(t)) return true;
  let signals = 0;
  if (/\bdob\b/.test(t)) signals++;
  if (/\bclass\b/.test(t)) signals++;
  if (/\b(?:dl|lic)\s*#/.test(t) || /license\s*(?:no\.?|number)/.test(t)) signals++;
  if (/\bexp\b/.test(t)) signals++;
  if (/\biss\b/.test(t)) signals++;
  if (/\brestr/.test(t)) signals++;
  return signals >= 3;
}

export interface DriverLicenseExtraction {
  entry: Omit<DriverEntry, 'id' | 'source'>;
  matchedText: string;
  /** How many license fields had a label match at all, whether or not the value passed validation — for debug/telemetry only, never logged with the actual values. */
  fieldsAttempted: number;
}

export function extractDriverLicenseFields(lines: TextLine[], fullText: string): DriverLicenseExtraction | null {
  if (!detectDriverLicense(fullText)) return null;

  const entry: Omit<DriverEntry, 'id' | 'source'> = {};
  const fieldConfidence: Partial<Record<string, Confidence>> = {};
  const excerpts: string[] = [];
  let attempted = 0;

  const ln = firstMatch(lines, [new RegExp(`${FIELD_NUM_PREFIX}ln\\b\\s*:?\\s*(\\S+)`, 'i')]);
  const fn = firstMatch(lines, [new RegExp(`${FIELD_NUM_PREFIX}fn\\b\\s*:?\\s*(\\S+)`, 'i')]);
  if (ln || fn) attempted++;
  if (ln && fn) {
    const lnNorm = normalizeNamePart(ln.raw);
    const fnNorm = normalizeNamePart(fn.raw);
    if (lnNorm && fnNorm) {
      entry.name = `${fnNorm} ${lnNorm}`;
      fieldConfidence.name = 'medium';
      excerpts.push(ln.line.text, fn.line.text);
    }
  }
  if (!entry.name) {
    const plain = firstMatch(lines, [/^(?:full\s*)?name\s*:?\s*(.+)$/i]);
    if (plain) {
      attempted++;
      const norm = normalizePlainName(plain.raw);
      if (norm) {
        entry.name = norm;
        fieldConfidence.name = 'medium';
        excerpts.push(plain.line.text);
      }
    }
  }

  // The driver's own street address — distinct from, and never merged into, the applicant
  // business's address. Free text (no fixed token shape to validate against), so it's only
  // accepted if it looks address-like (contains a digit, within a sane length) rather than
  // capturing an unrelated sentence.
  const address = firstMatch(lines, [/^address\s*:?\s*(.+)$/i]);
  if (address) {
    attempted++;
    const raw = address.raw.trim().replace(/[.,;]+$/, '');
    if (raw.length >= 5 && raw.length <= 120 && /\d/.test(raw)) {
      entry.address = raw;
      fieldConfidence.address = 'medium';
      excerpts.push(address.line.text);
    }
  }

  const dob = firstValidMatch(
    lines,
    [...withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}dob\\b\\s*:?\\s*(\\S+)`, 'i')), /\bdate\s+of\s+birth\s*:?\s*(\S+)/i],
    normalizeDate
  );
  if (dob) {
    attempted++;
    entry.dob = dob.value;
    fieldConfidence.dob = 'medium';
    excerpts.push(dob.line.text);
  }

  const lic = firstValidMatch(
    lines,
    [
      ...withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}(?:dl|lic(?:ense)?)\\s*#\\s*:?\\s*(\\S+)`, 'i')),
      /\blicense\s*(?:no\.?|number)\s*:?\s*(\S+)/i,
      // Real OCR can split "License number:" from its value onto separate lines, leaving a line
      // that just reads "License 123456789" with no "number"/"no" token at all — confirmed against
      // actual Tesseract output on a synthetic Tennessee license, not assumed. Scoped to this
      // extractor (only runs on a document already detected as a license) so it can't misfire
      // elsewhere.
      /\blicense\b.{0,15}?(\d{5,15})\b/i,
    ],
    normalizeIdToken
  );
  if (lic) {
    attempted++;
    entry.licenseNumber = lic.value;
    fieldConfidence.licenseNumber = 'medium';
    excerpts.push(lic.line.text);
  }

  const stateHeader = firstMatch(lines, [
    /^([A-Za-z][A-Za-z ]+?)\s+driver'?s?\s+licen[cs]e/i,
    /state\s+of\s+(.+)$/i,
    /^licen[cs]e\s+state\s*:?\s*(\S+)/i,
    // A plain "State: Tennessee" line (no "license" qualifier) — the most common real-world
    // phrasing on a license, confirmed against actual OCR output. Deliberately the last, loosest
    // pattern tried, and only reached inside this license-specific extractor.
    /^state\s*:?\s*(.+)$/i,
  ]);
  if (stateHeader) {
    attempted++;
    const code = parseStateFromPhrase(stateHeader.raw);
    if (code) {
      entry.licenseState = code;
      fieldConfidence.licenseState = 'medium';
      excerpts.push(stateHeader.line.text);
    }
  }

  const cls = firstValidMatch(lines, withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}class\\b\\s*:?\\s*(\\S+)`, 'i')), normalizeClassToken);
  if (cls) {
    attempted++;
    entry.licenseClass = cls.value;
    fieldConfidence.licenseClass = 'medium';
    excerpts.push(cls.line.text);
  }
  if (/\bcommercial\s+driver'?s?\s+licen[cs]e\b/i.test(fullText) || /\bcdl\b/i.test(fullText) || (entry.licenseClass && /^[AB]$/i.test(entry.licenseClass))) {
    entry.isCDL = true;
  }

  const iss = firstValidMatch(
    lines,
    withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}iss(?:ue)?(?:\\s*date)?\\b\\s*:?\\s*(\\S+)`, 'i')),
    normalizeDate
  );
  if (iss) {
    attempted++;
    entry.issueDate = iss.value;
    fieldConfidence.issueDate = 'medium';
    excerpts.push(iss.line.text);
  }

  // "exp(?:ir(?:es?|ation))?" covers "Exp", "Expire(s)" and "Expiration" — the latter is at least
  // as common a real-world label as "Exp", and a prior version of this pattern only matched the
  // first two, which was confirmed (against real OCR output on a synthetic Tennessee license using
  // "Expiration:") to silently drop the expiration date entirely.
  const exp = firstValidMatch(
    lines,
    withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}exp(?:ir(?:es?|ation))?(?:\\s*date)?\\b\\s*:?\\s*(\\S+)`, 'i')),
    normalizeDate
  );
  if (exp) {
    attempted++;
    entry.expirationDate = exp.value;
    fieldConfidence.expirationDate = 'medium';
    excerpts.push(exp.line.text);
  }

  // restrictions/endorsements have no fixed format to validate against (unlike a date or an
  // identifier), so even a clean-looking match is a shakier read than the fields above — tagged
  // 'low' rather than 'medium' so a broker knows to double-check these two specifically.
  const validateFreeToken = (raw: string): string | null => {
    const t = raw.trim().replace(/[.,;]+$/, '');
    return /^[A-Za-z0-9]+$/.test(t) ? t.toUpperCase() : null;
  };

  const restr = firstValidMatch(lines, withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}restr(?:ictions?)?\\b\\s*:?\\s*(\\S+)`, 'i')), validateFreeToken);
  if (restr) {
    attempted++;
    entry.restrictions = restr.value;
    fieldConfidence.restrictions = 'low';
    excerpts.push(restr.line.text);
  }

  const endo = firstValidMatch(lines, withSkipOneTokenFallback(new RegExp(`${FIELD_NUM_PREFIX}end(?:orsements?)?\\b\\s*:?\\s*(\\S+)`, 'i')), validateFreeToken);
  if (endo) {
    attempted++;
    entry.endorsements = endo.value;
    fieldConfidence.endorsements = 'low';
    excerpts.push(endo.line.text);
  }

  const populatedFields = Object.keys(entry).filter((k) => k !== 'isCDL').length;
  if (populatedFields === 0) return null;

  entry.fieldConfidence = fieldConfidence;
  return { entry, matchedText: excerpts.slice(0, 3).join(' | ') || 'Driver license fields', fieldsAttempted: attempted };
}

// ---------------------------------------------------------------------------
// Vehicle registration
// ---------------------------------------------------------------------------

export function detectVehicleRegistration(text: string): boolean {
  const t = text.toLowerCase();
  if (/vehicle\s+registration/.test(t) || /certificate\s+of\s+registration/.test(t) || /registration\s+card/.test(t)) return true;
  let signals = 0;
  if (/\bvin\b/.test(t)) signals++;
  if (/\bplate\b/.test(t)) signals++;
  if (/\bmake\b/.test(t) && /\bmodel\b/.test(t)) signals++;
  if (/\bregistration\b/.test(t)) signals++;
  return signals >= 3;
}

export interface VehicleRegistrationExtraction {
  entry: Omit<VehicleEntry, 'id' | 'source'>;
  matchedText: string;
  fieldsAttempted: number;
}

export function extractVehicleRegistrationFields(lines: TextLine[], fullText: string): VehicleRegistrationExtraction | null {
  if (!detectVehicleRegistration(fullText)) return null;

  const entry: Omit<VehicleEntry, 'id' | 'source'> = {};
  const excerpts: string[] = [];
  let attempted = 0;

  const vin = firstMatch(lines, [/\bvin\s*:?\s*(\S{11,17})/i, /\bvehicle\s+identification\s+number\s*:?\s*(\S{11,17})/i]);
  if (vin) {
    attempted++;
    const t = vin.raw.trim().toUpperCase();
    if (isValidVin(t)) {
      entry.vin = t;
      excerpts.push(vin.line.text);
    }
  }

  const year = firstMatch(lines, [/\byear\s*:?\s*(\d{4})/i, /\bmodel\s+year\s*:?\s*(\d{4})/i]);
  if (year) {
    attempted++;
    const n = parseCount(year.raw);
    if (n !== null && n >= 1980 && n <= new Date().getFullYear() + 1) {
      entry.year = n;
      excerpts.push(year.line.text);
    }
  }

  const make = firstMatch(lines, [/\bmake\s*:?\s*(\S+)/i]);
  if (make) {
    attempted++;
    const t = make.raw.trim().replace(/[.,;]+$/, '');
    if (/^[A-Za-z][A-Za-z-]*$/.test(t)) {
      entry.make = t.toUpperCase();
      excerpts.push(make.line.text);
    }
  }

  const model = firstMatch(lines, [/\bmodel\s*:?\s*(\S+)/i]);
  if (model) {
    attempted++;
    const t = model.raw.trim().replace(/[.,;]+$/, '');
    if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t)) {
      entry.model = t.toUpperCase();
      excerpts.push(model.line.text);
    }
  }

  const plate = firstMatch(lines, [/\blicense\s*plate\s*(?:no\.?|number|#)?\s*:?\s*(\S+)/i, /\bplate\s*(?:no\.?|number|#)?\s*:?\s*(\S+)/i]);
  if (plate) {
    attempted++;
    const t = plate.raw.trim().replace(/[.,;]+$/, '').toUpperCase();
    if (/^[A-Z0-9-]{2,10}$/.test(t)) {
      entry.plate = t;
      excerpts.push(plate.line.text);
    }
  }

  if (Object.keys(entry).length === 0) return null;
  return { entry, matchedText: excerpts.slice(0, 3).join(' | ') || 'Vehicle registration fields', fieldsAttempted: attempted };
}

// ---------------------------------------------------------------------------
// Insurance ID card (classification only — content is already covered by the
// existing namedInsured/coverage-limit patterns, which read compact card/dec-page
// lines like "General Liability   $1,000,000" via extractCurrentPolicyCoverageLines)
// ---------------------------------------------------------------------------

export function detectInsuranceIdCard(text: string): boolean {
  const t = text.toLowerCase();
  if (detectDeclarationsPage(t)) return false;
  if (/insurance\s+(?:id\s+card|identification\s+card)/.test(t) || /proof\s+of\s+insurance/.test(t)) return true;
  return /policy\s*(?:no\.?|number)/.test(t) && /(?:insured|coverage|effective)/.test(t);
}

/** A full declarations page (coverage-limit schedule under a named insured/policy) rather than a wallet-sized proof-of-insurance card — same underlying content, but the source has explicitly identified itself as a "declarations" document. */
export function detectDeclarationsPage(text: string): boolean {
  return /\bdeclarations?\b|\bdec\s*page\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Generic fallback: a bare "Company Name LLC" or "City, ST" line with no label at
// all. Only ever used to fill a field nothing more specific already matched, and
// only at low confidence — this is what lets a screenshot or an unrecognized
// document still yield real fields instead of zero, per the product requirement
// that "Other document type" must not automatically mean "extract nothing".
// ---------------------------------------------------------------------------

const BUSINESS_SUFFIX_LINE =
  /^([A-Z][A-Za-z0-9&,.'\- ]{2,60}\b(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|LLP|LP|Trucking|Transportation|Transport|Freight|Logistics))\.?\s*$/;

export function findGenericBusinessName(lines: TextLine[]): LineMatch | null {
  return firstMatch(
    lines,
    [BUSINESS_SUFFIX_LINE]
  );
}

const CITY_STATE_LINE = /^([A-Z][A-Za-z.\- ]{1,40}?),?\s+([A-Z]{2})\s*\d{0,5}$/;

export interface CityStateMatch {
  city: string;
  state: string;
  line: TextLine;
}

export function findGenericCityState(lines: TextLine[]): CityStateMatch | null {
  for (const line of lines) {
    const t = line.text.trim();
    const m = t.match(CITY_STATE_LINE);
    if (!m) continue;
    const [, cityRaw, stateRaw] = m;
    if (!parseStateName(stateRaw)) continue;
    const city = cityRaw.trim().replace(/[.,]+$/, '');
    if (!city || city.length < 2 || city.split(/\s+/).length > 3) continue;
    return { city, state: stateRaw.toUpperCase(), line };
  }
  return null;
}
