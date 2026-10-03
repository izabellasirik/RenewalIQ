import type { AppetiteCriterion, AppetiteRecord, CriterionSource, MarketType, RuleType } from '../../types';
import { unknownCriterion, verifiedCriterion } from '../../data/appetiteCriteriaHelpers';
import { US_STATES } from '../../utils/usStates';

/**
 * Carriers an agency admin maintains by hand (0023_agency_carriers.sql), and how they become the
 * AppetiteRecords Market Finder already matches against — no second matching path.
 *
 * `criteria` holds only what the admin set. A missing key = "not on file" (for the agency's
 * version of a built-in carrier: keep the built-in value); a key set to null = cleared.
 */

export type OperationType = 'local' | 'intrastate' | 'regional' | 'long_haul';
export const OPERATION_TYPE_LABELS: Record<OperationType, string> = { local: 'Local', intrastate: 'Intrastate', regional: 'Regional', long_haul: 'Long haul' };

export interface CarrierCriteria {
  states?: { admitted?: string[]; excluded?: string[] } | null;
  fleetSize?: { min?: number; max?: number } | null;
  yearsInBusinessMin?: number | null;
  yearsInBusinessMax?: number | null;
  minDriverExperienceYears?: number | null;
  minDriverAge?: number | null;
  operationTypes?: OperationType[] | null;
  /** Stored as text ("500 miles") — the same shape the built-in records and the radius rule use. */
  maxRadius?: string | null;
  commodities?: string[] | null;
  majorExclusions?: string[] | null;
  maxClaimsPast3Years?: number | null;
}
export type CriteriaKey = keyof CarrierCriteria;
export const CRITERIA_KEYS: CriteriaKey[] = ['states', 'fleetSize', 'yearsInBusinessMin', 'yearsInBusinessMax', 'minDriverExperienceYears', 'minDriverAge', 'operationTypes', 'maxRadius', 'commodities', 'majorExclusions', 'maxClaimsPast3Years'];

export type RuleStrictness = 'hard' | 'guideline';

export interface AgencyCarrier {
  id: string;
  /** Set when this is the agency's version of a built-in carrier (its id in data/carriers.ts). */
  baseRecordId: string | null;
  name: string;
  marketType: MarketType;
  availableThrough: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  criteria: CarrierCriteria;
  strictness: RuleStrictness;
  notes: string | null;
  /** 'manual' in V1; imports / carrier feeds can write the same rows later. */
  source: 'manual' | 'import' | 'carrier_feed';
  lastVerifiedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}

/** Market Finder id for a carrier the agency added itself (built-in versions keep the built-in id). */
export const agencyRecordId = (carrier: Pick<AgencyCarrier, 'id' | 'baseRecordId'>) => carrier.baseRecordId ?? `agency-${carrier.id}`;

const ALL_STATE_CODES = US_STATES.map((s) => s.code);

function toCriterion<T>(value: T | null | undefined, ruleType: RuleType, src: CriterionSource): AppetiteCriterion<T> {
  if (value === null || value === undefined) return unknownCriterion<T>();
  return verifiedCriterion(value, ruleType, src);
}

/** "Everywhere except …": an admin who lists only excluded states means every other state is fine. */
function statesValue(v: CarrierCriteria['states']): { admitted?: string[]; excluded?: string[] } | null {
  if (!v) return null;
  const admitted = v.admitted?.length ? v.admitted : undefined;
  const excluded = v.excluded?.length ? v.excluded : undefined;
  if (!admitted && !excluded) return null;
  return { admitted: admitted ?? ALL_STATE_CODES.filter((s) => !excluded!.includes(s)), excluded };
}

function blankRecord(id: string, name: string): AppetiteRecord {
  return {
    id,
    marketName: name,
    parentCompany: name,
    marketType: 'direct',
    states: unknownCriterion(),
    fleetSize: unknownCriterion(),
    yearsInBusinessMin: unknownCriterion(),
    yearsInBusinessMax: unknownCriterion(),
    operationTypes: unknownCriterion(),
    maxRadius: unknownCriterion(),
    commodities: unknownCriterion(),
    minDriverAge: unknownCriterion(),
    minDriverExperienceYears: unknownCriterion(),
    telematicsRequired: unknownCriterion(),
    dashcamRequired: unknownCriterion(),
    dotNumberRequired: unknownCriterion(),
    majorExclusions: unknownCriterion(),
    maxClaimsPast3Years: unknownCriterion(),
    maxIncurredPerUnit: unknownCriterion(),
    linesOffered: unknownCriterion(),
    underwritingNotes: '',
  };
}

/** The AppetiteRecord Market Finder matches for this carrier: the admin's criteria on top of the built-in (if any). */
export function agencyCarrierToRecord(carrier: AgencyCarrier, base: AppetiteRecord | undefined, agencyName: string | null): AppetiteRecord {
  const record: AppetiteRecord = base ? { ...base } : blankRecord(agencyRecordId(carrier), carrier.name);
  const src: CriterionSource = { sourceType: 'INTERNAL_MARKET_LIST', sourceName: `${agencyName ?? 'Your agency'}'s carrier appetite`, verifiedAt: (carrier.lastVerifiedAt ?? carrier.updatedAt).slice(0, 10) };
  const hard: RuleType = carrier.strictness === 'hard' ? 'HARD_RULE' : 'PREFERENCE';
  const c = carrier.criteria;
  const has = (k: CriteriaKey) => Object.prototype.hasOwnProperty.call(c, k);

  if (has('states')) record.states = toCriterion(statesValue(c.states), hard, src);
  if (has('fleetSize')) record.fleetSize = toCriterion(c.fleetSize && (c.fleetSize.min !== undefined || c.fleetSize.max !== undefined) ? c.fleetSize : null, hard, src);
  if (has('yearsInBusinessMin')) record.yearsInBusinessMin = toCriterion(c.yearsInBusinessMin, hard, src);
  if (has('yearsInBusinessMax')) record.yearsInBusinessMax = toCriterion(c.yearsInBusinessMax, hard, src);
  if (has('minDriverExperienceYears')) record.minDriverExperienceYears = toCriterion(c.minDriverExperienceYears, hard, src);
  if (has('minDriverAge')) record.minDriverAge = toCriterion(c.minDriverAge, hard, src);
  if (has('operationTypes')) record.operationTypes = toCriterion(c.operationTypes?.length ? c.operationTypes : null, hard, src);
  if (has('maxRadius')) record.maxRadius = toCriterion(c.maxRadius, hard, src);
  // Commodity lists are matched by exact name, so a miss is a "confirm with the market", never a decline.
  if (has('commodities')) record.commodities = toCriterion(c.commodities?.length ? c.commodities : null, 'TARGET', src);
  if (has('majorExclusions')) record.majorExclusions = toCriterion(c.majorExclusions?.length ? c.majorExclusions : null, hard, src);
  if (has('maxClaimsPast3Years')) record.maxClaimsPast3Years = toCriterion(c.maxClaimsPast3Years, hard, src);

  record.marketName = carrier.name;
  if (!base) record.parentCompany = carrier.name;
  record.marketType = carrier.marketType;
  record.availableThrough = carrier.availableThrough ?? (base ? base.availableThrough : undefined);
  if (carrier.notes?.trim()) record.underwritingNotes = carrier.notes.trim();
  record.agencyCarrier = {
    carrierId: carrier.id,
    website: carrier.website ?? undefined,
    contactName: carrier.contactName ?? undefined,
    contactEmail: carrier.contactEmail ?? undefined,
    contactPhone: carrier.contactPhone ?? undefined,
  };
  return record;
}

/**
 * The records Market Finder uses for an agency: built-ins (the agency's version where it has one,
 * minus the ones it archived), then the carriers it added itself (not archived).
 */
export function layerAgencyCarriers(base: AppetiteRecord[], carriers: AgencyCarrier[], agencyName: string | null): AppetiteRecord[] {
  if (carriers.length === 0) return base;
  const byBase = new Map(carriers.filter((c) => c.baseRecordId).map((c) => [c.baseRecordId!, c]));
  const out: AppetiteRecord[] = [];
  for (const record of base) {
    const mine = byBase.get(record.id);
    if (!mine) out.push(record);
    else if (!mine.archivedAt) out.push(agencyCarrierToRecord(mine, record, agencyName));
  }
  for (const c of carriers) if (!c.baseRecordId && !c.archivedAt) out.push(agencyCarrierToRecord(c, undefined, agencyName));
  return out;
}

// ------------------------------------------------------------------------------------------------
// The admin form: plain strings in, CarrierCriteria out.
// ------------------------------------------------------------------------------------------------

export interface CriteriaForm {
  statesAdmitted: string;
  statesExcluded: string;
  fleetMin: string;
  fleetMax: string;
  yearsMin: string;
  yearsMax: string;
  driverExperienceMin: string;
  driverAgeMin: string;
  operationTypes: OperationType[];
  maxRadiusMiles: string;
  commodities: string;
  exclusions: string;
  maxClaims3y: string;
}

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const stateList = (s: string) => [...new Set(list(s.toUpperCase()).filter((x) => ALL_STATE_CODES.includes(x)))].sort();
const num = (s: string) => {
  const n = Number(s.trim());
  return s.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
};
const usable = <T,>(c: AppetiteCriterion<T>) => (c.verificationStatus === 'VERIFIED' || c.verificationStatus === 'PARTIALLY_VERIFIED' ? c.value : null);
const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** State lists a form can't parse (not a 2-letter code) — shown back to the admin rather than silently dropped. */
export function unknownStateCodes(s: string): string[] {
  return list(s.toUpperCase()).filter((x) => !ALL_STATE_CODES.includes(x));
}

/** What the form shows for a record (a built-in, or a carrier's current matching record). */
export function recordToForm(record: AppetiteRecord | undefined): CriteriaForm {
  if (!record) return { statesAdmitted: '', statesExcluded: '', fleetMin: '', fleetMax: '', yearsMin: '', yearsMax: '', driverExperienceMin: '', driverAgeMin: '', operationTypes: [], maxRadiusMiles: '', commodities: '', exclusions: '', maxClaims3y: '' };
  const states = usable(record.states);
  const excluded = states?.excluded ?? [];
  // "All states except …" reads back as just the exclusions.
  const admitted = states?.admitted ?? [];
  const allButExcluded = excluded.length > 0 && admitted.length === ALL_STATE_CODES.length - excluded.length;
  const fleet = usable(record.fleetSize);
  const radius = usable(record.maxRadius);
  return {
    statesAdmitted: allButExcluded ? '' : admitted.join(', '),
    statesExcluded: excluded.join(', '),
    fleetMin: numText(fleet?.min),
    fleetMax: numText(fleet?.max),
    yearsMin: numText(usable(record.yearsInBusinessMin)),
    yearsMax: numText(usable(record.yearsInBusinessMax)),
    driverExperienceMin: numText(usable(record.minDriverExperienceYears)),
    driverAgeMin: numText(usable(record.minDriverAge)),
    operationTypes: ((usable(record.operationTypes) ?? []) as string[]).filter((o): o is OperationType => o in OPERATION_TYPE_LABELS),
    maxRadiusMiles: radius?.match(/(\d[\d,]*)\s*mile/i)?.[1]?.replace(/,/g, '') ?? '',
    commodities: (usable(record.commodities) ?? []).join(', '),
    exclusions: (usable(record.majorExclusions) ?? []).join(', '),
    maxClaims3y: numText(usable(record.maxClaimsPast3Years)),
  };
}

function formToCriteria(f: CriteriaForm): Required<{ [K in CriteriaKey]: CarrierCriteria[K] }> {
  const admitted = stateList(f.statesAdmitted);
  const excluded = stateList(f.statesExcluded);
  const fleetMin = num(f.fleetMin);
  const fleetMax = num(f.fleetMax);
  const miles = num(f.maxRadiusMiles);
  return {
    states: admitted.length || excluded.length ? { ...(admitted.length ? { admitted } : {}), ...(excluded.length ? { excluded } : {}) } : null,
    fleetSize: fleetMin !== null || fleetMax !== null ? { ...(fleetMin !== null ? { min: fleetMin } : {}), ...(fleetMax !== null ? { max: fleetMax } : {}) } : null,
    yearsInBusinessMin: num(f.yearsMin),
    yearsInBusinessMax: num(f.yearsMax),
    minDriverExperienceYears: num(f.driverExperienceMin),
    minDriverAge: num(f.driverAgeMin),
    operationTypes: f.operationTypes.length ? [...f.operationTypes] : null,
    maxRadius: miles !== null ? `${miles} miles` : null,
    commodities: list(f.commodities).length ? list(f.commodities) : null,
    majorExclusions: list(f.exclusions).length ? list(f.exclusions) : null,
    maxClaimsPast3Years: num(f.maxClaims3y),
  };
}

/**
 * The criteria to save. For a carrier the agency added: everything filled in (blank = not on file).
 * For the agency's version of a built-in: only what differs from the built-in, so untouched
 * criteria keep the built-in's value, source and rule type; a cleared field is saved as null.
 */
export function formToSavedCriteria(form: CriteriaForm, builtIn?: AppetiteRecord): CarrierCriteria {
  const next = formToCriteria(form);
  const out: CarrierCriteria = {};
  if (!builtIn) {
    for (const k of CRITERIA_KEYS) if (next[k] !== null) (out as Record<string, unknown>)[k] = next[k];
    return out;
  }
  const before = formToCriteria(recordToForm(builtIn));
  for (const k of CRITERIA_KEYS) {
    if (JSON.stringify(next[k]) !== JSON.stringify(before[k])) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}
