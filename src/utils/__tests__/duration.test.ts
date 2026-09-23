import { describe, expect, it } from 'vitest';
import { formatDuration, fromParts, parseDurationText, toMonths } from '../duration';
import { draftToDuration, durationToDraft } from '../durationDraft';
import { evaluateDriverRequirements, evaluateYearsInBusiness } from '../../services/appetite/rules';
import { sampleAppetiteRecords } from '../../data/carriers';
import { createEmptyRiskProfile } from '../../services/extraction/emptyRiskProfile';
import { buildProfileFromFilters, EMPTY_MARKET_FINDER_FILTERS } from '../../services/appetite/marketFinderInput';
import type { AppetiteRecord, FieldValue } from '../../types';

const field = <T,>(value: T): FieldValue<T> => ({ value, confidence: 'high', isMissing: false, isConflicting: false, extractionMethod: 'manual_entry' }) as FieldValue<T>;

/** A real verified record, with its driver-experience / years-in-business minimum swapped for the test value (in years, as carrier data is stored). */
function recordWith(patch: { minExpYears?: number; yibMinYears?: number }): AppetiteRecord {
  const base = sampleAppetiteRecords.find((r) => r.minDriverExperienceYears.verificationStatus === 'VERIFIED')!;
  const verified = (value: number) => ({ ...base.minDriverExperienceYears, value, ruleType: 'HARD_RULE' as const, verificationStatus: 'VERIFIED' as const });
  return {
    ...base,
    minDriverAge: { ...base.minDriverAge, value: null, verificationStatus: 'UNKNOWN' },
    minDriverExperienceYears: patch.minExpYears !== undefined ? verified(patch.minExpYears) : base.minDriverExperienceYears,
    yearsInBusinessMin: patch.yibMinYears !== undefined ? verified(patch.yibMinYears) : base.yearsInBusinessMin,
    yearsInBusinessMax: { ...base.yearsInBusinessMax, value: null, verificationStatus: 'UNKNOWN' },
  };
}

function profileWith(exp?: unknown, yib?: unknown) {
  const p = createEmptyRiskProfile('t');
  p.transportation.minDriverAge = field(30);
  if (exp !== undefined) p.transportation.minDriverExperienceYears = field(exp as never);
  if (yib !== undefined) p.business.yearsInBusiness = field(yib as never);
  return p;
}

describe('duration storage (months)', () => {
  it('stores the examples in months', () => {
    expect(fromParts(0, 8).months).toBe(8);
    expect(fromParts(1, 0).months).toBe(12);
    expect(fromParts(1, 6).months).toBe(18);
    expect(fromParts(16, 0).months).toBe(192);
  });

  it('reads legacy plain numbers as years', () => {
    expect(toMonths(16)).toBe(192);
    expect(toMonths(2)).toBe(24);
    expect(toMonths(null)).toBeNull();
    expect(toMonths(undefined)).toBeNull();
  });

  it('formats for display', () => {
    expect(formatDuration(fromParts(0, 8))).toBe('8 months');
    expect(formatDuration(fromParts(1, 0))).toBe('1 year');
    expect(formatDuration(fromParts(1, 6))).toBe('1 year 6 months');
    expect(formatDuration(fromParts(16, 0, true))).toBe('16+ years');
    expect(formatDuration(3)).toBe('3 years'); // legacy
  });

  it('parses typed text', () => {
    expect(parseDurationText('8 months')?.months).toBe(8);
    expect(parseDurationText('1 year 2 months')?.months).toBe(14);
    expect(parseDurationText('16+ years')).toEqual({ months: 192, orMore: true });
    expect(parseDurationText('2')?.months).toBe(24);
  });

  it('round-trips the Years/Months editor', () => {
    expect(draftToDuration({ years: '1', months: '6', orMore: false })).toEqual({ months: 18 });
    expect(draftToDuration({ years: '', months: '8', orMore: false })).toEqual({ months: 8 });
    expect(draftToDuration({ years: '', months: '', orMore: false })).toBeNull();
    expect(draftToDuration({ years: '1', months: '14', orMore: false })).toBeNull();
    expect(draftToDuration(durationToDraft(16))).toEqual({ months: 192 }); // legacy years prefill
    expect(draftToDuration(durationToDraft({ months: 192, orMore: true }))).toEqual({ months: 192, orMore: true });
  });
});

describe('carrier matching in normalized months', () => {
  it('carrier minimum 8 months vs driver 1 year 2 months → eligible', () => {
    const r = evaluateDriverRequirements(recordWith({ minExpYears: 8 / 12 }), profileWith(fromParts(1, 2)));
    expect(r.status).toBe('pass');
  });

  it('carrier minimum 1 year vs driver 8 months → not eligible', () => {
    const r = evaluateDriverRequirements(recordWith({ minExpYears: 1 }), profileWith(fromParts(0, 8)));
    expect(r.status).toBe('fail');
    expect(r.explanation).toContain('8 months');
  });

  it('existing carrier records in years still work against legacy numeric accounts', () => {
    expect(evaluateDriverRequirements(recordWith({ minExpYears: 2 }), profileWith(3)).status).toBe('pass');
    expect(evaluateDriverRequirements(recordWith({ minExpYears: 2 }), profileWith(1)).status).toBe('fail');
    expect(evaluateYearsInBusiness(recordWith({ yibMinYears: 3 }), profileWith(undefined, 5)).status).toBe('pass');
    expect(evaluateYearsInBusiness(recordWith({ yibMinYears: 3 }), profileWith(undefined, 2)).status).toBe('fail');
  });

  it('years-in-business in months: 2 years 11 months is below a 3-year minimum, 3 years is not', () => {
    expect(evaluateYearsInBusiness(recordWith({ yibMinYears: 3 }), profileWith(undefined, fromParts(2, 11))).status).toBe('fail');
    expect(evaluateYearsInBusiness(recordWith({ yibMinYears: 3 }), profileWith(undefined, fromParts(3, 0))).status).toBe('pass');
  });

  it('Market Finder months-only filter builds a months duration', () => {
    const p = buildProfileFromFilters({ ...EMPTY_MARKET_FINDER_FILTERS, minDriverExperienceMonths: '6' });
    expect(toMonths(p.transportation.minDriverExperienceYears.value)).toBe(6);
    const p2 = buildProfileFromFilters({ ...EMPTY_MARKET_FINDER_FILTERS, minDriverExperienceYears: '1', minDriverExperienceMonths: '6' });
    expect(toMonths(p2.transportation.minDriverExperienceYears.value)).toBe(18);
  });
});
