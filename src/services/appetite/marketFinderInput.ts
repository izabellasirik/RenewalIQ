import type { RiskProfile } from '../../types';
import { manualField } from '../../types';
import { createEmptyRiskProfile } from '../extraction';

export const OPERATION_TYPE_OPTIONS = [
  'General Freight',
  'Dry Van',
  'Reefer',
  'Flatbed',
  'Intermodal',
  'Box Truck',
  'Straight Truck',
  'Hot Shot',
  'Auto Hauler',
  'Dump Truck',
  'Sand & Gravel',
  'Tow Truck',
  'Moving / Household Goods',
  'Last Mile',
  'Tanker',
] as const;

export const COVERAGE_OPTIONS = ['Auto Liability', 'Motor Truck Cargo', 'Physical Damage', 'General Liability', 'NTL', 'Trailer Interchange', 'Excess'] as const;

export type TriState = 'yes' | 'no' | 'unknown';

/** Manual risk characteristics a broker enters directly, for markets search without an account/Risk Profile. */
export interface MarketFinderFilters {
  domicileState: string;
  operatingStates: string[];
  fleetSize: string;
  yearsInBusiness: string;
  newVenture: boolean;
  operationTypes: string[];
  cargoText: string;
  operatingRadius: string;
  minDriverExperienceYears: string;
  minDriverAge: string;
  telematics: TriState;
  dashcams: TriState;
  coverageNeeded: string[];
}

export const EMPTY_MARKET_FINDER_FILTERS: MarketFinderFilters = {
  domicileState: '',
  operatingStates: [],
  fleetSize: '',
  yearsInBusiness: '',
  newVenture: false,
  operationTypes: [],
  cargoText: '',
  operatingRadius: '',
  minDriverExperienceYears: '',
  minDriverAge: '',
  telematics: 'unknown',
  dashcams: 'unknown',
  coverageNeeded: [],
};

function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalizes manually-entered Market Finder filters into the SAME RiskProfile shape the
 * account-specific Carrier Appetite page feeds into matchAllMarkets — so both entry points run
 * through the exact same matching engine and rules, just with a different source for the input.
 * Any field the broker leaves blank stays an emptyField(), which the rules already treat as an
 * honest data gap rather than a forced value.
 */
export function buildProfileFromFilters(filters: MarketFinderFilters): RiskProfile {
  const profile = createEmptyRiskProfile('market-finder');

  if (filters.domicileState) profile.business.state = manualField(filters.domicileState);

  const yearsInBusiness = toNumber(filters.yearsInBusiness);
  if (yearsInBusiness !== undefined) {
    profile.business.yearsInBusiness = manualField(yearsInBusiness);
  } else if (filters.newVenture) {
    profile.business.yearsInBusiness = manualField(0);
  }

  const fleetSize = toNumber(filters.fleetSize);
  if (fleetSize !== undefined) profile.transportation.fleetSize = manualField(fleetSize);

  if (filters.operatingStates.length > 0) profile.transportation.statesOfOperation = manualField(filters.operatingStates);
  if (filters.operatingRadius.trim()) profile.transportation.operatingRadius = manualField(filters.operatingRadius.trim());

  const cargoFromText = filters.cargoText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const commodities = [...filters.operationTypes, ...cargoFromText];
  if (commodities.length > 0) profile.transportation.commoditiesHauled = manualField(commodities);

  const minDriverExperienceYears = toNumber(filters.minDriverExperienceYears);
  if (minDriverExperienceYears !== undefined) profile.transportation.minDriverExperienceYears = manualField(minDriverExperienceYears);

  const minDriverAge = toNumber(filters.minDriverAge);
  if (minDriverAge !== undefined) profile.transportation.minDriverAge = manualField(minDriverAge);

  if (filters.telematics !== 'unknown') profile.transportation.telematics = manualField(filters.telematics === 'yes');
  if (filters.dashcams !== 'unknown') profile.transportation.dashcams = manualField(filters.dashcams === 'yes');

  return profile;
}

export function hasAnyFilter(filters: MarketFinderFilters): boolean {
  return (
    !!filters.domicileState ||
    filters.operatingStates.length > 0 ||
    !!filters.fleetSize ||
    !!filters.yearsInBusiness ||
    filters.newVenture ||
    filters.operationTypes.length > 0 ||
    !!filters.cargoText.trim() ||
    !!filters.operatingRadius.trim() ||
    !!filters.minDriverExperienceYears ||
    !!filters.minDriverAge ||
    filters.telematics !== 'unknown' ||
    filters.dashcams !== 'unknown' ||
    filters.coverageNeeded.length > 0
  );
}
