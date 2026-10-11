import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import { evaluateMarket, matchAllMarkets } from '../matchingEngine';
import { evaluateRule } from '../carrierRules';
import { agencyCarrierToRecord, type AgencyCarrier } from '../agencyCarriers';
import { sampleAppetiteRecords } from '../../../data/carriers';
import type { AppetiteRecord, CarrierRule, CoverageType, MarketAccess, RiskProfile } from '../../../types';

// Synthetic markets and accounts only.
const ASOF = new Date('2026-10-11T12:00:00Z');
const set = <T,>(f: { value: T | null; isMissing: boolean }, v: T) => Object.assign(f, { value: v, isMissing: false });

function account(opts: { fleet?: number; state?: string; commodities?: string[]; coverages?: CoverageType[]; telematics?: boolean; dot?: string; radius?: string; years?: number } = {}): RiskProfile {
  const p = createEmptyRiskProfile('acct');
  if (opts.fleet !== undefined) set(p.transportation.fleetSize, opts.fleet);
  if (opts.state) set(p.business.state, opts.state);
  if (opts.commodities) set(p.transportation.commoditiesHauled, opts.commodities);
  if (opts.telematics !== undefined) set(p.transportation.telematics, opts.telematics);
  if (opts.dot) set(p.transportation.dotNumber, opts.dot);
  if (opts.radius) set(p.transportation.operatingRadius, opts.radius);
  if (opts.years !== undefined) set(p.business.yearsInBusiness, opts.years);
  p.coverage = (opts.coverages ?? []).map((type) => ({ type, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } }));
  return p;
}

let n = 0;
function rule(patch: Partial<CarrierRule>): CarrierRule {
  return { id: `r${++n}`, coverage: null, category: 'other', operator: 'text', value: null, answer: 'unknown', strength: 'soft', conditions: [], lastVerifiedAt: '2026-10-08', source: 'Underwriter (synthetic)', ...patch };
}

const ACCESS: MarketAccess = { route: 'indirect', status: 'ready', mga: 'Example MGA', wholesaler: null, paper: 'Example Paper Co', portalName: 'Example Portal', portalUrl: 'https://portal.example.com', submissionEmail: null, producerCode: null, appointment: null, appointmentNotes: null, contacts: [], source: 'Synthetic', sourceDate: '2026-10-08', verifiedAt: '2026-10-08', notes: null };

function market(rules: CarrierRule[], access: MarketAccess | undefined = ACCESS): AppetiteRecord {
  const c: AgencyCarrier = { id: 'm1', baseRecordId: null, name: 'Example Market', marketType: 'mga', availableThrough: null, website: null, contactName: null, contactEmail: null, contactPhone: null, criteria: {}, strictness: 'hard', notes: null, source: 'import', lastVerifiedAt: null, updatedAt: '2026-10-08T00:00:00Z', archivedAt: null, access, rules };
  return agencyCarrierToRecord(c, undefined, 'Test Agency');
}

const hazmatNo = (p: Partial<CarrierRule> = {}) => rule({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'no', strength: 'hard', ...p });
const fleetNo = (p: Partial<CarrierRule> = {}) => rule({ category: 'fleet_size', operator: 'gt', value: 25, answer: 'no', strength: 'hard', ...p });

describe('Carrier 102 — only a verified hard NO declines', () => {
  it('verified hard NO that applies → Not Eligible', () => {
    const r = evaluateMarket(market([hazmatNo(), fleetNo()]), account({ fleet: 5, commodities: ['Hazmat — fuel'] }));
    expect(r.verdict).toBe('not_eligible');
    expect(r.reasons.find((x) => x.status === 'fail')?.explanation).toMatch(/verified hard rule/);
  });

  it('the same NO unverified, or soft → Underwriter review, never a decline', () => {
    for (const p of [{ lastVerifiedAt: null }, { strength: 'soft' as const }]) {
      const r = evaluateMarket(market([hazmatNo(p), fleetNo(), rule({ category: 'state', operator: 'any_of', value: ['NY'], answer: 'no', strength: 'hard' })]), account({ fleet: 5, state: 'TX', commodities: ['Hazmat'] }));
      expect(r.verdict).toBe('possible_match');
      expect(r.reasons.some((x) => x.group === 'review')).toBe(true);
    }
  });

  it('UNKNOWN never means declined', () => {
    const o = evaluateRule(rule({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'unknown', strength: 'hard' }), account({ commodities: ['Hazmat'] }), ASOF);
    expect(o.status).toBe('confirm');
    expect(evaluateMarket(market([rule({ category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'unknown', strength: 'hard' })]), account({ commodities: ['Hazmat'] })).verdict).toBe('needs_more_information');
  });

  it('missing account data never declines — it asks for the data', () => {
    const r = evaluateMarket(market([hazmatNo(), fleetNo()]), account({}));
    expect(r.verdict).toBe('needs_more_information');
    expect(r.reasons.filter((x) => x.group === 'needs_verification').map((x) => x.explanation)).toEqual([expect.stringMatching(/Need commodities hauled/), expect.stringMatching(/Need fleet size/)]);
  });

  it('an empty DOT number is missing data, not "no DOT"', () => {
    expect(evaluateRule(rule({ category: 'dot_number', operator: 'missing', answer: 'no', strength: 'hard' }), account({}), ASOF).status).toBe('confirm');
    expect(evaluateRule(rule({ category: 'dot_number', operator: 'missing', answer: 'no', strength: 'hard' }), account({ dot: '1234567' }), ASOF).status).toBe('pass');
  });
});

describe('Carrier 102 — passes, referrals, YES ranges, conditions', () => {
  it('clear of verified exclusions → Likely Match', () => {
    const r = evaluateMarket(market([hazmatNo(), fleetNo(), rule({ category: 'telematics', operator: 'is_false', answer: 'no', strength: 'hard' })]), account({ fleet: 8, commodities: ['Dry van — general freight'], telematics: true }));
    expect(r.verdict).toBe('likely_match');
    expect(r.verifiedMatchCount).toBe(3);
  });

  it('an unverified pass is not enough evidence for Likely Match', () => {
    expect(evaluateMarket(market([hazmatNo({ lastVerifiedAt: null }), fleetNo({ lastVerifiedAt: null })]), account({ fleet: 8, commodities: ['Dry van'] })).verdict).toBe('needs_more_information');
  });

  it('REFERRAL → Possible Match / underwriter review', () => {
    const r = evaluateMarket(market([fleetNo(), hazmatNo(), rule({ category: 'years_in_business', operator: 'lt', value: 3, answer: 'referral', strength: 'soft' })]), account({ fleet: 4, commodities: ['Dry van'], years: 1 }));
    expect(r.verdict).toBe('possible_match');
    expect(r.reasons.find((x) => x.group === 'review')?.explanation).toMatch(/refer to the underwriter/);
  });

  it('outside a YES range is a review, never a decline', () => {
    const o = evaluateRule(rule({ category: 'fleet_size', operator: 'between', value: [1, 10], answer: 'yes', strength: 'hard' }), account({ fleet: 15 }), ASOF);
    expect(o.status).toBe('review');
  });

  it('conditions: a rule that only applies to bigger fleets is skipped for a small one', () => {
    const r = rule({ category: 'telematics', operator: 'is_false', answer: 'no', strength: 'hard', conditions: [{ category: 'fleet_size', operator: 'gt', value: 10 }] });
    expect(evaluateRule(r, account({ fleet: 5, telematics: false }), ASOF).status).toBe('not_applicable');
    expect(evaluateRule(r, account({ fleet: 20, telematics: false }), ASOF).status).toBe('fail');
    expect(evaluateRule(r, account({ telematics: false }), ASOF).status).toBe('confirm');
  });

  it('free-text and informational rules are shown, never auto-decided', () => {
    expect(evaluateRule(rule({ category: 'other', operator: 'text', value: 'MVRs for all drivers', answer: 'no', strength: 'hard' }), account({}), ASOF).status).toBe('confirm');
    const r = evaluateMarket(market([hazmatNo(), fleetNo(), rule({ category: 'other', operator: 'text', value: 'Quotes in 48h', answer: 'yes', strength: 'info' })]), account({ fleet: 3, commodities: ['Dry van'] }));
    expect(r.verdict).toBe('likely_match');
    expect(r.reasons.some((x) => x.group === 'info')).toBe(true);
  });

  it('archived rules are ignored', () => {
    expect(evaluateMarket(market([hazmatNo({ archivedAt: '2026-10-01' }), fleetNo()]), account({ fleet: 3, commodities: ['Hazmat'] })).verdict).not.toBe('not_eligible');
  });
});

describe('Carrier 102 — coverage by coverage', () => {
  const rules = [
    fleetNo(),
    hazmatNo({ coverage: 'motor_truck_cargo' }),
    rule({ category: 'coverage_offered', operator: 'offered', coverage: 'physical_damage', answer: 'no', strength: 'hard' }),
    rule({ category: 'state', operator: 'any_of', value: ['CA'], answer: 'no', strength: 'hard' }),
  ];
  const acct = account({ fleet: 6, state: 'TX', commodities: ['Hazmat'], coverages: ['auto_liability', 'motor_truck_cargo', 'physical_damage'] });

  it('each requested coverage gets its own verdict; the market shows its best', () => {
    const r = evaluateMarket(market(rules), acct);
    expect(r.coverageResults?.map((c) => `${c.coverage}:${c.verdict}`)).toEqual(['auto_liability:likely_match', 'motor_truck_cargo:not_eligible', 'physical_damage:not_eligible']);
    expect(r.verdict).toBe('likely_match');
  });
});

describe('Carrier 101 + existing appetite', () => {
  it('a market with an access route but no rules yet (unknown appetite) → Needs More Information, route kept', () => {
    const r = evaluateMarket(market([]), account({ fleet: 3, state: 'TX' }));
    expect(r.verdict).toBe('needs_more_information');
    expect(r.rulesMode).toBe(true);
    expect(r.access?.portalUrl).toBe('https://portal.example.com');
  });

  it('inactive markets are not suggested', () => {
    const inactive = market([fleetNo()], { ...ACCESS, status: 'inactive' });
    expect(matchAllMarkets([inactive, market([fleetNo()])], account({ fleet: 3 })).length).toBe(1);
  });

  it("a built-in market's verified criteria still apply with the agency's rules (never overwritten); unknown built-in criteria step aside", () => {
    const base = sampleAppetiteRecords.find((r) => r.fleetSize.ruleType === 'HARD_RULE' && r.fleetSize.verificationStatus === 'VERIFIED' && r.fleetSize.value?.max);
    expect(base).toBeTruthy();
    const c: AgencyCarrier = { id: 'm2', baseRecordId: base!.id, name: base!.marketName, marketType: base!.marketType, availableThrough: null, website: null, contactName: null, contactEmail: null, contactPhone: null, criteria: {}, strictness: 'hard', notes: null, source: 'import', lastVerifiedAt: null, updatedAt: '2026-10-08T00:00:00Z', archivedAt: null, access: ACCESS, rules: [hazmatNo()] };
    const rec = agencyCarrierToRecord(c, base, 'Test Agency');
    const tooBig = evaluateMarket(rec, account({ fleet: base!.fleetSize.value!.max! + 50, commodities: ['Dry van'] }));
    expect(tooBig.verdict).toBe('not_eligible');
    expect(tooBig.reasons.some((x) => x.marketUnknown)).toBe(false);
  });
});
