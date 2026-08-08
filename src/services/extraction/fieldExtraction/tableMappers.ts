import type { CoverageType, DriverEntry, LossStatus, VehicleEntry } from '../../../types';
import type { RawTable } from '../../ingestion';
import { parseCount, parseMoney } from './money';

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumn(headers: string[], synonyms: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const syn of synonyms) {
    const exact = normalized.indexOf(syn);
    if (exact !== -1) return exact;
  }
  for (const syn of synonyms) {
    const partial = normalized.findIndex((h) => h.includes(syn));
    if (partial !== -1) return partial;
  }
  return -1;
}

const VEHICLE_SYNONYMS: Record<keyof Omit<VehicleEntry, 'id' | 'source'>, string[]> = {
  vin: ['vin', 'vehicle identification number'],
  make: ['make'],
  model: ['model'],
  year: ['year', 'model year', 'vehicle year'],
  value: ['value', 'vehicle value', 'stated value', 'acv', 'actual cash value'],
};

const DRIVER_SYNONYMS: Record<keyof Omit<DriverEntry, 'id' | 'source'>, string[]> = {
  name: ['driver name', 'name'],
  dob: ['dob', 'date of birth'],
  licenseState: ['license state', 'lic state', 'state license', 'licensing state'],
  yearsExperience: ['years experience', 'years of experience', 'yrs experience', 'experience'],
  violations: ['violations', 'mvr violations', 'violation history'],
};

const LOSS_SYNONYMS = {
  lossDate: ['loss date', 'date of loss', 'date'],
  claimType: ['claim type', 'type', 'cause', 'peril'],
  paid: ['paid', 'paid amount', 'total paid'],
  reserved: ['reserve', 'reserved', 'reserve amount'],
  incurred: ['incurred', 'total incurred'],
  status: ['status', 'claim status'],
};

const COVERAGE_SYNONYMS = {
  coverageType: ['coverage', 'coverage type', 'line', 'line of business'],
  requestedLimit: ['requested limit', 'limit requested', 'limit'],
};

const COVERAGE_TYPE_ALIASES: { match: RegExp; type: CoverageType }[] = [
  { match: /auto\s*liability|csl|combined single limit/i, type: 'auto_liability' },
  { match: /cargo/i, type: 'motor_truck_cargo' },
  { match: /physical\s*damage/i, type: 'physical_damage' },
  { match: /general\s*liability/i, type: 'general_liability' },
];

export type TableKind = 'vehicles' | 'drivers' | 'losses' | 'coverage' | 'unrecognized';

/** Classifies a table by its headers so we never guess a mapping for a shape we don't recognize. */
export function classifyTable(headers: string[]): TableKind {
  if (findColumn(headers, VEHICLE_SYNONYMS.vin) !== -1) return 'vehicles';
  if (findColumn(headers, DRIVER_SYNONYMS.dob) !== -1 || findColumn(headers, DRIVER_SYNONYMS.licenseState) !== -1) return 'drivers';
  if (findColumn(headers, LOSS_SYNONYMS.paid) !== -1 && findColumn(headers, LOSS_SYNONYMS.incurred) !== -1) return 'losses';
  if (findColumn(headers, COVERAGE_SYNONYMS.coverageType) !== -1 && findColumn(headers, COVERAGE_SYNONYMS.requestedLimit) !== -1) return 'coverage';
  return 'unrecognized';
}

export interface MappedVehicleRow {
  row: number;
  entry: Omit<VehicleEntry, 'id' | 'source'>;
}

export function mapVehicleTable(table: RawTable): MappedVehicleRow[] {
  const col = {
    vin: findColumn(table.headers, VEHICLE_SYNONYMS.vin),
    make: findColumn(table.headers, VEHICLE_SYNONYMS.make),
    model: findColumn(table.headers, VEHICLE_SYNONYMS.model),
    year: findColumn(table.headers, VEHICLE_SYNONYMS.year),
    value: findColumn(table.headers, VEHICLE_SYNONYMS.value),
  };

  const results: MappedVehicleRow[] = [];
  table.rows.forEach((row, i) => {
    const entry: Omit<VehicleEntry, 'id' | 'source'> = {};
    if (col.vin !== -1 && row[col.vin]) entry.vin = row[col.vin].trim();
    if (col.make !== -1 && row[col.make]) entry.make = row[col.make].trim();
    if (col.model !== -1 && row[col.model]) entry.model = row[col.model].trim();
    if (col.year !== -1 && row[col.year]) {
      const year = parseCount(row[col.year]);
      if (year !== null) entry.year = year;
    }
    if (col.value !== -1 && row[col.value]) {
      const value = parseMoney(row[col.value]);
      if (value !== null) entry.value = value;
    }
    if (Object.keys(entry).length > 0) results.push({ row: i, entry });
  });
  return results;
}

export interface MappedDriverRow {
  row: number;
  entry: Omit<DriverEntry, 'id' | 'source'>;
}

export function mapDriverTable(table: RawTable): MappedDriverRow[] {
  const col = {
    name: findColumn(table.headers, DRIVER_SYNONYMS.name),
    dob: findColumn(table.headers, DRIVER_SYNONYMS.dob),
    licenseState: findColumn(table.headers, DRIVER_SYNONYMS.licenseState),
    yearsExperience: findColumn(table.headers, DRIVER_SYNONYMS.yearsExperience),
    violations: findColumn(table.headers, DRIVER_SYNONYMS.violations),
  };

  const results: MappedDriverRow[] = [];
  table.rows.forEach((row, i) => {
    const entry: Omit<DriverEntry, 'id' | 'source'> = {};
    if (col.name !== -1 && row[col.name]) entry.name = row[col.name].trim();
    if (col.dob !== -1 && row[col.dob]) entry.dob = row[col.dob].trim();
    if (col.licenseState !== -1 && row[col.licenseState]) entry.licenseState = row[col.licenseState].trim().toUpperCase();
    if (col.yearsExperience !== -1 && row[col.yearsExperience]) {
      const years = parseCount(row[col.yearsExperience]);
      if (years !== null) entry.yearsExperience = years;
    }
    if (col.violations !== -1 && row[col.violations]) entry.violations = row[col.violations].trim();
    if (Object.keys(entry).length > 0) results.push({ row: i, entry });
  });
  return results;
}

export interface MappedLossRow {
  row: number;
  entry: { lossDate: string; claimType: string; paid: number; reserved: number; incurred: number; status: LossStatus };
}

export function mapLossTable(table: RawTable): MappedLossRow[] {
  const col = {
    lossDate: findColumn(table.headers, LOSS_SYNONYMS.lossDate),
    claimType: findColumn(table.headers, LOSS_SYNONYMS.claimType),
    paid: findColumn(table.headers, LOSS_SYNONYMS.paid),
    reserved: findColumn(table.headers, LOSS_SYNONYMS.reserved),
    incurred: findColumn(table.headers, LOSS_SYNONYMS.incurred),
    status: findColumn(table.headers, LOSS_SYNONYMS.status),
  };
  if (col.lossDate === -1 || col.paid === -1 || col.incurred === -1) return [];

  const results: MappedLossRow[] = [];
  table.rows.forEach((row, i) => {
    const lossDate = row[col.lossDate]?.trim();
    const paid = col.paid !== -1 ? parseCount(row[col.paid]) : null;
    const incurred = col.incurred !== -1 ? parseCount(row[col.incurred]) : null;
    if (!lossDate || paid === null || incurred === null) return;
    const reserved = col.reserved !== -1 ? (parseCount(row[col.reserved]) ?? 0) : 0;
    const statusRaw = col.status !== -1 ? row[col.status]?.trim().toLowerCase() : '';
    const status: LossStatus = statusRaw === 'open' ? 'open' : 'closed';
    const claimType = col.claimType !== -1 ? row[col.claimType]?.trim() || 'Unspecified' : 'Unspecified';
    results.push({ row: i, entry: { lossDate, claimType, paid, reserved, incurred, status } });
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
    coverageType: findColumn(table.headers, COVERAGE_SYNONYMS.coverageType),
    requestedLimit: findColumn(table.headers, COVERAGE_SYNONYMS.requestedLimit),
  };
  if (col.coverageType === -1 || col.requestedLimit === -1) return [];

  const results: MappedCoverageRow[] = [];
  table.rows.forEach((row, i) => {
    const label = row[col.coverageType]?.trim();
    const limitRaw = row[col.requestedLimit]?.trim();
    if (!label || !limitRaw) return;
    const alias = COVERAGE_TYPE_ALIASES.find((a) => a.match.test(label));
    if (!alias) return;
    const limitValue = parseMoney(limitRaw.replace(/[^\d.,km]/gi, ''));
    const requestedLimit = limitValue !== null ? `$${limitValue.toLocaleString('en-US')}` : limitRaw;
    results.push({ row: i, coverageType: alias.type, requestedLimit });
  });
  return results;
}
