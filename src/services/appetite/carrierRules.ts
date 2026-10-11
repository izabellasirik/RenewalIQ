import type { CarrierRule, CoverageResult, CoverageType, MatchReason, RiskProfile, RulePredicate, Verdict } from '../../types';
import { COVERAGE_LABELS, RULE_ANSWER_LABELS, RULE_CATEGORY_LABELS } from '../../types';
import { toMonths, toYears } from '../../utils/duration';
import { classifyOperationType, minDriverExperienceMonths, parseLeadingMiles } from './rules';

/**
 * Carrier 102: matching an account against a market's individual underwriting rules.
 *
 * Each rule says: "for accounts where <category operator value> (and <conditions>), the market's
 * answer is YES / NO / REFERRAL / UNKNOWN", hard / soft / informational, with a source and a
 * verification date. The outcome of one rule:
 *
 *   pass      the account is clear of an exclusion, or inside what the market says YES to
 *   fail      a VERIFIED HARD NO applies — the only thing that can make a market Not Eligible
 *   review    REFERRAL, a soft NO, an unverified NO, or outside a YES — underwriter review
 *   confirm   UNKNOWN answer, or the account (or the rule) lacks what's needed to tell — never a decline
 *   info      informational — shown, not scored
 *   n/a       the rule's conditions don't hold for this account
 *
 * Nothing here invents a requirement: a market with no rules gets "Needs More Information".
 */

export type RuleOutcomeStatus = 'pass' | 'fail' | 'review' | 'confirm' | 'info' | 'not_applicable';

export interface RuleOutcome {
  rule: CarrierRule;
  status: RuleOutcomeStatus;
  explanation: string;
}

type Test = { known: false; need: string } | { known: true; matches: boolean; actual: string };

const unknown = (need: string): Test => ({ known: false, need });
const known = (matches: boolean, actual: string): Test => ({ known: true, matches, actual });
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const lc = (s: string) => s.toLowerCase();

export const isVerified = (rule: Pick<CarrierRule, 'lastVerifiedAt'>) => !!rule.lastVerifiedAt;

function compare(op: RulePredicate['operator'], actual: number, value: unknown): boolean | null {
  if (op === 'between') {
    const [min, max] = Array.isArray(value) ? value.map(Number) : [NaN, NaN];
    return Number.isFinite(min) && Number.isFinite(max) ? actual >= min && actual <= max : null;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (op === 'lt') return actual < v;
  if (op === 'lte') return actual <= v;
  if (op === 'gt') return actual > v;
  if (op === 'gte') return actual >= v;
  return null;
}

/** The predicate in words: "fleet size over 25", "commodities: hazmat, logs". */
export function describePredicate(p: RulePredicate): string {
  const label = RULE_CATEGORY_LABELS[p.category] ?? p.category;
  const v = p.value;
  switch (p.operator) {
    case 'any_of': return `${label}: ${asList(v).join(', ')}`;
    case 'lt': return `${label} under ${v}`;
    case 'lte': return `${label} ${v} or less`;
    case 'gt': return `${label} over ${v}`;
    case 'gte': return `${label} ${v} or more`;
    case 'between': return Array.isArray(v) ? `${label} ${v[0]}–${v[1]}` : label;
    case 'is_true': return `${label}: yes`;
    case 'is_false': return `${label}: none`;
    case 'missing': return `no ${label.toLowerCase()}`;
    case 'offered': return label;
    default: return typeof v === 'string' && v.trim() ? v.trim() : label;
  }
}

function numeric(p: RulePredicate, actual: number | null, need: string, show: (n: number) => string): Test {
  if (actual === null) return unknown(need);
  const m = compare(p.operator, actual, p.value);
  return m === null ? unknown('a usable rule value') : known(m, show(actual));
}

/** Does this account match the predicate? Unknown when the account doesn't say. */
export function testPredicate(p: RulePredicate, profile: RiskProfile, asOf = new Date()): Test {
  const t = profile.transportation;
  switch (p.category) {
    case 'state': {
      const states = [profile.business.state.value, ...(t.statesOfOperation.value ?? [])].filter((s): s is string => !!s).map((s) => s.toUpperCase());
      if (!states.length) return unknown('domicile / operating states');
      const want = asList(p.value).map((s) => s.toUpperCase());
      const hits = states.filter((s) => want.includes(s));
      return known(hits.length > 0, hits.length ? hits.join(', ') : [...new Set(states)].join(', '));
    }
    case 'commodity':
    case 'vehicle_type': {
      const have = p.category === 'commodity'
        ? (t.commoditiesHauled.value ?? [])
        : [...(t.vehicleTypes.value ?? []), ...profile.vehicles.map((v) => v.bodyType ?? '').filter(Boolean)];
      if (!have.length) return unknown(p.category === 'commodity' ? 'commodities hauled' : 'vehicle types');
      const want = asList(p.value).map(lc);
      const hits = have.filter((h) => want.some((w) => lc(h).includes(w) || w.includes(lc(h))));
      return known(hits.length > 0, hits.length ? hits.join(', ') : have.join(', '));
    }
    case 'operation_type': {
      const op = classifyOperationType(t.operatingRadius.value);
      if (!op) return unknown('operation type / radius');
      return known(asList(p.value).map(lc).includes(op), op.replace('_', ' '));
    }
    case 'radius_miles':
      return numeric(p, parseLeadingMiles(t.operatingRadius.value), 'operating radius in miles', (n) => `${n} miles`);
    case 'fleet_size':
      return numeric(p, t.fleetSize.value ?? (profile.vehicles.length || null), 'fleet size', (n) => `${n} units`);
    case 'years_in_business':
      return numeric(p, toYears(profile.business.yearsInBusiness.value), 'years in business', (n) => `${Math.round(n * 10) / 10} years`);
    case 'driver_age': {
      const ages = profile.drivers.map((d) => (d.dob ? ageOn(d.dob, asOf) : null)).filter((a): a is number => a !== null);
      const youngest = ages.length ? Math.min(...ages) : t.minDriverAge.value;
      return numeric(p, youngest ?? null, 'driver ages', (n) => `youngest driver ${n}`);
    }
    case 'driver_experience': {
      const months = minDriverExperienceMonths(profile).months ?? toMonths(t.minDriverExperienceYears.value);
      return numeric(p, months === null ? null : months / 12, 'driver experience', (n) => `least experienced driver ${Math.round(n * 10) / 10} years`);
    }
    case 'vehicle_age': {
      const years = profile.vehicles.map((v) => v.year).filter((y): y is number => typeof y === 'number' && y > 1900);
      return numeric(p, years.length ? asOf.getFullYear() - Math.min(...years) : null, 'vehicle years', (n) => `oldest unit ${n} years`);
    }
    case 'claims_3y': {
      if (!profile.lossHistory.length) return unknown('loss runs');
      const since = new Date(asOf); since.setFullYear(since.getFullYear() - 3);
      const n = profile.lossHistory.filter((l) => { const d = new Date(l.lossDate); return !Number.isNaN(d.getTime()) && d >= since; }).length;
      return numeric(p, n, 'loss runs', (x) => `${x} claim${x === 1 ? '' : 's'} in 3 years`);
    }
    case 'telematics':
    case 'dashcam': {
      const v = p.category === 'telematics' ? t.telematics.value : t.dashcams.value;
      if (v === null || v === undefined) return unknown(p.category === 'telematics' ? 'telematics' : 'dash cameras');
      return known(p.operator === 'is_false' ? v === false : v === true, v ? 'yes' : 'no');
    }
    case 'dot_number': {
      // An empty DOT field is missing data, not proof there is no DOT number.
      const dot = t.dotNumber.value?.trim();
      if (!dot) return unknown('DOT number');
      return known(p.operator === 'missing' ? false : true, `DOT ${dot}`);
    }
    default:
      return unknown('a check by hand');
  }
}

function ageOn(dob: string, asOf: Date): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age--;
  return age;
}

/** One rule against one account (and the coverage being matched). */
export function evaluateRule(rule: CarrierRule, profile: RiskProfile, asOf = new Date()): RuleOutcome {
  const what = describePredicate(rule);
  const said = `${RULE_ANSWER_LABELS[rule.answer]} for ${what}`;
  const out = (status: RuleOutcomeStatus, explanation: string): RuleOutcome => ({ rule, status, explanation });

  for (const c of rule.conditions ?? []) {
    const ct = testPredicate(c, profile, asOf);
    if (ct.known && !ct.matches) return out('not_applicable', `Applies only when ${describePredicate(c)}.`);
    if (!ct.known) return out(rule.strength === 'info' ? 'info' : 'confirm', `Applies when ${describePredicate(c)} — need ${ct.need} to tell. Market: ${said}.`);
  }
  if (rule.strength === 'info') return out('info', `${said}.${rule.notes ? ` ${rule.notes}` : ''}`);

  if (rule.category === 'coverage_offered') {
    const cov = rule.coverage ? COVERAGE_LABELS[rule.coverage] : 'this coverage';
    if (rule.answer === 'yes') return out('pass', `Writes ${cov}.`);
    if (rule.answer === 'unknown') return out('confirm', `Unknown whether the market writes ${cov} — confirm.`);
    if (rule.answer === 'referral') return out('review', `${cov} only by referral to the underwriter.`);
    if (rule.strength === 'hard' && isVerified(rule)) return out('fail', `Does not write ${cov} (verified).`);
    return out('review', `Reportedly does not write ${cov}${isVerified(rule) ? '' : ' (not verified)'} — confirm.`);
  }
  if (rule.category === 'other') {
    return out('confirm', `${what} — market: ${RULE_ANSWER_LABELS[rule.answer]}. Check this one by hand.`);
  }

  const t = testPredicate(rule, profile, asOf);
  if (!t.known) {
    if (rule.answer === 'unknown') return out('confirm', `Market's position on ${what} is unknown, and the account's ${t.need} isn't on file.`);
    return out('confirm', `Need ${t.need} — market: ${said}.`);
  }
  switch (rule.answer) {
    case 'no':
      if (!t.matches) return out('pass', `Clear: ${t.actual} (market: ${said}).`);
      if (rule.strength === 'hard' && isVerified(rule)) return out('fail', `${t.actual} — market: ${said} (verified hard rule).`);
      return out('review', `${t.actual} — market: ${said}${isVerified(rule) ? ' (soft rule)' : ' (not verified)'} — underwriter review.`);
    case 'referral':
      return t.matches ? out('review', `${t.actual} — ${said}: refer to the underwriter.`) : out('pass', `Clear: ${t.actual} (referral only for ${what}).`);
    case 'yes':
      return t.matches ? out('pass', `${t.actual} — market: ${said}.`) : out('review', `${t.actual} is outside what the market says YES to (${what}) — underwriter review.`);
    default:
      return t.matches ? out('confirm', `${t.actual} — market's position on ${what} is unknown; confirm.`) : out('not_applicable', `Not relevant: ${t.actual}.`);
  }
}

/** A rule outcome in Market Finder's shape (the same groups the existing reasons use, plus review/info). */
export function outcomeToReason(o: RuleOutcome): MatchReason {
  const coverage = o.rule.coverage ? ` · ${COVERAGE_LABELS[o.rule.coverage]}` : '';
  const base = {
    criterion: `${o.rule.category === 'other' ? RULE_CATEGORY_LABELS.other : o.rule.category === 'coverage_offered' ? RULE_CATEGORY_LABELS.coverage_offered : describePredicate(o.rule)}${coverage}`,
    explanation: o.explanation,
    ruleType: o.rule.strength === 'hard' && isVerified(o.rule) ? ('HARD_RULE' as const) : o.rule.strength === 'info' ? ('TYPICAL_RANGE' as const) : ('PREFERENCE' as const),
    ruleId: o.rule.id,
    ruleVerified: isVerified(o.rule),
    ruleStrength: o.rule.strength,
    ruleSource: [o.rule.source, o.rule.sourceDate].filter(Boolean).join(', ') || undefined,
  };
  switch (o.status) {
    case 'pass': return { ...base, status: 'pass', group: 'matched' };
    case 'fail': return { ...base, status: 'fail', group: 'failed' };
    case 'review': return { ...base, status: 'warning', isDataGap: false, group: 'review' };
    case 'confirm': return { ...base, status: 'warning', isDataGap: true, group: 'needs_verification' };
    default: return { ...base, status: 'warning', isDataGap: false, group: 'info' };
  }
}

/**
 * The verdict from reasons (rule outcomes plus any verified built-in criteria):
 *   any fail (verified hard)              → Not Eligible
 *   nothing scorable / nothing verified   → Needs More Information
 *   more to confirm than verified passes  → Needs More Information
 *   any review or confirm                 → Possible Match / Underwriter Review
 *   otherwise                             → Likely Match
 */
export function verdictFromReasons(reasons: MatchReason[]): Verdict {
  if (reasons.some((r) => r.status === 'fail')) return 'not_eligible';
  const scored = reasons.filter((r) => r.group !== 'info');
  const verifiedPasses = scored.filter((r) => r.status === 'pass' && r.ruleVerified !== false).length;
  const confirms = scored.filter((r) => r.group === 'needs_verification').length;
  const reviews = scored.filter((r) => r.group === 'review' || r.group === 'preference').length;
  if (scored.length === 0) return 'needs_more_information';
  if (verifiedPasses === 0) return reviews > 0 && confirms === 0 ? 'possible_match' : 'needs_more_information';
  if (confirms > verifiedPasses) return 'needs_more_information';
  if (reviews > 0 || confirms > 0) return 'possible_match';
  return 'likely_match';
}

const RANK: Record<Verdict, number> = { likely_match: 0, possible_match: 1, needs_more_information: 2, not_eligible: 3 };

/**
 * Coverage by coverage: each requested coverage gets the rules for every coverage plus its own,
 * and the reasons from the built-in criteria (`extra`). With no coverage requested, one result
 * over the rules that apply to every coverage.
 */
export function evaluateRulesByCoverage(rules: CarrierRule[], profile: RiskProfile, extra: MatchReason[] = [], asOf = new Date()): CoverageResult[] {
  const live = rules.filter((r) => !r.archivedAt);
  const requested = [...new Set(profile.coverage.map((c) => c.type))];
  const coverages: (CoverageType | null)[] = requested.length ? requested : [null];
  return coverages.map((coverage) => {
    const outcomes = live.filter((r) => r.coverage === null || r.coverage === coverage).map((r) => evaluateRule(r, profile, asOf));
    const reasons = [...extra, ...outcomes.filter((o) => o.status !== 'not_applicable').map(outcomeToReason)];
    return { coverage, verdict: verdictFromReasons(reasons), reasons };
  });
}

/** The market's overall verdict: its best coverage (each coverage is shown on its own too). */
export function bestCoverageVerdict(results: CoverageResult[]): Verdict {
  return results.reduce<Verdict>((best, r) => (RANK[r.verdict] < RANK[best] ? r.verdict : best), 'not_eligible');
}
