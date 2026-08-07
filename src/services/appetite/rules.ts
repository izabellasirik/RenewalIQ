import type { AppetiteRecord, MatchReason, RiskProfile } from '../../types';

function reason(criterion: string, status: MatchReason['status'], explanation: string): MatchReason {
  return { criterion, status, explanation };
}

function classifyOperationType(radiusText: string | null): string | null {
  if (!radiusText) return null;
  const t = radiusText.toLowerCase();
  if (t.includes('local')) return 'local';
  if (t.includes('intrastate')) return 'intrastate';
  if (t.includes('long')) return 'long_haul';
  if (t.includes('regional')) return 'regional';
  return null;
}

function parseLeadingMiles(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d[\d,]*)\s*mile/i);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function parseRequirement(text: string, keyword: RegExp): number | null {
  const match = text.match(keyword);
  return match ? Number(match[1]) : null;
}

export function evaluateStateEligibility(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const homeState = profile.business.state.value;
  const operatingStates = profile.transportation.statesOfOperation.value ?? [];

  if (homeState && !record.eligibleStates.includes(homeState)) {
    return reason('Eligible States', 'fail', `Domicile state ${homeState} is not in this market's eligible state list.`);
  }

  const uncovered = operatingStates.filter((s) => !record.eligibleStates.includes(s));
  if (uncovered.length > 0) {
    return reason(
      'Eligible States',
      'warning',
      `Covers domicile state${homeState ? ` (${homeState})` : ''}, but not all operating states — missing ${uncovered.join(', ')}.`
    );
  }

  return reason('Eligible States', 'pass', `All operating states (${operatingStates.join(', ') || 'domicile only'}) are eligible.`);
}

export function evaluateFleetSize(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const fleetSize = profile.transportation.fleetSize.value;
  if (fleetSize === null) {
    return reason('Fleet Size', 'warning', 'Fleet size not confirmed in the risk profile — verify before submitting.');
  }
  const min = record.fleetSizeMin ?? 0;
  const max = record.fleetSizeMax ?? Infinity;
  if (fleetSize < min || fleetSize > max) {
    return reason('Fleet Size', 'fail', `Fleet of ${fleetSize} units is outside this market's ${min}–${record.fleetSizeMax ?? '∞'} unit range.`);
  }
  return reason('Fleet Size', 'pass', `Fleet of ${fleetSize} units fits within ${min}–${record.fleetSizeMax ?? '∞'} units.`);
}

export function evaluateYearsInBusiness(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const years = profile.business.yearsInBusiness.value;
  if (years === null) {
    return reason('Years in Business', 'warning', 'Years in business not confirmed — verify before submitting.');
  }
  if (record.yearsInBusinessMin !== undefined && years < record.yearsInBusinessMin) {
    return reason('Years in Business', 'fail', `${years} years in business is below this market's ${record.yearsInBusinessMin}-year minimum.`);
  }
  return reason('Years in Business', 'pass', `${years} years in business meets the ${record.yearsInBusinessMin ?? 0}-year minimum.`);
}

export function evaluateOperationAndRadius(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const radiusText = profile.transportation.operatingRadius.value;
  const opType = classifyOperationType(radiusText);
  const miles = parseLeadingMiles(radiusText);
  const maxMiles = parseLeadingMiles(record.maxRadius ?? null);

  if (!radiusText) {
    return reason('Operating Radius', 'warning', 'Operating radius not confirmed — verify before submitting.');
  }
  if (opType && !record.operationTypes.includes(opType)) {
    return reason('Operating Radius', 'fail', `Operation type "${opType}" is outside this market's appetite (${record.operationTypes.join(', ')}).`);
  }
  if (miles !== null && maxMiles !== null && miles > maxMiles) {
    return reason('Operating Radius', 'fail', `${miles}-mile radius exceeds this market's ${maxMiles}-mile maximum.`);
  }
  return reason('Operating Radius', 'pass', `${radiusText} fits within appetite (max ${record.maxRadius ?? 'unrestricted'}).`);
}

export function evaluateCommodities(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const commodities = profile.transportation.commoditiesHauled.value ?? [];
  if (commodities.length === 0) {
    return reason('Commodities', 'warning', 'Commodities hauled not confirmed — verify before submitting.');
  }
  const lowerAccepted = record.commodities.map((c) => c.toLowerCase());
  const matched = commodities.filter((c) => lowerAccepted.includes(c.toLowerCase()));
  const unmatched = commodities.filter((c) => !lowerAccepted.includes(c.toLowerCase()));

  if (matched.length === 0) {
    return reason('Commodities', 'fail', `None of the hauled commodities (${commodities.join(', ')}) are in this market's appetite.`);
  }
  if (unmatched.length > 0) {
    return reason('Commodities', 'warning', `${matched.join(', ')} are in appetite, but ${unmatched.join(', ')} ${unmatched.length > 1 ? 'are' : 'is'} not explicitly listed.`);
  }
  return reason('Commodities', 'pass', `All hauled commodities (${commodities.join(', ')}) are in this market's appetite.`);
}

export function evaluateDriverRequirements(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const minAge = profile.transportation.minDriverAge.value;
  const minExp = profile.transportation.minDriverExperienceYears.value;
  const requiredAge = parseRequirement(record.driverRequirements, /age\s*(\d+)/i);
  const requiredExp = parseRequirement(record.driverRequirements, /(\d+)\s*year/i);

  if (minAge === null || minExp === null) {
    return reason('Driver Requirements', 'warning', 'Driver age/experience not fully confirmed — verify before submitting.');
  }
  if (requiredAge !== null && minAge < requiredAge) {
    return reason('Driver Requirements', 'fail', `Account's minimum driver age (${minAge}) is below this market's requirement (${requiredAge}).`);
  }
  if (requiredExp !== null && minExp < requiredExp) {
    return reason('Driver Requirements', 'fail', `Account's minimum driver experience (${minExp} yr) is below this market's requirement (${requiredExp} yr).`);
  }
  return reason('Driver Requirements', 'pass', `Driver age (${minAge}) and experience (${minExp} yr) meet: "${record.driverRequirements}"`);
}

export function evaluateTelematics(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  if (!record.telematicsRequired) {
    return reason('Telematics', 'pass', 'Telematics not required by this market.');
  }
  const field = profile.transportation.telematics;
  if (field.value === null) {
    return reason('Telematics', 'warning', 'This market requires telematics, and fleet telematics status is unconfirmed — verify.');
  }
  if (field.value === false) {
    return reason('Telematics', 'fail', 'This market requires telematics; the fleet does not currently have it.');
  }
  return reason('Telematics', 'pass', 'Telematics required and confirmed present on the fleet.');
}

export function evaluateDashcams(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  if (!record.dashcamRequired) {
    return reason('Dashcams', 'pass', 'Dashcams not required by this market.');
  }
  const field = profile.transportation.dashcams;
  if (field.value === null) {
    return reason('Dashcams', 'warning', 'This market requires dashcams, and dashcam status is unconfirmed — verify with the market or the account.');
  }
  if (field.value === false) {
    return reason('Dashcams', 'fail', 'This market requires dashcams; the fleet does not currently have them.');
  }
  return reason('Dashcams', 'pass', 'Dashcams required and confirmed present on the fleet.');
}

export function evaluateExclusions(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  if (record.majorExclusions.length === 0) {
    return reason('Major Exclusions', 'pass', 'This market has no listed exclusions relevant to this account.');
  }
  const haystack = [
    profile.business.descriptionOfOperations.value ?? '',
    ...(profile.transportation.commoditiesHauled.value ?? []),
  ]
    .join(' ')
    .toLowerCase();

  const triggered = record.majorExclusions.filter((ex) => haystack.includes(ex.toLowerCase()));
  if (triggered.length > 0) {
    return reason('Major Exclusions', 'fail', `Account operations appear to fall under an excluded category: ${triggered.join(', ')}.`);
  }
  return reason('Major Exclusions', 'pass', `No indication the account falls under this market's exclusions (${record.majorExclusions.join(', ')}).`);
}

export const ALL_RULES = [
  evaluateStateEligibility,
  evaluateFleetSize,
  evaluateYearsInBusiness,
  evaluateOperationAndRadius,
  evaluateCommodities,
  evaluateDriverRequirements,
  evaluateTelematics,
  evaluateDashcams,
  evaluateExclusions,
];
