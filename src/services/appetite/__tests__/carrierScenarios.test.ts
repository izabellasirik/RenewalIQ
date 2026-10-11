import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import { matchAllMarkets } from '../matchingEngine';
import { agencyCarrierToRecord, type AgencyCarrier } from '../agencyCarriers';
import type { CarrierRule, CoverageType, MarketAccess, RiskProfile, Verdict } from '../../../types';

/**
 * Five anonymized trucking accounts against six SYNTHETIC markets (fictional names and rules — no
 * real carrier's appetite). Pins how Carrier 101 + 102 work together in Market Finder.
 */

const set = <T,>(f: { value: T | null; isMissing: boolean }, v: T) => Object.assign(f, { value: v, isMissing: false });
interface Acct { state?: string; fleet?: number; commodities?: string[]; years?: number; telematics?: boolean; dot?: string; radius?: string; coverages: CoverageType[] }
function account(a: Acct): RiskProfile {
  const p = createEmptyRiskProfile('anon');
  if (a.state) set(p.business.state, a.state);
  if (a.fleet !== undefined) set(p.transportation.fleetSize, a.fleet);
  if (a.commodities) set(p.transportation.commoditiesHauled, a.commodities);
  if (a.years !== undefined) set(p.business.yearsInBusiness, a.years);
  if (a.telematics !== undefined) set(p.transportation.telematics, a.telematics);
  if (a.dot) set(p.transportation.dotNumber, a.dot);
  if (a.radius) set(p.transportation.operatingRadius, a.radius);
  p.coverage = a.coverages.map((type) => ({ type, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } }));
  return p;
}

let n = 0;
const V = '2026-10-08';
const r = (p: Partial<CarrierRule>): CarrierRule => ({ id: `s${++n}`, coverage: null, category: 'other', operator: 'text', value: null, answer: 'unknown', strength: 'soft', conditions: [], source: 'Synthetic sheet', sourceDate: V, lastVerifiedAt: V, ...p });
const access = (p: Partial<MarketAccess>): MarketAccess => ({ route: 'direct', status: 'ready', mga: null, wholesaler: null, paper: null, portalName: null, portalUrl: null, submissionEmail: null, producerCode: null, appointment: null, appointmentNotes: null, contacts: [], source: 'Synthetic sheet', sourceDate: V, verifiedAt: V, notes: null, ...p });
const market = (id: string, name: string, a: MarketAccess, rules: CarrierRule[]) =>
  agencyCarrierToRecord({ id, baseRecordId: null, name, marketType: a.route === 'indirect' ? 'mga' : 'direct', availableThrough: null, website: null, contactName: null, contactEmail: null, contactPhone: null, criteria: {}, strictness: 'hard', notes: null, source: 'import', lastVerifiedAt: null, updatedAt: `${V}T00:00:00Z`, archivedAt: null, access: a, rules } satisfies AgencyCarrier, undefined, 'Test Agency');

const MARKETS = [
  market('m1', 'Small Fleet Mutual (synthetic)', access({}), [
    r({ category: 'fleet_size', operator: 'gt', value: 25, answer: 'no', strength: 'hard' }),
    r({ category: 'commodity', operator: 'any_of', value: ['hazmat', 'explosives'], answer: 'no', strength: 'hard' }),
    r({ category: 'state', operator: 'any_of', value: ['CA', 'NY'], answer: 'no', strength: 'hard' }),
    r({ category: 'fleet_size', operator: 'between', value: [1, 25], answer: 'yes', strength: 'soft' }),
  ]),
  market('m2', 'Program X via MGA Y (synthetic)', access({ route: 'indirect', mga: 'MGA Y', wholesaler: 'Wholesaler Z', paper: 'Paper Co' }), [
    r({ category: 'years_in_business', operator: 'lt', value: 3, answer: 'referral', strength: 'soft' }),
    r({ category: 'telematics', operator: 'is_false', answer: 'no', strength: 'hard', conditions: [{ category: 'fleet_size', operator: 'gt', value: 10 }] }),
    r({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'no', strength: 'hard' }),
  ]),
  market('m3', 'Access-Only Market (synthetic)', access({ route: 'indirect', mga: 'Intermediary Q', status: 'ready', notes: 'Appetite details not published' }), []),
  market('m4', 'Cargo Specialist (synthetic)', access({ status: 'partial' }), [
    r({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'no', strength: 'hard', coverage: 'motor_truck_cargo' }),
    r({ category: 'coverage_offered', operator: 'offered', answer: 'no', strength: 'hard', coverage: 'physical_damage' }),
    r({ category: 'fleet_size', operator: 'gt', value: 50, answer: 'no', strength: 'hard' }),
    r({ category: 'state', operator: 'any_of', value: ['FL'], answer: 'no', strength: 'hard' }),
  ]),
  market('m5', 'Unverified Sheet Market (synthetic)', access({ status: 'not_ready' }), [
    r({ category: 'years_in_business', operator: 'lt', value: 2, answer: 'no', strength: 'hard', lastVerifiedAt: null }),
    r({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'unknown', strength: 'hard' }),
  ]),
  market('m6', 'Retired Market (synthetic)', access({ status: 'inactive' }), [r({ category: 'fleet_size', operator: 'gt', value: 1, answer: 'yes', strength: 'soft' })]),
];

const ACCOUNTS: Record<string, Acct> = {
  'A1 small TX dry van': { state: 'TX', fleet: 5, commodities: ['Dry van — general freight'], years: 8, telematics: true, dot: '1000001', coverages: ['auto_liability', 'motor_truck_cargo', 'physical_damage'] },
  'A2 40-unit NJ reefer': { state: 'NJ', fleet: 40, commodities: ['Refrigerated food'], years: 15, telematics: false, dot: '1000002', coverages: ['auto_liability'] },
  'A3 new venture, thin file': { state: 'GA', fleet: 1, years: 1, coverages: ['auto_liability'] },
  'A4 GA hazmat tanker': { state: 'GA', fleet: 12, commodities: ['Hazmat — fuel'], years: 10, telematics: true, dot: '1000004', coverages: ['auto_liability', 'motor_truck_cargo'] },
  'A5 CA intermodal, little data': { state: 'CA', coverages: [] },
};

const verdicts = (p: RiskProfile) => Object.fromEntries(matchAllMarkets(MARKETS, p).map((m) => [m.marketName.replace(' (synthetic)', ''), m.verdict])) as Record<string, Verdict>;

describe('five anonymized accounts × synthetic markets', () => {
  it('A1 small TX dry van', () => {
    expect(verdicts(account(ACCOUNTS['A1 small TX dry van']))).toEqual({
      'Small Fleet Mutual': 'likely_match',
      'Program X via MGA Y': 'likely_match',
      'Access-Only Market': 'needs_more_information',
      'Cargo Specialist': 'likely_match',
      'Unverified Sheet Market': 'needs_more_information', // clears only an unverified rule: not a match until verified
    });
  });

  it('A2 40-unit NJ reefer: fleet exclusion is a verified hard NO; telematics rule applies to fleets over 10', () => {
    expect(verdicts(account(ACCOUNTS['A2 40-unit NJ reefer']))).toEqual({
      'Small Fleet Mutual': 'not_eligible',
      'Program X via MGA Y': 'not_eligible',
      'Access-Only Market': 'needs_more_information',
      'Cargo Specialist': 'likely_match',
      'Unverified Sheet Market': 'needs_more_information',
    });
  });

  it('A3 new venture: referral, and an UNVERIFIED hard NO is review — never Not Eligible', () => {
    const v = verdicts(account(ACCOUNTS['A3 new venture, thin file']));
    expect(v['Program X via MGA Y']).toBe('needs_more_information'); // commodities unknown + referral
    expect(v['Unverified Sheet Market']).not.toBe('not_eligible');
    expect(Object.values(v)).not.toContain('not_eligible');
  });

  it('A4 GA hazmat tanker: cargo is out where hazmat cargo is excluded, liability can still fit', () => {
    const results = matchAllMarkets(MARKETS, account(ACCOUNTS['A4 GA hazmat tanker']));
    const cargo = results.find((m) => m.marketName.startsWith('Cargo Specialist'))!;
    expect(cargo.coverageResults?.map((c) => `${c.coverage}:${c.verdict}`)).toEqual(['auto_liability:likely_match', 'motor_truck_cargo:not_eligible']);
    expect(cargo.verdict).toBe('likely_match');
    expect(verdicts(account(ACCOUNTS['A4 GA hazmat tanker']))['Small Fleet Mutual']).toBe('not_eligible');
    expect(verdicts(account(ACCOUNTS['A4 GA hazmat tanker']))['Unverified Sheet Market']).toBe('needs_more_information'); // UNKNOWN on hazmat
  });

  it('A5 little data: nothing is declined except what the known data excludes', () => {
    const v = verdicts(account(ACCOUNTS['A5 CA intermodal, little data']));
    expect(v['Small Fleet Mutual']).toBe('not_eligible'); // CA is a verified hard state exclusion
    for (const k of ['Program X via MGA Y', 'Access-Only Market', 'Unverified Sheet Market']) expect(v[k]).toBe('needs_more_information');
  });

  it('every account: the inactive market is never suggested; access routes travel with results', () => {
    for (const a of Object.values(ACCOUNTS)) {
      const results = matchAllMarkets(MARKETS, account(a));
      expect(results.some((m) => m.marketName.startsWith('Retired'))).toBe(false);
      expect(results.find((m) => m.marketName.startsWith('Program X'))?.access?.mga).toBe('MGA Y');
    }
  });
});
