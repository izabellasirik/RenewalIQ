import type { AppetiteRecord, MatchReason, ReasonGroup, RiskProfile, RuleType, VerificationStatus } from '../../types';

function groupFor(status: MatchReason['status'], isDataGap?: boolean): ReasonGroup {
  if (status === 'fail') return 'failed';
  if (status === 'pass') return 'matched';
  return isDataGap ? 'needs_verification' : 'preference';
}

function reason(criterion: string, status: MatchReason['status'], explanation: string, ruleType: RuleType, isDataGap?: boolean): MatchReason {
  return { criterion, status, explanation, isDataGap, ruleType, group: groupFor(status, isDataGap) };
}

/** VERIFIED or PARTIALLY_VERIFIED evidence is usable for matching; NEEDS_CONFIRMATION/UNKNOWN are not. */
function isUsable(status: VerificationStatus): boolean {
  return status === 'VERIFIED' || status === 'PARTIALLY_VERIFIED';
}

/** A market with no usable evidence for this criterion reads as a verification gap — never a pass or a fail. */
function unknownMarketReason(criterionLabel: string, marketName: string, what: string, ruleType: RuleType): MatchReason {
  return reason(criterionLabel, 'warning', `${marketName} has no verified ${what} on file — confirm directly with the market.`, ruleType, true);
}

/**
 * Only a HARD_RULE mismatch can produce a decline. TARGET/PREFERENCE mismatches are a known,
 * non-disqualifying soft mismatch; TYPICAL_RANGE mismatches are purely descriptive and never
 * suggest ineligibility at all — both read as isDataGap:false so they land in the "preference"
 * group in the UI, not "needs verification".
 */
function ruleTypeLabel(ruleType: RuleType): string {
  if (ruleType === 'TARGET') return 'target';
  if (ruleType === 'TYPICAL_RANGE') return 'typical';
  return 'preferred';
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
  const ruleType = states.ruleType;

  if (!isUsable(states.verificationStatus) || !states.value) {
    return unknownMarketReason('Eligible States', record.marketName, 'state-eligibility list', ruleType);
  }

  const { admitted, excluded } = states.value;
  const explicitlyAdmitted = admitted ?? [];
  const stateList = [homeState, ...operatingStates].filter((s): s is string => !!s);

  if (stateList.length === 0) {
    return reason('Eligible States', 'warning', 'Domicile/operating states not confirmed on the risk profile — verify before submitting.', ruleType, true);
  }

  const excludedHits = stateList.filter((s) => excluded?.includes(s));
  if (excludedHits.length > 0) {
    const failText = `Operates in ${excludedHits.join(', ')}, which ${record.marketName} explicitly excludes.`;
    if (ruleType === 'HARD_RULE') return reason('Eligible States', 'fail', `${failText} A verified hard stop regardless of other criteria.`, ruleType);
    return reason('Eligible States', 'warning', `${failText} Published as ${ruleTypeLabel(ruleType)} guidance, not confirmed as an absolute restriction — worth confirming before submitting.`, ruleType, false);
  }

  const admittedHits = stateList.filter((s) => explicitlyAdmitted.includes(s));
  const unconfirmed = stateList.filter((s) => !explicitlyAdmitted.includes(s) && !excluded?.includes(s));

  if (explicitlyAdmitted.length === 0) {
    return reason('Eligible States', 'warning', `${record.marketName} publishes excluded states only — availability for ${stateList.join(', ')} is not otherwise confirmed.`, ruleType, true);
  }

  if (unconfirmed.length > 0) {
    return reason(
      'Eligible States',
      'warning',
      `${admittedHits.length > 0 ? `Confirmed admitted in ${admittedHits.join(', ')}, but ` : ''}availability for ${unconfirmed.join(', ')} is not confirmed — ${record.marketName} states coverage varies by state.`,
      ruleType,
      true
    );
  }

  return reason('Eligible States', 'pass', `All relevant states (${stateList.join(', ')}) are confirmed admitted with ${record.marketName}.`, ruleType);
}

export function evaluateFleetSize(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const fleetSize = profile.transportation.fleetSize.value;
  const criterion = record.fleetSize;
  const ruleType = criterion.ruleType;

  if (!isUsable(criterion.verificationStatus) || !criterion.value) {
    return unknownMarketReason('Fleet Size', record.marketName, 'fleet-size range', ruleType);
  }
  if (fleetSize === null) {
    return reason('Fleet Size', 'warning', 'Fleet size not confirmed in the risk profile — verify before submitting.', ruleType, true);
  }

  const min = criterion.value.min ?? 0;
  const max = criterion.value.max ?? Infinity;
  const rangeText = `${min}–${Number.isFinite(max) ? max : '∞'} units`;

  if (fleetSize < min || fleetSize > max) {
    const above = fleetSize > max;
    if (ruleType === 'HARD_RULE') {
      const failText = above
        ? `${fleetSize} power units exceeds ${record.marketName}'s verified maximum of ${max}.`
        : `${fleetSize} power units is below ${record.marketName}'s verified minimum of ${min}.`;
      return reason('Fleet Size', 'fail', failText, ruleType);
    }
    if (ruleType === 'TYPICAL_RANGE') {
      return reason(
        'Fleet Size',
        'warning',
        `${fleetSize} power units is outside ${record.marketName}'s published typical range of ${rangeText} — descriptive only, not a stated eligibility limit.`,
        ruleType,
        false
      );
    }
    return reason(
      'Fleet Size',
      'warning',
      `${fleetSize} power units is outside ${record.marketName}'s published ${ruleTypeLabel(ruleType)} range of ${rangeText} — not necessarily disqualifying unless confirmed as a hard limit.`,
      ruleType,
      false
    );
  }
  return reason('Fleet Size', 'pass', `${fleetSize} power units falls within ${record.marketName}'s ${rangeText}.`, ruleType);
}

export function evaluateYearsInBusiness(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const years = profile.business.yearsInBusiness.value;
  const minCriterion = record.yearsInBusinessMin;
  const maxCriterion = record.yearsInBusinessMax;
  const minUsable = isUsable(minCriterion.verificationStatus) && minCriterion.value !== null;
  const maxUsable = isUsable(maxCriterion.verificationStatus) && maxCriterion.value !== null;

  if (!minUsable && !maxUsable) {
    return unknownMarketReason('Years in Business', record.marketName, 'years-in-business requirement', minCriterion.ruleType);
  }
  if (years === null) {
    return reason('Years in Business', 'warning', 'Years in business not confirmed — verify before submitting.', maxUsable ? maxCriterion.ruleType : minCriterion.ruleType, true);
  }

  if (maxUsable && years > maxCriterion.value!) {
    const failText = `${years} years in operation exceeds ${record.marketName}'s verified new-venture ceiling of under ${maxCriterion.value} years.`;
    if (maxCriterion.ruleType === 'HARD_RULE') return reason('Years in Business', 'fail', failText, maxCriterion.ruleType);
    return reason('Years in Business', 'warning', failText, maxCriterion.ruleType, false);
  }
  if (minUsable && years < minCriterion.value!) {
    const failText = `${years} years in operation is below ${record.marketName}'s verified ${minCriterion.value}-year minimum — reads as a new venture to this underwriter.`;
    if (minCriterion.ruleType === 'HARD_RULE') return reason('Years in Business', 'fail', failText, minCriterion.ruleType);
    return reason('Years in Business', 'warning', failText, minCriterion.ruleType, false);
  }

  const parts: string[] = [];
  if (minUsable) parts.push(`clears the ${minCriterion.value}-year minimum`);
  if (maxUsable) parts.push(`stays under the ${maxCriterion.value}-year new-venture ceiling`);
  return reason('Years in Business', 'pass', `${years} years in operation ${parts.join(' and ')}.`, minUsable ? minCriterion.ruleType : maxCriterion.ruleType);
}

export function evaluateOperationAndRadius(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const radiusText = profile.transportation.operatingRadius.value;
  const opType = classifyOperationType(radiusText);
  const miles = parseLeadingMiles(radiusText);

  const opCriterion = record.operationTypes;
  const radiusCriterion = record.maxRadius;
  const opUsable = isUsable(opCriterion.verificationStatus);
  const radiusUsable = isUsable(radiusCriterion.verificationStatus);

  if (!opUsable && !radiusUsable) {
    return unknownMarketReason('Operating Radius', record.marketName, 'operation-type or radius appetite', opCriterion.ruleType);
  }
  if (!radiusText) {
    return reason('Operating Radius', 'warning', 'Operating radius not confirmed — verify before submitting.', opUsable ? opCriterion.ruleType : radiusCriterion.ruleType, true);
  }
  if (opUsable && opCriterion.value && opType && !opCriterion.value.includes(opType)) {
    const failText = `Operation type "${opType}" is outside ${record.marketName}'s published appetite (writes ${opCriterion.value.join(', ')} only).`;
    if (opCriterion.ruleType === 'HARD_RULE') return reason('Operating Radius', 'fail', failText, opCriterion.ruleType);
    return reason('Operating Radius', 'warning', failText, opCriterion.ruleType, false);
  }
  const maxMiles = radiusUsable ? parseLeadingMiles(radiusCriterion.value ?? null) : null;
  if (miles !== null && maxMiles !== null && miles > maxMiles) {
    const failText = `${miles}-mile radius exceeds ${record.marketName}'s published ${maxMiles}-mile maximum.`;
    if (radiusCriterion.ruleType === 'HARD_RULE') return reason('Operating Radius', 'fail', failText, radiusCriterion.ruleType);
    return reason('Operating Radius', 'warning', failText, radiusCriterion.ruleType, false);
  }
  if (!opUsable || !radiusUsable) {
    return reason(
      'Operating Radius',
      'warning',
      `${radiusText} doesn't conflict with what's verified, but ${record.marketName} hasn't published a full operation-type/radius appetite — confirm before submitting.`,
      opUsable ? opCriterion.ruleType : radiusCriterion.ruleType,
      true
    );
  }
  return reason('Operating Radius', 'pass', `${radiusText} fits within ${record.marketName}'s verified appetite.`, opCriterion.ruleType);
}

export function evaluateCommodities(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const commodities = profile.transportation.commoditiesHauled.value ?? [];
  const criterion = record.commodities;
  const ruleType = criterion.ruleType;

  if (!isUsable(criterion.verificationStatus) || !criterion.value || criterion.value.length === 0) {
    return unknownMarketReason('Commodities', record.marketName, 'commodity/operations appetite', ruleType);
  }
  if (commodities.length === 0) {
    return reason('Commodities', 'warning', 'Commodities hauled not confirmed — verify before submitting.', ruleType, true);
  }
  const lowerAccepted = criterion.value.map((c) => c.toLowerCase());
  const matched = commodities.filter((c) => lowerAccepted.includes(c.toLowerCase()));
  const unmatched = commodities.filter((c) => !lowerAccepted.includes(c.toLowerCase()));

  if (matched.length === 0) {
    const failText = `None of the hauled commodities (${commodities.join(', ')}) appear in ${record.marketName}'s published ${ruleTypeLabel(ruleType)} operations.`;
    if (ruleType === 'HARD_RULE') return reason('Commodities', 'fail', failText, ruleType);
    return reason('Commodities', 'warning', `${failText} Not confirmed as a hard exclusion — worth a call to the market.`, ruleType, false);
  }
  if (unmatched.length > 0) {
    return reason(
      'Commodities',
      'warning',
      `${matched.join(', ')} ${matched.length > 1 ? 'are' : 'is'} in published appetite, but ${unmatched.join(', ')} ${unmatched.length > 1 ? 'are' : 'is'} not — confirm whether they'll write the mixed book.`,
      ruleType,
      true
    );
  }
  return reason('Commodities', 'pass', `All hauled commodities (${commodities.join(', ')}) sit squarely in ${record.marketName}'s published appetite.`, ruleType);
}

export function evaluateDriverRequirements(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const minAge = profile.transportation.minDriverAge.value;
  const minExp = profile.transportation.minDriverExperienceYears.value;
  const ageCriterion = record.minDriverAge;
  const expCriterion = record.minDriverExperienceYears;
  const ageUsable = isUsable(ageCriterion.verificationStatus) && ageCriterion.value !== null;
  const expUsable = isUsable(expCriterion.verificationStatus) && expCriterion.value !== null;

  if (!ageUsable && !expUsable) {
    return unknownMarketReason('Driver Requirements', record.marketName, 'driver age/experience minimums', ageCriterion.ruleType);
  }
  if (minAge === null && minExp === null) {
    return reason(
      'Driver Requirements',
      'warning',
      `Driver CDL / experience has not been confirmed for this account${expUsable ? ` — ${record.marketName} requires ${expCriterion.value} years like-vehicle/OTR experience` : ''}.`,
      expUsable ? expCriterion.ruleType : ageCriterion.ruleType,
      true
    );
  }
  if (ageUsable && minAge !== null && minAge < ageCriterion.value!) {
    const failText = `Youngest qualifying driver age (${minAge}) is below ${record.marketName}'s verified ${ageCriterion.value}-year-old floor.`;
    if (ageCriterion.ruleType === 'HARD_RULE') return reason('Driver Requirements', 'fail', failText, ageCriterion.ruleType);
    return reason('Driver Requirements', 'warning', failText, ageCriterion.ruleType, false);
  }
  if (expUsable && minExp !== null && minExp < expCriterion.value!) {
    const failText = `Minimum CDL/OTR experience on file (${minExp} yr) falls short of ${record.marketName}'s verified ${expCriterion.value}-year requirement.`;
    if (expCriterion.ruleType === 'HARD_RULE') return reason('Driver Requirements', 'fail', failText, expCriterion.ruleType);
    return reason('Driver Requirements', 'warning', failText, expCriterion.ruleType, false);
  }
  const stillUnknownSide = (!ageUsable && ageCriterion.ruleType !== 'UNKNOWN') || (!expUsable && expCriterion.ruleType !== 'UNKNOWN') || minAge === null || minExp === null;
  if (stillUnknownSide) {
    return reason(
      'Driver Requirements',
      'warning',
      `No conflict with what's verified, but part of ${record.marketName}'s driver requirement or the account's driver data is still unconfirmed.`,
      expUsable ? expCriterion.ruleType : ageCriterion.ruleType,
      true
    );
  }
  return reason('Driver Requirements', 'pass', `Driver age (${minAge}) and CDL/OTR experience (${minExp} yr) clear ${record.marketName}'s verified requirements.`, expUsable ? expCriterion.ruleType : ageCriterion.ruleType);
}

export function evaluateDotNumberRequired(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.dotNumberRequired;
  const ruleType = criterion.ruleType;
  if (!isUsable(criterion.verificationStatus)) {
    return unknownMarketReason('DOT Number', record.marketName, 'DOT-number requirement', ruleType);
  }
  if (criterion.value !== true) {
    return reason('DOT Number', 'pass', `DOT number not required by ${record.marketName}.`, ruleType);
  }
  const dot = profile.transportation.dotNumber.value;
  if (!dot) {
    return reason('DOT Number', 'warning', `${record.marketName} requires a DOT number (or one in process); none is on file for this account yet.`, ruleType, true);
  }
  return reason('DOT Number', 'pass', `DOT number on file (${dot}) satisfies ${record.marketName}'s requirement.`, ruleType);
}

export function evaluateTelematics(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.telematicsRequired;
  const ruleType = criterion.ruleType;
  if (!isUsable(criterion.verificationStatus)) {
    return unknownMarketReason('Telematics', record.marketName, 'telematics requirement', ruleType);
  }
  if (criterion.value !== true) {
    return reason('Telematics', 'pass', `Telematics not required by ${record.marketName}.`, ruleType);
  }
  const field = profile.transportation.telematics;
  if (field.value === null) {
    return reason('Telematics', 'warning', `${record.marketName} requires telematics, and fleet telematics status is unconfirmed — verify.`, ruleType, true);
  }
  if (field.value === false) {
    const failText = `${record.marketName} requires telematics; the fleet does not currently have it installed.`;
    if (ruleType === 'HARD_RULE') return reason('Telematics', 'fail', failText, ruleType);
    return reason('Telematics', 'warning', failText, ruleType, false);
  }
  return reason('Telematics', 'pass', `Telematics required by ${record.marketName} and confirmed present on the fleet.`, ruleType);
}

export function evaluateDashcams(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.dashcamRequired;
  const ruleType = criterion.ruleType;
  if (!isUsable(criterion.verificationStatus)) {
    return unknownMarketReason('Dashcams', record.marketName, 'dashcam requirement', ruleType);
  }
  if (criterion.value !== true) {
    return reason('Dashcams', 'pass', `Dashcams not required by ${record.marketName}.`, ruleType);
  }
  const field = profile.transportation.dashcams;
  if (field.value === null) {
    return reason('Dashcams', 'warning', `${record.marketName} requires dashcams, and dashcam status is unconfirmed — verify with the market or the account.`, ruleType, true);
  }
  if (field.value === false) {
    const failText = `${record.marketName} requires dashcams; the fleet does not currently have them installed.`;
    if (ruleType === 'HARD_RULE') return reason('Dashcams', 'fail', failText, ruleType);
    return reason('Dashcams', 'warning', failText, ruleType, false);
  }
  return reason('Dashcams', 'pass', `Dashcams required by ${record.marketName} and confirmed present on the fleet.`, ruleType);
}

/**
 * Loss experience is one of the top underwriting factors for a trucking account — evaluated
 * on claim frequency and incurred-per-unit when the market has usable evidence of a published
 * threshold. Most real markets don't publish a numeric loss threshold, so this stays UNKNOWN far
 * more often than a hard rule, and correctly never fails an account on that basis alone.
 */
export function evaluateLossHistory(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const claimsCriterion = record.maxClaimsPast3Years;
  const incurredCriterion = record.maxIncurredPerUnit;
  const claimsUsable = isUsable(claimsCriterion.verificationStatus) && claimsCriterion.value !== null;
  const incurredUsable = isUsable(incurredCriterion.verificationStatus) && incurredCriterion.value !== null;
  if (!claimsUsable && !incurredUsable) {
    return unknownMarketReason('Loss History', record.marketName, 'loss-tolerance threshold', claimsCriterion.ruleType);
  }

  const losses = profile.lossHistory;
  if (losses.length === 0) {
    return reason('Loss History', 'warning', 'Loss run not yet on file — evaluate claim history once uploaded.', claimsUsable ? claimsCriterion.ruleType : incurredCriterion.ruleType, true);
  }

  const claimCount = losses.length;
  const totalIncurred = losses.reduce((sum, l) => sum + l.incurred, 0);
  const fleetSize = profile.transportation.fleetSize.value;
  const perUnit = fleetSize ? totalIncurred / fleetSize : null;
  const perUnitText = perUnit !== null ? ` (~${usd(perUnit)}/unit)` : '';

  if (claimsUsable && claimCount > claimsCriterion.value!) {
    const failText = `${claimCount} losses on file exceed ${record.marketName}'s verified tolerance of ${claimsCriterion.value} claims over a trailing 3-year window.`;
    if (claimsCriterion.ruleType === 'HARD_RULE') return reason('Loss History', 'fail', failText, claimsCriterion.ruleType);
    return reason('Loss History', 'warning', failText, claimsCriterion.ruleType, false);
  }
  if (incurredUsable && perUnit !== null && perUnit > incurredCriterion.value!) {
    const failText = `${usd(totalIncurred)} incurred across ${claimCount} losses${perUnitText} exceeds ${record.marketName}'s verified ${usd(incurredCriterion.value!)}/unit tolerance.`;
    if (incurredCriterion.ruleType === 'HARD_RULE') return reason('Loss History', 'fail', failText, incurredCriterion.ruleType);
    return reason('Loss History', 'warning', failText, incurredCriterion.ruleType, false);
  }
  return reason(
    'Loss History',
    'pass',
    `${claimCount} loss${claimCount === 1 ? '' : 'es'} totaling ${usd(totalIncurred)}${perUnitText} is within ${record.marketName}'s verified loss tolerance.`,
    claimsUsable ? claimsCriterion.ruleType : incurredCriterion.ruleType
  );
}

export function evaluateExclusions(record: AppetiteRecord, profile: RiskProfile): MatchReason {
  const criterion = record.majorExclusions;
  const ruleType = criterion.ruleType;
  if (!isUsable(criterion.verificationStatus)) {
    return unknownMarketReason('Major Exclusions', record.marketName, 'list of excluded classes', ruleType);
  }
  if (!criterion.value || criterion.value.length === 0) {
    return reason('Major Exclusions', 'pass', `${record.marketName} has no verified exclusions relevant to this account.`, ruleType);
  }
  const haystack = [profile.business.descriptionOfOperations.value ?? '', ...(profile.transportation.commoditiesHauled.value ?? [])].join(' ').toLowerCase();

  const triggered = criterion.value.filter((ex) => haystack.includes(ex.toLowerCase()));
  if (triggered.length > 0) {
    const failText = `Account operations appear to fall under a verified excluded category for ${record.marketName}: ${triggered.join(', ')}.`;
    if (ruleType === 'HARD_RULE') return reason('Major Exclusions', 'fail', failText, ruleType);
    return reason('Major Exclusions', 'warning', failText, ruleType, false);
  }
  return reason('Major Exclusions', 'pass', `No indication the account falls under ${record.marketName}'s verified exclusions (${criterion.value.join(', ')}).`, ruleType);
}

export const ALL_RULES = [
  evaluateStateEligibility,
  evaluateFleetSize,
  evaluateYearsInBusiness,
  evaluateOperationAndRadius,
  evaluateCommodities,
  evaluateDriverRequirements,
  evaluateDotNumberRequired,
  evaluateLossHistory,
  evaluateTelematics,
  evaluateDashcams,
  evaluateExclusions,
];
