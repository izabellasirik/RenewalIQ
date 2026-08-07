import type { AppetiteRecord, MatchReason, RiskProfile } from '../../types';

function reason(criterion: string, status: MatchReason['status'], explanation: string, isDataGap?: boolean): MatchReason {
  return { criterion, status, explanation, isDataGap };
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

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function evaluateStateEligibility(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const homeState = profile.business.state.value;
  const operatingStates = profile.transportation.statesOfOperation.value ?? [];

  if (homeState && !record.eligibleStates.includes(homeState)) {
    return reason('Eligible States', 'fail', `Domicile state ${homeState} is not in this market's eligible state list — a hard stop regardless of other criteria.`);
  }

  const uncovered = operatingStates.filter((s) => !record.eligibleStates.includes(s));
  if (uncovered.length > 0) {
    return reason(
      'Eligible States',
      'warning',
      `Covers domicile state${homeState ? ` (${homeState})` : ''}, but not all operating states — missing ${uncovered.join(', ')}. May need to exclude those lanes or split the risk.`
    );
  }

  return reason('Eligible States', 'pass', `All operating states (${operatingStates.join(', ') || 'domicile only'}) are within this market's licensed footprint.`);
}

export function evaluateFleetSize(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const fleetSize = profile.transportation.fleetSize.value;
  if (fleetSize === null) {
    return reason('Fleet Size', 'warning', 'Fleet size not confirmed in the risk profile — verify before submitting.', true);
  }
  const min = record.fleetSizeMin ?? 0;
  const max = record.fleetSizeMax ?? Infinity;
  if (fleetSize < min || fleetSize > max) {
    const direction = fleetSize > max ? 'above this market\'s ceiling' : 'below this market\'s floor';
    return reason('Fleet Size', 'fail', `${fleetSize} power units is ${direction} of ${min}–${record.fleetSizeMax ?? '∞'} units.`);
  }
  return reason('Fleet Size', 'pass', `${fleetSize} power units falls within this market's ${min}–${record.fleetSizeMax ?? '∞'}-unit sweet spot.`);
}

export function evaluateYearsInBusiness(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const years = profile.business.yearsInBusiness.value;
  if (years === null) {
    return reason('Years in Business', 'warning', 'Years in business not confirmed — verify before submitting.', true);
  }
  if (record.yearsInBusinessMin !== undefined && years < record.yearsInBusinessMin) {
    return reason('Years in Business', 'fail', `${years} years in operation is below this market's ${record.yearsInBusinessMin}-year minimum — reads as a new venture to this underwriter.`);
  }
  return reason(
    'Years in Business',
    'pass',
    record.yearsInBusinessMin ? `${years} years in operation clears the ${record.yearsInBusinessMin}-year minimum — an established risk, not a startup.` : `${years} years in operation; this market has no stated minimum.`
  );
}

export function evaluateOperationAndRadius(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const radiusText = profile.transportation.operatingRadius.value;
  const opType = classifyOperationType(radiusText);
  const miles = parseLeadingMiles(radiusText);
  const maxMiles = parseLeadingMiles(record.maxRadius ?? null);

  if (!radiusText) {
    return reason('Operating Radius', 'warning', 'Operating radius not confirmed — verify before submitting.', true);
  }
  if (opType && !record.operationTypes.includes(opType)) {
    return reason('Operating Radius', 'fail', `Operation type "${opType}" is outside this market's appetite (writes ${record.operationTypes.join(', ')} only).`);
  }
  if (miles !== null && maxMiles !== null && miles > maxMiles) {
    return reason('Operating Radius', 'fail', `${miles}-mile radius exceeds this market's ${maxMiles}-mile maximum — likely needs a long-haul-friendly market instead.`);
  }
  return reason('Operating Radius', 'pass', `${radiusText} fits comfortably within appetite (max ${record.maxRadius ?? 'unrestricted'}).`);
}

export function evaluateCommodities(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const commodities = profile.transportation.commoditiesHauled.value ?? [];
  if (commodities.length === 0) {
    return reason('Commodities', 'warning', 'Commodities hauled not confirmed — verify before submitting.', true);
  }
  const lowerAccepted = record.commodities.map((c) => c.toLowerCase());
  const matched = commodities.filter((c) => lowerAccepted.includes(c.toLowerCase()));
  const unmatched = commodities.filter((c) => !lowerAccepted.includes(c.toLowerCase()));

  if (matched.length === 0) {
    return reason('Commodities', 'fail', `None of the hauled commodities (${commodities.join(', ')}) are in this market's appetite — a fundamental cargo-class mismatch.`);
  }
  if (unmatched.length > 0) {
    return reason(
      'Commodities',
      'warning',
      `${matched.join(', ')} ${matched.length > 1 ? 'are' : 'is'} in appetite, but ${unmatched.join(', ')} ${unmatched.length > 1 ? 'are' : 'is'} not explicitly listed — worth a quick call to see if they'll write the mixed book.`
    );
  }
  return reason('Commodities', 'pass', `All hauled commodities (${commodities.join(', ')}) sit squarely in this market's appetite.`);
}

export function evaluateDriverRequirements(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const minAge = profile.transportation.minDriverAge.value;
  const minExp = profile.transportation.minDriverExperienceYears.value;
  const requiredAge = parseRequirement(record.driverRequirements, /age\s*(\d+)/i);
  const requiredExp = parseRequirement(record.driverRequirements, /(\d+)\s*year/i);

  if (minAge === null || minExp === null) {
    return reason('Driver Requirements', 'warning', 'Driver age/experience not fully confirmed — verify before submitting.', true);
  }
  if (requiredAge !== null && minAge < requiredAge) {
    return reason('Driver Requirements', 'fail', `Youngest qualifying driver age (${minAge}) is below this market's ${requiredAge}-year-old floor.`);
  }
  if (requiredExp !== null && minExp < requiredExp) {
    return reason('Driver Requirements', 'fail', `Minimum CDL experience on file (${minExp} yr) falls short of this market's ${requiredExp}-year requirement.`);
  }
  return reason('Driver Requirements', 'pass', `Driver age (${minAge}) and CDL experience (${minExp} yr) clear this market's bar: "${record.driverRequirements}"`);
}

export function evaluateTelematics(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  if (!record.telematicsRequired) {
    return reason('Telematics', 'pass', 'Telematics not required by this market.');
  }
  const field = profile.transportation.telematics;
  if (field.value === null) {
    return reason('Telematics', 'warning', 'This market requires telematics, and fleet telematics status is unconfirmed — verify.', true);
  }
  if (field.value === false) {
    return reason('Telematics', 'fail', 'This market requires telematics; the fleet does not currently have it installed.');
  }
  return reason('Telematics', 'pass', 'Telematics required by this market and confirmed present on the fleet.');
}

export function evaluateDashcams(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  if (!record.dashcamRequired) {
    return reason('Dashcams', 'pass', 'Dashcams not required by this market.');
  }
  const field = profile.transportation.dashcams;
  if (field.value === null) {
    return reason('Dashcams', 'warning', 'This market requires dashcams, and dashcam status is unconfirmed — verify with the market or the account.', true);
  }
  if (field.value === false) {
    return reason('Dashcams', 'fail', 'This market requires dashcams; the fleet does not currently have them installed.');
  }
  return reason('Dashcams', 'pass', 'Dashcams required by this market and confirmed present on the fleet.');
}

/**
 * Loss experience is one of the top underwriting factors for a trucking account — evaluated
 * on claim frequency and incurred-per-unit (a standard normalization for fleets of different
 * sizes) when the market states a threshold. Markets that don't publish a loss threshold pass
 * structurally; this mirrors how not every appetite guide quantifies loss tolerance.
 */
export function evaluateLossHistory(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const losses = profile.lossHistory;
  if (losses.length === 0) {
    return reason('Loss History', 'warning', 'Loss run not yet on file — evaluate claim history once uploaded.', true);
  }

  const claimCount = losses.length;
  const totalIncurred = losses.reduce((sum, l) => sum + l.incurred, 0);
  const fleetSize = profile.transportation.fleetSize.value;
  const perUnit = fleetSize ? totalIncurred / fleetSize : null;
  const perUnitText = perUnit !== null ? ` (~${usd(perUnit)}/unit)` : '';

  if (record.maxClaimsPast3Years !== undefined && claimCount > record.maxClaimsPast3Years) {
    return reason(
      'Loss History',
      'fail',
      `${claimCount} losses on file exceed this market's tolerance of ${record.maxClaimsPast3Years} claims over a trailing 3-year window.`
    );
  }

  if (perUnit !== null && record.maxIncurredPerUnit !== undefined && perUnit > record.maxIncurredPerUnit) {
    return reason(
      'Loss History',
      'fail',
      `${usd(totalIncurred)} incurred across ${claimCount} losses${perUnitText} exceeds this market's ${usd(record.maxIncurredPerUnit)}/unit tolerance.`
    );
  }

  return reason(
    'Loss History',
    'pass',
    `${claimCount} loss${claimCount === 1 ? '' : 'es'} totaling ${usd(totalIncurred)}${perUnitText} reads as an acceptable loss history for this market.`
  );
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
    return reason('Major Exclusions', 'fail', `Account operations appear to fall under an excluded category for this market: ${triggered.join(', ')}.`);
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
  evaluateLossHistory,
  evaluateTelematics,
  evaluateDashcams,
  evaluateExclusions,
];
