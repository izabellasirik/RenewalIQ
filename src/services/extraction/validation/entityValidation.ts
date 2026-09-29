import type { DriverEntry, VehicleEntry } from '../../../types';
import { hasValidVinCheckDigit, isValidVin } from '../fieldExtraction/tableMappers';
import { looksLikeLabel, makeFromCode, plausibleLicenseNumber, plausibleMakeOrModel, plausiblePersonName, plausiblePlate } from '../fieldExtraction/rowValues';
import { isReadableText } from '../fieldExtraction/textQuality';
import { US_STATE_CODES } from '../../../utils/usStates';

/**
 * Whether one extracted value or row can be trusted enough to go into an account on its own.
 *
 *  - 'apply'  — validated, with enough evidence.
 *  - 'review' — possibly real but uncertain; the broker decides (never counted meanwhile).
 *  - 'reject' — not data at all (a label, a rule line, OCR noise); dropped.
 *
 * Judged on the entity as a whole — a "driver" is a person with driver evidence, a "vehicle" is
 * anchored by a VIN or by year + make + model — not on each string separately.
 */
export type Verdict = { verdict: 'apply' } | { verdict: 'review'; reason: string } | { verdict: 'reject'; reason: string };

const apply: Verdict = { verdict: 'apply' };
const review = (reason: string): Verdict => ({ verdict: 'review', reason });
const reject = (reason: string): Verdict => ({ verdict: 'reject', reason });

/** Where a row came from — how much its shape alone can be trusted. */
export interface EntityContext {
  /** 'table': a schedule's row under column headers; 'card': a license/registration/MVR read field by field (OCR or vision); 'text': found in running text. */
  origin: 'table' | 'card' | 'text';
  /** Read by OCR or from a photo — characters can be misread. */
  scanned: boolean;
  /** The document type is uncertain — only strongly anchored rows are applied. */
  uncertainDocument: boolean;
}

/** A calendar date as printed ("07/24/1985", "1985-07-24"); null for anything that isn't a real date — never rolled over or guessed. */
export function strictDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);

/** A person applying for insurance as a driver: a name, and something that says they drive. */
export function assessDriver(entry: Omit<DriverEntry, 'id' | 'source'>, ctx: EntityContext, now = new Date()): Verdict {
  const name = typeof entry.name === 'string' ? plausiblePersonName(entry.name) : null;
  const license = typeof entry.licenseNumber === 'string' ? plausibleLicenseNumber(entry.licenseNumber) : null;
  const dob = strictDate(entry.dob);
  const issued = strictDate(entry.issueDate);
  const expires = strictDate(entry.expirationDate);
  const state = typeof entry.licenseState === 'string' && US_STATE_CODES.has(entry.licenseState.toUpperCase()) ? entry.licenseState : null;
  const otherEvidence = [entry.licenseClass, entry.hireDate, entry.yearsExperience, entry.mvrReportDate].some((v) => v !== undefined && v !== null && v !== '');

  if (!name) {
    const labelled = typeof entry.name === 'string' && (looksLikeLabel(entry.name) || !isReadableText(entry.name));
    if (license && (dob || issued || expires) && !labelled) return review('A driver’s license was read, but not the driver’s name.');
    return reject(entry.name ? `“${String(entry.name).slice(0, 40)}” isn’t a person’s name.` : 'No driver name.');
  }

  // Dates that can't be right are never silently reinterpreted.
  if (entry.dob && !dob) return review(`The date of birth “${entry.dob}” isn’t a valid date.`);
  if (dob) {
    const age = yearsBetween(dob, now);
    if (age < 15 || age > 100) return review(`The date of birth ${entry.dob} gives an age of ${Math.floor(age)} — check it.`);
  }
  if (dob && issued && issued < dob) return review('The license issue date is before the date of birth.');
  if (issued && expires && expires <= issued) return review('The license expires before it was issued.');
  if (issued && issued > now) return review('The license issue date is in the future.');

  // Two readers of the same card disagreeing on who this is or on the license number.
  const conflicts = (entry as { conflicts?: Record<string, unknown> }).conflicts ?? {};
  if (conflicts.name || conflicts.licenseNumber || conflicts.dob) return review('The name, license number or date of birth was read two different ways.');
  if (entry.licenseNumber && !license) return review(`The license number “${entry.licenseNumber}” couldn’t be read confidently.`);

  const evidence = [license, dob, state, issued, expires].filter(Boolean).length + (otherEvidence ? 1 : 0);
  if (ctx.origin === 'table') {
    if (evidence === 0) return review('Possible driver name, but no license, date of birth or state with it.');
    return ctx.uncertainDocument && evidence < 2 ? review('Possible driver, but the document type is unclear.') : apply;
  }
  // A license, an MVR, a photo: the name plus the license number and a date on it.
  if (license && (dob || issued || expires)) return apply;
  if (evidence === 0) return review('Possible driver name, but no supporting driver identifiers.');
  return review('Some of the driver’s license details couldn’t be read.');
}

/** A vehicle: a VIN, or a year + make + model that read cleanly. */
export function assessVehicle(entry: Omit<VehicleEntry, 'id' | 'source'>, ctx: EntityContext, now = new Date()): Verdict {
  const vin = typeof entry.vin === 'string' && isValidVin(entry.vin) ? entry.vin.toUpperCase() : null;
  const make = typeof entry.make === 'string' ? (plausibleMakeOrModel(entry.make, 'make') ?? makeFromCode(entry.make)) : null;
  const model = typeof entry.model === 'string' ? plausibleMakeOrModel(entry.model, 'model') : null;
  const plate = typeof entry.plate === 'string' ? plausiblePlate(entry.plate) : null;
  const yearOk = typeof entry.year === 'number' && entry.year >= 1950 && entry.year <= now.getFullYear() + 1;

  if (entry.make && !make && !vin) return reject(`“${String(entry.make).slice(0, 40)}” isn’t a vehicle make.`);
  if (entry.year !== undefined && !yearOk) return review(`The model year ${entry.year} isn’t plausible.`);
  const conflicts = (entry as { conflicts?: Record<string, unknown> }).conflicts ?? {};
  if (conflicts.vin) return review('The VIN was read two different ways.');

  if (vin) {
    // A scan or a photo can misread a character; the check digit catches most of that. Typed text
    // (a spreadsheet, a PDF's own text) is taken as written.
    if (ctx.scanned && !hasValidVinCheckDigit(vin)) return review('VIN could not be read confidently (its check digit doesn’t match).');
    return apply;
  }
  if (entry.vin) return review(`The VIN “${entry.vin}” couldn’t be read confidently.`);
  if (!make && !model && !plate) return reject('Nothing identifies a vehicle.');
  if (ctx.origin === 'table' && !ctx.uncertainDocument && yearOk && make && (model || plate)) return apply;
  return review(make && yearOk ? 'No VIN — only the year and make were read.' : 'Possible vehicle, but no VIN and too few details.');
}

/** A street address: several words, a number, real letters — not a label, a fragment or noise. */
export function assessAddress(raw: string): Verdict {
  const t = raw.trim();
  if (!isReadableText(t) || looksLikeLabel(t)) return reject('Not a readable address.');
  const words = t.split(/[\s,]+/).filter(Boolean);
  if (t.length < 6 || words.length < 2 || !/\d/.test(t) || !/[A-Za-z]{3}/.test(t)) return review(`“${t.slice(0, 60)}” doesn’t look like a complete address.`);
  return apply;
}
