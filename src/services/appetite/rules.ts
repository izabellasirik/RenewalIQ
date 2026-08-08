import type { AppetiteRecord, MatchReason, RiskProfile } from '../../types';

function reason(criterion: string, status: MatchReason['status'], explanation: string, isDataGap?: boolean): MatchReason {
  return { criterion, status, explanation, isDataGap };
}

/** A verified market source publishing "no list yet captured" reads the same as UNKNOWN — never treated as a pass or a fail. */
function unknownMarketReason(criterion: string, marketName: string, what: string): MatchReason {
  return reason(criterion, 'warning', `${marketName} has no verified ${what} on file — confirm directly with the market.`, true);
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

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function evaluateStateEligibility(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const homeState = profile.business.state.value;
  const operatingStates = profile.transportation.statesOfOperation.value ?? [];
  const states = record.states;

  if (states.status === 'UNKNOWN' || !states.value) {
    return unknownMarketReason('Eligible States', record.marketName, 'state-eligibility list');
  }

  const { admitted, excluded } = states.value;

  if (homeState && excluded?.includes(homeState)) {
    return reason('Eligible States', 'fail', `Domicile state ${homeState} is explicitly excluded by ${record.marketName} — a verified hard stop regardless of other criteria.`);
  }

  const explicitlyAdmitted = admitted ?? [];
  const stateList = [homeState, ...operatingStates].filter((s): s is string => !!s);

  if (stateList.length === 0) {
    return reason('Eligible States', 'warning', 'Domicile/operating states not confirmed on the risk profile — verify before submitting.', true);
  }

  const excludedHits = stateList.filter((s) => excluded?.includes(s));
  if (excludedHits.length > 0) {
    return reason('Eligible States', 'fail', `Operates in ${excludedHits.join(', ')}, which ${record.marketName} explicitly excludes.`);
  }

  const admittedHits = stateList.filter((s) => explicitlyAdmitted.includes(s));
  const unconfirmed = stateList.filter((s) => !explicitlyAdmitted.includes(s) && !excluded?.includes(s));

  if (explicitlyAdmitted.length === 0) {
    // No admit-list at all, only exclusions were published — passing the exclusion check is as far as we can verify.
    return reason('Eligible States', 'warning', `${record.marketName} publishes excluded states only — availability for ${stateList.join(', ')} is not otherwise confirmed.`, true);
  }

  if (unconfirmed.length > 0) {
    return reason(
      'Eligible States',
      'warning',
      `${admittedHits.length > 0 ? `Confirmed admitted in ${admittedHits.join(', ')}, but ` : ''}availability for ${unconfirmed.join(', ')} is not confirmed — ${record.marketName} states coverage varies by state.`,
      true
    );
  }

  return reason('Eligible States', 'pass', `All relevant states (${stateList.join(', ')}) are confirmed admitted with ${record.marketName}.`);
}

export function evaluateFleetSize(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const fleetSize = profile.transportation.fleetSize.value;
  const criterion = record.fleetSize;

  if (criterion.status === 'UNKNOWN' || !criterion.value) {
    return unknownMarketReason('Fleet Size', record.marketName, 'fleet-size range');
  }
  if (fleetSize === null) {
    return reason('Fleet Size', 'warning', 'Fleet size not confirmed in the risk profile — verify before submitting.', true);
  }

  const { min = 0, max = Infinity } = criterion.value;
  const rangeText = `${min}–${Number.isFinite(max) ? max : '∞'} units`;
  if (fleetSize < min || fleetSize > max) {
    const direction = fleetSize > max ? "above this program's ceiling" : "below this program's floor";
    return reason('Fleet Size', 'fail', `${fleetSize} power units is ${direction} of ${rangeText}.`);
  }
  return reason('Fleet Size', 'pass', `${fleetSize} power units falls within ${record.marketName}'s ${rangeText}.`);
}

export function evaluateYearsInBusiness(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const years = profile.business.yearsInBusiness.value;
  const criterion = record.yearsInBusinessMin;

  if (criterion.status === 'UNKNOWN') {
    return unknownMarketReason('Years in Business', record.marketName, 'years-in-business minimum');
  }
  if (years === null) {
    return reason('Years in Business', 'warning', 'Years in business not confirmed — verify before submitting.', true);
  }
  const minYears = criterion.value ?? 0;
  if (years < minYears) {
    return reason('Years in Business', 'fail', `${years} years in operation is below ${record.marketName}'s ${minYears}-year minimum — reads as a new venture to this underwriter.`);
  }
  return reason('Years in Business', 'pass', `${years} years in operation clears the ${minYears}-year minimum.`);
}

export function evaluateOperationAndRadius(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const radiusText = profile.transportation.operatingRadius.value;
  const opType = classifyOperationType(radiusText);
  const miles = parseLeadingMiles(radiusText);

  const opCriterion = record.operationTypes;
  const radiusCriterion = record.maxRadius;
  if (opCriterion.status === 'UNKNOWN' && radiusCriterion.status === 'UNKNOWN') {
    return unknownMarketReason('Operating Radius', record.marketName, 'operation-type or radius appetite');
  }
  if (!radiusText) {
    return reason('Operating Radius', 'warning', 'Operating radius not confirmed — verify before submitting.', true);
  }
  if (opCriterion.status === 'VERIFIED' && opCriterion.value && opType && !opCriterion.value.includes(opType)) {
    return reason('Operating Radius', 'fail', `Operation type "${opType}" is outside ${record.marketName}'s verified appetite (writes ${opCriterion.value.join(', ')} only).`);
  }
  const maxMiles = radiusCriterion.status === 'VERIFIED' ? parseLeadingMiles(radiusCriterion.value ?? null) : null;
  if (miles !== null && maxMiles !== null && miles > maxMiles) {
    return reason('Operating Radius', 'fail', `${miles}-mile radius exceeds ${record.marketName}'s verified ${maxMiles}-mile maximum.`);
  }
  if (opCriterion.status === 'UNKNOWN' || radiusCriterion.status === 'UNKNOWN') {
    return reason('Operating Radius', 'warning', `${radiusText} doesn't conflict with what's verified, but ${record.marketName} hasn't published a full operation-type/radius appetite — confirm before submitting.`, true);
  }
  return reason('Operating Radius', 'pass', `${radiusText} fits within ${record.marketName}'s verified appetite.`);
}

export function evaluateCommodities(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const commodities = profile.transportation.commoditiesHauled.value ?? [];
  const criterion = record.commodities;

  if (criterion.status === 'UNKNOWN' || !criterion.value || criterion.value.length === 0) {
    return unknownMarketReason('Commodities', record.marketName, 'commodity/operations appetite');
  }
  if (commodities.length === 0) {
    return reason('Commodities', 'warning', 'Commodities hauled not confirmed — verify before submitting.', true);
  }
  const lowerAccepted = criterion.value.map((c) => c.toLowerCase());
  const matched = commodities.filter((c) => lowerAccepted.includes(c.toLowerCase()));
  const unmatched = commodities.filter((c) => !lowerAccepted.includes(c.toLowerCase()));

  if (matched.length === 0) {
    return reason('Commodities', 'fail', `None of the hauled commodities (${commodities.join(', ')}) are in ${record.marketName}'s verified appetite.`);
  }
  if (unmatched.length > 0) {
    return reason(
      'Commodities',
      'warning',
      `${matched.join(', ')} ${matched.length > 1 ? 'are' : 'is'} verified in appetite, but ${unmatched.join(', ')} ${unmatched.length > 1 ? 'are' : 'is'} not — confirm whether they'll write the mixed book.`,
      true
    );
  }
  return reason('Commodities', 'pass', `All hauled commodities (${commodities.join(', ')}) sit squarely in ${record.marketName}'s verified appetite.`);
}

export function evaluateDriverRequirements(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const minAge = profile.transportation.minDriverAge.value;
  const minExp = profile.transportation.minDriverExperienceYears.value;
  const ageCriterion = record.minDriverAge;
  const expCriterion = record.minDriverExperienceYears;

  if (ageCriterion.status === 'UNKNOWN' && expCriterion.status === 'UNKNOWN') {
    return unknownMarketReason('Driver Requirements', record.marketName, 'driver age/experience minimums');
  }
  if (minAge === null && minExp === null) {
    return reason('Driver Requirements', 'warning', 'Driver age/experience not confirmed — verify before submitting.', true);
  }
  if (ageCriterion.status === 'VERIFIED' && ageCriterion.value !== null && minAge !== null && minAge < ageCriterion.value) {
    return reason('Driver Requirements', 'fail', `Youngest qualifying driver age (${minAge}) is below ${record.marketName}'s verified ${ageCriterion.value}-year-old floor.`);
  }
  if (expCriterion.status === 'VERIFIED' && expCriterion.value !== null && minExp !== null && minExp < expCriterion.value) {
    return reason('Driver Requirements', 'fail', `Minimum CDL experience on file (${minExp} yr) falls short of ${record.marketName}'s verified ${expCriterion.value}-year requirement.`);
  }
  const unknownSide = ageCriterion.status === 'UNKNOWN' || expCriterion.status === 'UNKNOWN' || minAge === null || minExp === null;
  if (unknownSide) {
    return reason('Driver Requirements', 'warning', `No conflict with what's verified, but part of ${record.marketName}'s driver requirement or the account's driver data is still unconfirmed.`, true);
  }
  return reason('Driver Requirements', 'pass', `Driver age (${minAge}) and CDL experience (${minExp} yr) clear ${record.marketName}'s verified requirements.`);
}

export function evaluateTelematics(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.telematicsRequired;
  if (criterion.status === 'UNKNOWN') {
    return unknownMarketReason('Telematics', record.marketName, 'telematics requirement');
  }
  if (criterion.value !== true) {
    return reason('Telematics', 'pass', `Telematics not required by ${record.marketName}.`);
  }
  const field = profile.transportation.telematics;
  if (field.value === null) {
    return reason('Telematics', 'warning', `${record.marketName} requires telematics, and fleet telematics status is unconfirmed — verify.`, true);
  }
  if (field.value === false) {
    return reason('Telematics', 'fail', `${record.marketName} requires telematics; the fleet does not currently have it installed.`);
  }
  return reason('Telematics', 'pass', `Telematics required by ${record.marketName} and confirmed present on the fleet.`);
}

export function evaluateDashcams(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.dashcamRequired;
  if (criterion.status === 'UNKNOWN') {
    return unknownMarketReason('Dashcams', record.marketName, 'dashcam requirement');
  }
  if (criterion.value !== true) {
    return reason('Dashcams', 'pass', `Dashcams not required by ${record.marketName}.`);
  }
  const field = profile.transportation.dashcams;
  if (field.value === null) {
    return reason('Dashcams', 'warning', `${record.marketName} requires dashcams, and dashcam status is unconfirmed — verify with the market or the account.`, true);
  }
  if (field.value === false) {
    return reason('Dashcams', 'fail', `${record.marketName} requires dashcams; the fleet does not currently have them installed.`);
  }
  return reason('Dashcams', 'pass', `Dashcams required by ${record.marketName} and confirmed present on the fleet.`);
}

/**
 * Loss experience is one of the top underwriting factors for a trucking account — evaluated
 * on claim frequency and incurred-per-unit when the market has a VERIFIED published threshold.
 * Most real markets don't publish a numeric loss threshold, so this stays UNKNOWN far more often
 * than the old fictional dataset, and correctly never fails an account on that basis alone.
 */
export function evaluateLossHistory(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const claimsCriterion = record.maxClaimsPast3Years;
  const incurredCriterion = record.maxIncurredPerUnit;
  if (claimsCriterion.status === 'UNKNOWN' && incurredCriterion.status === 'UNKNOWN') {
    return unknownMarketReason('Loss History', record.marketName, 'loss-tolerance threshold');
  }

  const losses = profile.lossHistory;
  if (losses.length === 0) {
    return reason('Loss History', 'warning', 'Loss run not yet on file — evaluate claim history once uploaded.', true);
  }

  const claimCount = losses.length;
  const totalIncurred = losses.reduce((sum, l) => sum + l.incurred, 0);
  const fleetSize = profile.transportation.fleetSize.value;
  const perUnit = fleetSize ? totalIncurred / fleetSize : null;
  const perUnitText = perUnit !== null ? ` (~${usd(perUnit)}/unit)` : '';

  if (claimsCriterion.status === 'VERIFIED' && claimsCriterion.value !== null && claimCount > claimsCriterion.value) {
    return reason('Loss History', 'fail', `${claimCount} losses on file exceed ${record.marketName}'s verified tolerance of ${claimsCriterion.value} claims over a trailing 3-year window.`);
  }
  if (incurredCriterion.status === 'VERIFIED' && incurredCriterion.value !== null && perUnit !== null && perUnit > incurredCriterion.value) {
    return reason('Loss History', 'fail', `${usd(totalIncurred)} incurred across ${claimCount} losses${perUnitText} exceeds ${record.marketName}'s verified ${usd(incurredCriterion.value)}/unit tolerance.`);
  }
  return reason('Loss History', 'pass', `${claimCount} loss${claimCount === 1 ? '' : 'es'} totaling ${usd(totalIncurred)}${perUnitText} is within ${record.marketName}'s verified loss tolerance.`);
}

export function evaluateExclusions(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.majorExclusions;
  if (criterion.status === 'UNKNOWN') {
    return unknownMarketReason('Major Exclusions', record.marketName, 'list of excluded classes');
  }
  if (!criterion.value || criterion.value.length === 0) {
    return reason('Major Exclusions', 'pass', `${record.marketName} has no verified exclusions relevant to this account.`);
  }
  const haystack = [profile.business.descriptionOfOperations.value ?? '', ...(profile.transportation.commoditiesHauled.value ?? [])].join(' ').toLowerCase();

  const triggered = criterion.value.filter((ex) => haystack.includes(ex.toLowerCase()));
  if (triggered.length > 0) {
    return reason('Major Exclusions', 'fail', `Account operations appear to fall under a verified excluded category for ${record.marketName}: ${triggered.join(', ')}.`);
  }
  return reason('Major Exclusions', 'pass', `No indication the account falls under ${record.marketName}'s verified exclusions (${criterion.value.join(', ')}).`);
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
