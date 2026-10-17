import { normalizeCurrencyText } from '../../../utils/currency';
import type { CoverageType, DriverEntry, LossStatus, VehicleEntry } from '../../../types';
import type { RawTable } from '../../ingestion';
import { parseCount, parseMoney } from './money';
import { COVERAGE_TYPE_ALIASES } from './coveragePatterns';
import { normalizeVehicleBodyType } from './vehicleBodyType';
import { normalizeDateKey } from '../../workflow/dates';
import { isReadableText } from './textQuality';
import { makeFromCode, plausibleLicenseNumber, plausibleMakeOrModel, plausiblePersonName, plausiblePlate } from './rowValues';

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Standard US VIN format: 17 characters, alphanumeric excluding I/O/Q (never confused with 1/0). A VIN column value that doesn't match this is dropped rather than accepted as-is — never guessed or reformatted. */
export function isValidVin(raw: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(raw.trim());
}

/**
 * A VIN as printed or scanned: spaces/dashes removed, upper case, and the letters a VIN never
 * contains read as the digits they're confused with (I→1, O→0, Q→0). Null unless the result is
 * VIN-shaped.
 */
export function normalizeVin(raw: string): string | null {
  const t = raw.toUpperCase().replace(/[\s-]/g, '').replace(/[IO]/g, (c) => (c === 'I' ? '1' : '0')).replace(/Q/g, '0');
  return isValidVin(t) ? t : null;
}

/** The VIN check digit (position 9) — true for every North American VIN since 1981. */
export function hasValidVinCheckDigit(vin: string): boolean {
  const map: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const v = vin.toUpperCase();
  if (!isValidVin(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    sum += (/\d/.test(c) ? Number(c) : map[c]) * weights[i];
  }
  const check = sum % 11;
  return v[8] === (check === 10 ? 'X' : String(check));
}

/** "$18,450.00", "(1,200)" (a recovery), "18450" → number; null if it isn't an amount. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === '-' || t === '—') return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = parseMoney(t.replace(/[()\-\s]/g, ''));
  return n === null ? null : negative ? -n : n;
}

interface ColumnSpec {
  /** Tried as whole headers first, then as whole words inside a header, in order. */
  synonyms: string[];
  /** Only ever a whole header — short words that would match unrelated headers as a part ("state", "type"). */
  exact?: string[];
  /** A header matching this is never this column ("License State" is not the license number). */
  exclude?: RegExp;
}

/** Levenshtein distance, stopping early once it's over `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function findColumn(headers: string[], spec: ColumnSpec, taken: number[] = []): number {
  const normalized = headers.map(normalizeHeader);
  const compact = normalized.map((h) => h.replace(/ /g, ''));
  const ok = (i: number) => !taken.includes(i) && !(spec.exclude && (spec.exclude.test(normalized[i]) || spec.exclude.test(compact[i])));
  for (const syn of [...spec.synonyms, ...(spec.exact ?? [])]) {
    const i = normalized.findIndex((h, k) => h === syn && ok(k));
    if (i !== -1) return i;
  }
  for (const syn of spec.synonyms) {
    const re = new RegExp(`(?:^| )${syn}(?: |$)`);
    const i = normalized.findIndex((h, k) => re.test(h) && ok(k));
    if (i !== -1) return i;
  }
  // Scanned headers: words run together ("DriverName") or a letter misread ("Dale of Hire").
  for (const syn of spec.synonyms) {
    const target = syn.replace(/ /g, '');
    if (target.length < 5) continue;
    const allowed = target.length >= 10 ? 2 : 1;
    const i = compact.findIndex((h, k) => ok(k) && (h === target || editDistance(h, target, allowed) <= allowed));
    if (i !== -1) return i;
  }
  return -1;
}

const VEHICLE_COLS = {
  vin: { synonyms: ['vin', 'vin number', 'vin no', 'vehicle identification number', 'vehicle id number', 'serial number', 'serial no', 'serial'] },
  year: { synonyms: ['year', 'model year', 'vehicle year', 'yr'], exclude: /years|purchase|hire/ },
  make: { synonyms: ['make', 'manufacturer', 'mfr', 'mfg'] },
  model: { synonyms: ['model'], exclude: /model year/ },
  value: { synonyms: ['stated value', 'stated amount', 'vehicle value', 'insured value', 'actual cash value', 'acv', 'cost new', 'value', 'amount'], exclude: /date|year/ },
  bodyType: { synonyms: ['vehicle type', 'body type', 'unit type', 'equipment type', 'body style', 'body'], exact: ['type', 'class', 'description'] },
  plate: { synonyms: ['license plate', 'plate number', 'plate no', 'plate', 'tag number', 'tag no', 'tag'] },
} satisfies Record<string, ColumnSpec>;

const DRIVER_COLS = {
  name: { synonyms: ['driver name', 'employee name', 'operator name', 'full name', 'name'], exact: ['driver', 'drivers', 'operator', 'employee'], exclude: /first|last|business|company|insured/ },
  firstName: { synonyms: ['first name', 'given name', 'fname'], exact: ['first'] },
  lastName: { synonyms: ['last name', 'surname', 'family name', 'lname'], exact: ['last'] },
  dob: { synonyms: ['dob', 'date of birth', 'birth date', 'birthdate', 'd o b', 'birthday'] },
  licenseState: { synonyms: ['license state', 'lic state', 'cdl state', 'dl state', 'state of license', 'licensing state', 'issuing state', 'license st', 'lic st'], exact: ['state', 'st'] },
  licenseNumber: {
    synonyms: ['license number', 'license no', 'lic number', 'lic no', 'dl number', 'dl no', 'cdl number', 'cdl no', 'drivers license number', 'driver license number', 'drivers license', 'driver license', 'license', 'cdl', 'dl', 'lic'],
    exclude: /state|class|exp|issue|endorse|restrict|type|date|years|yrs|st$/,
  },
  licenseClass: { synonyms: ['license class', 'lic class', 'cdl class', 'dl class', 'class'] },
  issueDate: { synonyms: ['issue date', 'date issued', 'license issue date', 'issued'], exclude: /cdl|commercial|original|orig|first/ },
  cdlOriginalIssueDate: {
    synonyms: ['original cdl issue date', 'cdl original issue date', 'cdl orig issue date', 'original cdl date', 'cdl issue date', 'cdl issued', 'cdl date', 'cdl since', 'date cdl issued', 'date first cdl', 'first cdl date', 'commercial license issue date', 'commercial license original issue date'],
  },
  expirationDate: { synonyms: ['expiration date', 'expiry date', 'exp date', 'license expiration', 'expiration', 'expires'], exact: ['exp'] },
  hireDate: { synonyms: ['date of hire', 'hire date', 'date hired', 'hired', 'employment date', 'start date'] },
  yearsExperience: {
    synonyms: ['years experience', 'years of experience', 'yrs experience', 'yrs exp', 'years exp', 'years driving', 'yrs driving', 'driving experience', 'cdl experience', 'experience', 'yoe'],
  },
  violations: { synonyms: ['violations', 'mvr violations', 'violation history', 'violation', 'accidents violations', 'incidents', 'tickets'], exclude: /date/ },
  mvrReportDate: { synonyms: ['mvr date', 'mvr report date', 'mvr run date', 'mvr ordered'] },
  address: { synonyms: ['driver address', 'home address', 'address'] },
  restrictions: { synonyms: ['restrictions', 'license restrictions'] },
  endorsements: { synonyms: ['endorsements', 'license endorsements'] },
} satisfies Record<string, ColumnSpec>;

const LOSS_COLS = {
  lossDate: { synonyms: ['date of loss', 'loss date', 'accident date', 'date of accident', 'dol', 'occurrence date', 'date of occurrence', 'incident date', 'event date'] },
  anyDate: { synonyms: ['date'], exclude: /report|close|open|enter|hire|birth|valu|print|run|paid/ },
  claimNumber: { synonyms: ['claim number', 'claim no', 'claim id', 'claim ref', 'file number', 'file no', 'claim'], exclude: /type|status|date|count|amount|paid|reserve|incurred|description/ },
  description: { synonyms: ['loss description', 'accident description', 'claim description', 'description', 'desc', 'cause of loss', 'narrative', 'remarks'] },
  claimType: { synonyms: ['claim type', 'type of loss', 'loss type', 'coverage type', 'coverage', 'cov', 'line', 'peril', 'cause'], exact: ['type'], exclude: /description|date|paid|reserve|incurred/ },
  paid: { synonyms: ['total paid', 'total net paid', 'paid to date', 'loss paid', 'paid loss', 'net paid', 'amount paid', 'paid amount', 'paid'], exclude: /expense|alae|date/ },
  reserved: { synonyms: ['total reserve', 'total reserves', 'outstanding reserve', 'case reserve', 'open reserve', 'os reserve', 'outstanding', 'reserves', 'reserve', 'reserved', 'o s'], exclude: /expense|alae/ },
  incurred: { synonyms: ['total incurred', 'total incurred loss', 'incurred loss', 'net incurred', 'gross incurred', 'incurred'], exact: ['total'], exclude: /expense|alae/ },
  status: { synonyms: ['claim status', 'status', 'open closed', 'o c'] },
} satisfies Record<string, ColumnSpec>;

const COVERAGE_COLS = {
  coverageType: { synonyms: ['coverage type', 'coverage', 'line of business', 'line'] },
  requestedLimit: { synonyms: ['requested limit', 'limit requested', 'limit'] },
} satisfies Record<string, ColumnSpec>;

export type TableKind = 'vehicles' | 'drivers' | 'losses' | 'coverage' | 'unrecognized';

function lossDateColumn(headers: string[]): number {
  const specific = findColumn(headers, LOSS_COLS.lossDate);
  return specific !== -1 ? specific : findColumn(headers, LOSS_COLS.anyDate);
}

function driverNameColumns(headers: string[]): { name: number; first: number; last: number } {
  return { name: findColumn(headers, DRIVER_COLS.name), first: findColumn(headers, DRIVER_COLS.firstName), last: findColumn(headers, DRIVER_COLS.lastName) };
}

/** Classifies a table by its headers so we never guess a mapping for a shape we don't recognize. */
export function classifyTable(headers: string[]): TableKind {
  const has = (spec: ColumnSpec) => findColumn(headers, spec) !== -1;
  const money = has(LOSS_COLS.paid) || has(LOSS_COLS.incurred) || has(LOSS_COLS.reserved);
  if ((has(LOSS_COLS.lossDate) && money) || (lossDateColumn(headers) !== -1 && (has(LOSS_COLS.paid) || findColumn(headers, { synonyms: ['incurred', 'total incurred'] }) !== -1))) return 'losses';
  if (has(VEHICLE_COLS.vin) || (has(VEHICLE_COLS.year) && has(VEHICLE_COLS.make)) || (has(VEHICLE_COLS.make) && has(VEHICLE_COLS.model))) return 'vehicles';
  const names = driverNameColumns(headers);
  const named = names.name !== -1 || (names.first !== -1 && names.last !== -1);
  const driverish = [DRIVER_COLS.dob, DRIVER_COLS.licenseNumber, DRIVER_COLS.licenseState, DRIVER_COLS.licenseClass, DRIVER_COLS.hireDate, DRIVER_COLS.yearsExperience, DRIVER_COLS.issueDate, DRIVER_COLS.expirationDate, DRIVER_COLS.cdlOriginalIssueDate].some(has);
  if ((named && driverish) || has(DRIVER_COLS.dob)) return 'drivers';
  if (has(COVERAGE_COLS.coverageType) && has(COVERAGE_COLS.requestedLimit)) return 'coverage';
  return 'unrecognized';
}

/** A cell's text — empty when it's OCR noise rather than text (see isReadableText). */
const cell = (row: string[], i: number) => {
  const t = i >= 0 ? (row[i] ?? '').trim() : '';
  return t && isReadableText(t) ? t : '';
};
const isoDate = (raw: string) => (raw ? (normalizeDateKey(raw) ?? raw) : '');

export interface MappedVehicleRow {
  row: number;
  entry: Omit<VehicleEntry, 'id' | 'source'>;
}

export function mapVehicleTable(table: RawTable): MappedVehicleRow[] {
  const h = table.headers;
  const col = {
    vin: findColumn(h, VEHICLE_COLS.vin),
    year: findColumn(h, VEHICLE_COLS.year),
    make: findColumn(h, VEHICLE_COLS.make),
    model: findColumn(h, VEHICLE_COLS.model),
    value: findColumn(h, VEHICLE_COLS.value),
    bodyType: findColumn(h, VEHICLE_COLS.bodyType),
    plate: findColumn(h, VEHICLE_COLS.plate),
  };
  // One "Make/Model" column: the first word is the make.
  const makeModelTogether = col.make !== -1 && col.make === col.model;

  const results: MappedVehicleRow[] = [];
  table.rows.forEach((row, i) => {
    const entry: Omit<VehicleEntry, 'id' | 'source'> = {};
    const vin = normalizeVin(cell(row, col.vin));
    if (vin) entry.vin = vin;
    // Make/model only when they read as one (see rowValues.ts) — a registration's code ("FRHT") is
    // read as its make, and a form's labels or an address in the column are left out.
    const makeCell = cell(row, col.make);
    if (makeModelTogether) {
      const [make, ...model] = makeCell.split(/\s+/);
      const m = make ? (makeFromCode(make) ?? plausibleMakeOrModel(make, 'make')) : null;
      if (m) {
        entry.make = m;
        const rest = plausibleMakeOrModel(model.join(' '), 'model');
        if (rest) entry.model = rest;
      }
    } else {
      const make = plausibleMakeOrModel(makeCell, 'make') ?? makeFromCode(makeCell);
      if (make) entry.make = make;
      const model = plausibleMakeOrModel(cell(row, col.model), 'model');
      if (model) entry.model = model;
    }
    // "2015 FRHT" in the make column: the year printed with it.
    const yearInMake = !cell(row, col.year) && entry.make && entry.make !== makeCell ? makeCell.match(/\b(19[5-9]\d|20\d\d)\b/) : null;
    const year = parseCount(cell(row, col.year) || (yearInMake ? yearInMake[1] : ''));
    if (year !== null && year >= 1950 && year <= 2100) entry.year = year;
    const value = parseAmount(cell(row, col.value));
    if (value !== null && value > 0) entry.value = value;
    // Only ever derived from an explicit type/body-type column — never guessed from make/model.
    const bodyType = cell(row, col.bodyType) ? normalizeVehicleBodyType(cell(row, col.bodyType)) : null;
    if (bodyType) entry.bodyType = bodyType;
    const plate = plausiblePlate(cell(row, col.plate));
    if (plate) entry.plate = plate;
    // A vehicle needs something that identifies it — not just a stray value on a totals-like line.
    if (entry.vin || entry.make || entry.model || entry.plate) results.push({ row: i, entry });
  });
  return results;
}

export interface MappedDriverRow {
  row: number;
  entry: Omit<DriverEntry, 'id' | 'source'>;
}

export function mapDriverTable(table: RawTable): MappedDriverRow[] {
  const h = table.headers;
  const names = driverNameColumns(h);
  const col = {
    dob: findColumn(h, DRIVER_COLS.dob),
    licenseState: findColumn(h, DRIVER_COLS.licenseState),
    licenseNumber: findColumn(h, DRIVER_COLS.licenseNumber),
    licenseClass: findColumn(h, DRIVER_COLS.licenseClass),
    issueDate: findColumn(h, DRIVER_COLS.issueDate),
    cdlOriginalIssueDate: findColumn(h, DRIVER_COLS.cdlOriginalIssueDate),
    expirationDate: findColumn(h, DRIVER_COLS.expirationDate),
    hireDate: findColumn(h, DRIVER_COLS.hireDate),
    yearsExperience: findColumn(h, DRIVER_COLS.yearsExperience),
    violations: findColumn(h, DRIVER_COLS.violations),
    mvrReportDate: findColumn(h, DRIVER_COLS.mvrReportDate),
    address: findColumn(h, DRIVER_COLS.address),
    restrictions: findColumn(h, DRIVER_COLS.restrictions),
    endorsements: findColumn(h, DRIVER_COLS.endorsements),
  };

  const results: MappedDriverRow[] = [];
  table.rows.forEach((row, i) => {
    const entry: Omit<DriverEntry, 'id' | 'source'> = {};
    const full = cell(row, names.name);
    const joined = [cell(row, names.first), cell(row, names.last)].filter(Boolean).join(' ');
    const name = plausiblePersonName(full || joined);
    if (name && !/^(?:total|totals|count)\b/i.test(name)) entry.name = name;
    if (cell(row, col.dob)) entry.dob = isoDate(cell(row, col.dob));
    if (cell(row, col.licenseState)) entry.licenseState = cell(row, col.licenseState).toUpperCase();
    const licenseNumber = plausibleLicenseNumber(cell(row, col.licenseNumber));
    if (licenseNumber) entry.licenseNumber = licenseNumber;
    if (cell(row, col.licenseClass)) entry.licenseClass = cell(row, col.licenseClass).toUpperCase().replace(/^CLASS\s+/, '');
    if (cell(row, col.issueDate)) entry.issueDate = isoDate(cell(row, col.issueDate));
    if (cell(row, col.cdlOriginalIssueDate)) entry.cdlOriginalIssueDate = isoDate(cell(row, col.cdlOriginalIssueDate));
    if (cell(row, col.expirationDate)) entry.expirationDate = isoDate(cell(row, col.expirationDate));
    if (cell(row, col.hireDate)) entry.hireDate = isoDate(cell(row, col.hireDate));
    if (cell(row, col.mvrReportDate)) entry.mvrReportDate = isoDate(cell(row, col.mvrReportDate));
    if (cell(row, col.restrictions)) entry.restrictions = cell(row, col.restrictions);
    if (cell(row, col.endorsements)) entry.endorsements = cell(row, col.endorsements);
    if (cell(row, col.address)) entry.address = cell(row, col.address);
    const years = parseCount(cell(row, col.yearsExperience));
    if (years !== null && years >= 0 && years < 70) entry.yearsExperience = years;
    if (cell(row, col.violations)) entry.violations = cell(row, col.violations);
    // A driver row needs a name (or at least a license number) — a blank-name line is a subtotal or spacer.
    if (entry.name || entry.licenseNumber) results.push({ row: i, entry });
  });
  return results;
}

export interface MappedLossEntry {
  lossDate: string;
  claimType: string;
  paid: number;
  reserved: number;
  incurred: number;
  status: LossStatus;
  claimNumber?: string;
  description?: string;
}

export interface MappedLossRow {
  row: number;
  entry: MappedLossEntry;
}

export interface LossColumns {
  lossDate: number;
  claimNumber: number;
  description: number;
  claimType: number;
  paid: number;
  reserved: number;
  incurred: number;
  status: number;
}

export function lossColumns(headers: string[]): LossColumns {
  const description = findColumn(headers, LOSS_COLS.description);
  return {
    lossDate: lossDateColumn(headers),
    claimNumber: findColumn(headers, LOSS_COLS.claimNumber),
    description,
    claimType: findColumn(headers, LOSS_COLS.claimType, [description]),
    paid: findColumn(headers, LOSS_COLS.paid),
    reserved: findColumn(headers, LOSS_COLS.reserved),
    incurred: findColumn(headers, LOSS_COLS.incurred),
    status: findColumn(headers, LOSS_COLS.status),
  };
}

export function mapLossTable(table: RawTable): MappedLossRow[] {
  const col = lossColumns(table.headers);
  if (col.lossDate === -1 || (col.paid === -1 && col.incurred === -1 && col.reserved === -1)) return [];

  const results: MappedLossRow[] = [];
  table.rows.forEach((row, i) => {
    const lossDate = normalizeDateKey(cell(row, col.lossDate));
    if (!lossDate) return;
    let paid = parseAmount(cell(row, col.paid));
    let reserved = parseAmount(cell(row, col.reserved));
    let incurred = parseAmount(cell(row, col.incurred));
    if (paid === null && incurred === null && reserved === null) return;
    if (incurred === null) incurred = (paid ?? 0) + (reserved ?? 0);
    if (paid === null) paid = Math.max(0, incurred - (reserved ?? 0));
    if (reserved === null) reserved = Math.max(0, incurred - paid);
    const statusRaw = cell(row, col.status).toLowerCase();
    const status: LossStatus = /open|re-?open|pending|o$/.test(statusRaw) ? 'open' : statusRaw ? 'closed' : reserved > 0 ? 'open' : 'closed';
    const description = cell(row, col.description);
    const claimType = cell(row, col.claimType) || 'Unspecified';
    const claimNumber = cell(row, col.claimNumber);
    results.push({
      row: i,
      entry: { lossDate, claimType, paid, reserved, incurred, status, ...(claimNumber ? { claimNumber } : {}), ...(description ? { description } : {}) },
    });
  });
  return results;
}

export interface MappedCoverageRow {
  row: number;
  coverageType: CoverageType;
  requestedLimit: string;
}

export function mapCoverageTable(table: RawTable): MappedCoverageRow[] {
  const col = {
    coverageType: findColumn(table.headers, COVERAGE_COLS.coverageType),
    requestedLimit: findColumn(table.headers, COVERAGE_COLS.requestedLimit),
  };
  if (col.coverageType === -1 || col.requestedLimit === -1) return [];

  const results: MappedCoverageRow[] = [];
  table.rows.forEach((row, i) => {
    const label = row[col.coverageType]?.trim();
    const limitRaw = row[col.requestedLimit]?.trim();
    if (!label || !limitRaw) return;
    const alias = COVERAGE_TYPE_ALIASES.find((a) => a.match.test(label));
    if (!alias) return;
    // A split limit ("$1,000,000/$2,000,000") keeps its parts — stripping the "/" would run them together into one huge number.
    const limitValue = limitRaw.includes('/') ? null : parseMoney(limitRaw.replace(/[^\d.,km]/gi, ''));
    const requestedLimit = limitValue !== null ? `$${limitValue.toLocaleString('en-US')}` : normalizeCurrencyText(limitRaw);
    results.push({ row: i, coverageType: alias.type, requestedLimit });
  });
  return results;
}
