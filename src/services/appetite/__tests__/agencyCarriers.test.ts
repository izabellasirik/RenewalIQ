import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import { sampleAppetiteRecords } from '../../../data/carriers';
import { evaluateMarket } from '../matchingEngine';
import { agencyCarrierToRecord, formToSavedCriteria, layerAgencyCarriers, recordToForm, type AgencyCarrier } from '../agencyCarriers';
import type { RiskProfile } from '../../../types';

function carrier(patch: Partial<AgencyCarrier> = {}): AgencyCarrier {
  return {
    id: 'c1',
    baseRecordId: null,
    name: 'Blue Ridge Mutual',
    marketType: 'direct',
    availableThrough: null,
    website: 'https://blueridge.example',
    contactName: 'Pat Underwriter',
    contactEmail: 'pat@blueridge.example',
    contactPhone: null,
    criteria: {},
    strictness: 'hard',
    notes: null,
    source: 'manual',
    lastVerifiedAt: null,
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...patch,
  };
}

function profile(fleet: number, state = 'TX', years = 5, driverExp = 3): RiskProfile {
  const p = createEmptyRiskProfile('a');
  const set = <T,>(f: { value: T | null; isMissing: boolean }, v: T) => Object.assign(f, { value: v, isMissing: false });
  set(p.transportation.fleetSize, fleet);
  set(p.business.state, state);
  set(p.business.yearsInBusiness, years);
  set(p.transportation.minDriverExperienceYears, driverExp);
  set(p.transportation.minDriverAge, 30);
  return p;
}

describe('agency carriers in Market Finder', () => {
  it('a hard fleet-size limit the admin set declines an account outside it', () => {
    const rec = agencyCarrierToRecord(carrier({ criteria: { fleetSize: { min: 1, max: 10 }, states: { admitted: ['TX'] } } }), undefined, 'My Agency');
    expect(rec.id).toBe('agency-c1');
    expect(evaluateMarket(rec, profile(25)).verdict).toBe('not_eligible');
    expect(evaluateMarket(rec, profile(5)).verdict).not.toBe('not_eligible');
    expect(rec.agencyCarrier?.contactEmail).toBe('pat@blueridge.example');
  });

  it('guidelines flag but never decline', () => {
    const rec = agencyCarrierToRecord(carrier({ strictness: 'guideline', criteria: { fleetSize: { max: 10 } } }), undefined, null);
    expect(evaluateMarket(rec, profile(25)).verdict).not.toBe('not_eligible');
  });

  it('only excluded states = every other state is written', () => {
    const rec = agencyCarrierToRecord(carrier({ criteria: { states: { excluded: ['NY'] } } }), undefined, null);
    expect(evaluateMarket(rec, profile(5, 'NY')).reasons.find((r) => r.criterion === 'Eligible States')?.status).toBe('fail');
    expect(evaluateMarket(rec, profile(5, 'TX')).reasons.find((r) => r.criterion === 'Eligible States')?.status).toBe('pass');
  });

  it('driver experience and years in business are applied', () => {
    const rec = agencyCarrierToRecord(carrier({ criteria: { minDriverExperienceYears: 5, yearsInBusinessMin: 3 } }), undefined, null);
    const r = evaluateMarket(rec, profile(5, 'TX', 1, 2));
    expect(r.reasons.find((x) => x.criterion === 'Driver Requirements')?.status).toBe('fail');
    expect(r.reasons.find((x) => x.criterion === 'Years in Business')?.status).toBe('fail');
  });

  it('layering: agency version replaces a built-in, archived hides it, custom carriers are added', () => {
    const base = sampleAppetiteRecords;
    const target = base[0];
    const edited = carrier({ id: 'e1', baseRecordId: target.id, name: `${target.marketName} (ours)`, criteria: { fleetSize: { max: 3 } } });
    const hidden = carrier({ id: 'h1', baseRecordId: base[1].id, name: base[1].marketName, archivedAt: new Date().toISOString() });
    const custom = carrier({ id: 'n1' });
    const archivedCustom = carrier({ id: 'n2', name: 'Gone Co', archivedAt: new Date().toISOString() });
    const out = layerAgencyCarriers(base, [edited, hidden, custom, archivedCustom], 'My Agency');
    expect(out.length).toBe(base.length); // -1 hidden, +1 custom
    const mine = out.find((r) => r.id === target.id)!;
    expect(mine.marketName).toBe(`${target.marketName} (ours)`);
    expect(mine.fleetSize.value).toEqual({ max: 3 });
    // Untouched criteria keep the built-in's own evidence.
    expect(mine.states).toBe(target.states);
    expect(out.some((r) => r.id === base[1].id)).toBe(false);
    expect(out.some((r) => r.id === 'agency-n1')).toBe(true);
    expect(out.some((r) => r.marketName === 'Gone Co')).toBe(false);
  });

  it('editing a built-in saves only what changed; a cleared field is saved as null', () => {
    const builtIn = sampleAppetiteRecords.find((r) => r.fleetSize.verificationStatus === 'VERIFIED' && r.fleetSize.value)!;
    const form = recordToForm(builtIn);
    expect(formToSavedCriteria(form, builtIn)).toEqual({});
    const changed = formToSavedCriteria({ ...form, driverAgeMin: '25', fleetMin: '', fleetMax: '' }, builtIn);
    expect(changed).toEqual({ minDriverAge: 25, fleetSize: null });
  });

  it('a new carrier saves only the filled-in criteria', () => {
    const form = { ...recordToForm(undefined), statesExcluded: 'ny, NJ, zz', fleetMax: '50', operationTypes: ['local' as const], maxRadiusMiles: '300', commodities: 'Dry van, Reefer' };
    expect(formToSavedCriteria(form)).toEqual({ states: { excluded: ['NJ', 'NY'] }, fleetSize: { max: 50 }, operationTypes: ['local'], maxRadius: '300 miles', commodities: ['Dry van', 'Reefer'] });
  });
});
