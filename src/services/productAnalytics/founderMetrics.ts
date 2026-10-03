import type { ProductEventName } from './trackEvent';

/**
 * Founder Analytics numbers, computed from the raw events founder_analytics_snapshot() returns
 * (0043). Pure functions — the page only renders what these return, and tests pin the definitions.
 *
 * Definitions (stated on the page too):
 * - A "week" is the 7 days ending at the end of the selected range ("this week"); "last week" is the
 *   7 days before that.
 * - Weekly Active Account: a REAL account with at least one workflow action that week (simply
 *   re-opening it doesn't count). Ten actions on one account = one active account.
 * - Returning broker: active this week AND active last week.
 * - Feature adoption counts people, accounts and brokerages — never raw clicks.
 */

export interface SnapshotEvent {
  id: string;
  name: ProductEventName;
  at: string;
  userId: string | null;
  orgId: string | null;
  accountId: string | null;
  metadata: Record<string, unknown>;
}
export interface SnapshotUser {
  id: string;
  name: string;
  email: string | null;
  orgId: string | null;
  isFounder: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
}
export interface SnapshotOrg {
  id: string;
  name: string;
}
export interface SnapshotAccount {
  id: string;
  name: string | null;
  orgId: string | null;
  createdAt: string | null;
  isTest: boolean;
  flag: 'real' | 'test' | null;
}
export interface SnapshotTimeSaved {
  userId: string;
  orgId: string | null;
  accountId: string | null;
  workflow: 'application' | 'market_research' | 'intake_import';
  answer: 'lt5' | '5to15' | '15to30' | '30to60' | '60plus' | 'skipped';
  rqMinutes: number | null;
  at: string;
}
export interface FounderSnapshot {
  events: SnapshotEvent[];
  users: SnapshotUser[];
  orgs: SnapshotOrg[];
  accounts: SnapshotAccount[];
  timeSaved: SnapshotTimeSaved[];
  truncated?: boolean;
}

export type FeatureKey =
  | 'submission_intake'
  | 'documents'
  | 'ai_extraction'
  | 'risk_profile'
  | 'submission_assistant'
  | 'market_finder'
  | 'carrier_appetite'
  | 'markets_quotes'
  | 'follow_ups';

const source = (e: SnapshotEvent) => (typeof e.metadata?.source === 'string' ? e.metadata.source : undefined);

export const FEATURES: { key: FeatureKey; label: string; matches: (e: SnapshotEvent) => boolean }[] = [
  { key: 'submission_intake', label: 'Submission Intake', matches: (e) => ['intake_link_created', 'intake_submitted', 'intake_imported', 'account_imported'].includes(e.name) },
  { key: 'documents', label: 'Documents', matches: (e) => e.name === 'document_uploaded' || e.name === 'document_processed' },
  { key: 'ai_extraction', label: 'AI Extraction', matches: (e) => e.name === 'ai_extraction_completed' },
  { key: 'risk_profile', label: 'Risk Profile', matches: (e) => ['risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed'].includes(e.name) },
  { key: 'submission_assistant', label: 'Submission Assistant', matches: (e) => e.name === 'application_reviewed' || e.name === 'application_downloaded' },
  {
    key: 'market_finder',
    label: 'Market Finder',
    matches: (e) => e.name === 'market_search_completed' || ((e.name === 'carrier_match_opened' || e.name === 'market_added_to_account') && source(e) === 'market_finder'),
  },
  {
    key: 'carrier_appetite',
    label: 'Carrier Appetite',
    matches: (e) => e.name === 'carrier_appetite_generated' || ((e.name === 'carrier_match_opened' || e.name === 'market_added_to_account') && source(e) === 'carrier_appetite'),
  },
  { key: 'markets_quotes', label: 'Markets & Quotes', matches: (e) => ['market_added', 'market_status_changed', 'quote_added', 'quote_updated'].includes(e.name) },
  { key: 'follow_ups', label: 'Follow-ups', matches: (e) => e.name === 'follow_up_created' || e.name === 'follow_up_completed' },
];

export const FUNNEL_STAGES: { label: string; events: ProductEventName[] }[] = [
  { label: 'Real account created / imported', events: ['account_created', 'account_imported'] },
  { label: 'Documents / Intake', events: ['document_uploaded', 'document_processed', 'ai_extraction_completed', 'intake_imported'] },
  { label: 'Risk Profile', events: ['risk_profile_generated', 'risk_profile_reviewed', 'risk_profile_completed'] },
  { label: 'Submission Assistant', events: ['application_reviewed', 'application_downloaded'] },
  { label: 'Market Finder / Carrier Appetite', events: ['market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account'] },
  { label: 'Market added', events: ['market_added', 'market_added_to_account'] },
  { label: 'Quote added', events: ['quote_added'] },
  { label: 'Follow-up / next action', events: ['follow_up_created', 'follow_up_completed', 'market_status_changed'] },
];

export const EVENT_LABELS: Record<ProductEventName, [string, string]> = {
  account_created: ['Account created', 'accounts created'],
  account_imported: ['Account imported', 'accounts imported'],
  account_opened_on_later_day: ['Account opened again', 'account re-opens'],
  intake_link_created: ['Intake link created', 'intake links created'],
  intake_submitted: ['Client submitted intake', 'intake submissions'],
  intake_imported: ['Intake imported', 'intakes imported'],
  document_uploaded: ['Documents uploaded', 'document uploads'],
  document_processed: ['Documents processed', 'documents processed'],
  ai_extraction_completed: ['AI extraction completed', 'AI extractions'],
  risk_profile_generated: ['Risk Profile generated', 'Risk Profiles generated'],
  risk_profile_reviewed: ['Risk Profile reviewed', 'Risk Profile reviews'],
  risk_profile_completed: ['Risk Profile completed', 'Risk Profiles completed'],
  application_reviewed: ['Application reviewed', 'application reviews'],
  application_downloaded: ['Application downloaded', 'application downloads'],
  market_search_completed: ['Market Finder search', 'Market Finder searches'],
  carrier_appetite_generated: ['Carrier Appetite generated', 'Carrier Appetite runs'],
  carrier_match_opened: ['Carrier match opened', 'carrier matches opened'],
  market_added_to_account: ['Market added from appetite research', 'markets added from research'],
  market_added: ['Market added', 'markets added'],
  market_status_changed: ['Market status changed', 'market status changes'],
  quote_added: ['Quote added', 'quotes added'],
  quote_updated: ['Quote updated', 'quote updates'],
  follow_up_created: ['Follow-up created', 'follow-ups created'],
  follow_up_completed: ['Follow-up completed', 'follow-ups completed'],
};

/** A visit, not work: doesn't make an account "active" on its own. */
const PASSIVE: ReadonlySet<ProductEventName> = new Set(['account_opened_on_later_day']);
const MARKET_RESEARCH: ReadonlySet<ProductEventName> = new Set(['market_search_completed', 'carrier_appetite_generated', 'carrier_match_opened', 'market_added_to_account']);

export interface FounderFilters {
  from: Date;
  to: Date;
  orgId?: string;
  userId?: string;
  feature?: FeatureKey;
  accounts: 'real' | 'test' | 'all';
  /** The founder's own activity — off by default so your testing doesn't inflate the numbers. */
  includeFounder: boolean;
}

const DAY = 24 * 3600 * 1000;
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Monday-based week, for "active weeks". */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return localDay(monday.toISOString());
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class FounderView {
  readonly users = new Map<string, SnapshotUser>();
  readonly orgs = new Map<string, SnapshotOrg>();
  readonly accounts = new Map<string, SnapshotAccount>();
  /** Every event that passes the filters, before the date range (used for "last week"). */
  readonly scoped: SnapshotEvent[];
  /** Scoped events inside the selected date range. */
  readonly inRange: SnapshotEvent[];
  readonly thisWeek: [number, number];
  readonly lastWeek: [number, number];

  readonly snapshot: FounderSnapshot;
  readonly filters: FounderFilters;

  constructor(snapshot: FounderSnapshot, filters: FounderFilters) {
    this.snapshot = snapshot;
    this.filters = filters;
    for (const u of snapshot.users) this.users.set(u.id, u);
    for (const o of snapshot.orgs) this.orgs.set(o.id, o);
    for (const a of snapshot.accounts) this.accounts.set(a.id, a);
    const feature = filters.feature ? FEATURES.find((f) => f.key === filters.feature) : undefined;
    this.scoped = snapshot.events.filter((e) => {
      if (!filters.includeFounder && e.userId && this.users.get(e.userId)?.isFounder) return false;
      const test = this.isTestAccount(e.accountId);
      if (filters.accounts === 'real' && test) return false;
      if (filters.accounts === 'test' && !test) return false;
      if (filters.orgId && this.orgOf(e) !== filters.orgId) return false;
      if (filters.userId && e.userId !== filters.userId) return false;
      if (feature && !feature.matches(e)) return false;
      return true;
    });
    const from = filters.from.getTime();
    const to = filters.to.getTime();
    this.inRange = this.scoped.filter((e) => {
      const t = new Date(e.at).getTime();
      return t >= from && t < to;
    });
    this.thisWeek = [to - 7 * DAY, to];
    this.lastWeek = [to - 14 * DAY, to - 7 * DAY];
  }

  isTestAccount(accountId: string | null): boolean {
    return !!accountId && !!this.accounts.get(accountId)?.isTest;
  }
  orgOf(e: Pick<SnapshotEvent, 'orgId' | 'userId'>): string | null {
    return e.orgId ?? (e.userId ? (this.users.get(e.userId)?.orgId ?? null) : null);
  }
  orgName(id: string | null): string {
    return id ? (this.orgs.get(id)?.name ?? 'Unknown brokerage') : 'Independent (no agency)';
  }
  userName(id: string | null): string {
    return id ? (this.users.get(id)?.name ?? 'Unknown user') : 'Unknown user';
  }
  accountName(id: string): string {
    return this.accounts.get(id)?.name ?? 'Account (not saved to the cloud)';
  }

  private between(events: SnapshotEvent[], [a, b]: [number, number]) {
    return events.filter((e) => {
      const t = new Date(e.at).getTime();
      return t >= a && t < b;
    });
  }
  private distinct<T>(xs: (T | null | undefined)[]): Set<T> {
    return new Set(xs.filter((x): x is T => x !== null && x !== undefined));
  }

  /** Real accounts with at least one workflow action in [a, b). */
  activeAccounts(window: [number, number]): Set<string> {
    return this.distinct(this.between(this.scoped, window).filter((e) => !PASSIVE.has(e.name)).map((e) => e.accountId));
  }
  activeBrokersIn(window: [number, number]): Set<string> {
    return this.distinct(this.between(this.scoped, window).map((e) => e.userId));
  }

  kpis() {
    const r = this.inRange;
    const accountsWith = (names: ProductEventName[]) => this.distinct(r.filter((e) => names.includes(e.name)).map((e) => e.accountId)).size;
    const count = (name: ProductEventName) => r.filter((e) => e.name === name).length;
    const thisWeekBrokers = this.activeBrokersIn(this.thisWeek);
    const lastWeekBrokers = this.activeBrokersIn(this.lastWeek);
    return {
      activeBrokerages: this.distinct(r.map((e) => this.orgOf(e) ?? (e.userId ? `user:${e.userId}` : null))).size,
      activeBrokers: this.distinct(r.map((e) => e.userId)).size,
      weeklyActiveAccounts: this.activeAccounts(this.thisWeek).size,
      weeklyActiveAccountsLastWeek: this.activeAccounts(this.lastWeek).size,
      newRealAccounts: accountsWith(['account_created', 'account_imported']),
      returningBrokers: [...thisWeekBrokers].filter((u) => lastWeekBrokers.has(u)).length,
      marketFinderAccounts: this.distinct(r.filter((e) => MARKET_RESEARCH.has(e.name)).map((e) => e.accountId)).size,
      marketFinderSearches: count('market_search_completed'),
      applicationsReviewed: accountsWith(['application_reviewed']),
      applicationsDownloaded: accountsWith(['application_downloaded']),
      marketsAdded: count('market_added'),
      quotesAdded: count('quote_added'),
      followUpsCompleted: count('follow_up_completed'),
    };
  }

  private featuresOf(events: SnapshotEvent[]): { key: FeatureKey; label: string; weight: number }[] {
    return FEATURES.map((f) => {
      const evs = events.filter(f.matches);
      // Adoption weight: distinct accounts (or days, for account-less use) — never raw clicks.
      const weight = Math.max(this.distinct(evs.map((e) => e.accountId)).size, this.distinct(evs.map((e) => localDay(e.at))).size);
      return { key: f.key, label: f.label, weight };
    })
      .filter((f) => f.weight > 0)
      .sort((a, b) => b.weight - a.weight);
  }

  brokers() {
    const byUser = new Map<string, SnapshotEvent[]>();
    for (const e of this.inRange) if (e.userId) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
    const lastWeekBrokers = this.activeBrokersIn(this.lastWeek);
    const thisWeekBrokers = this.activeBrokersIn(this.thisWeek);
    return [...byUser.entries()]
      .map(([userId, evs]) => {
        const user = this.users.get(userId);
        const lastActive = evs.reduce((m, e) => (e.at > m ? e.at : m), '');
        const earlierThanThisWeek = this.scoped.some((e) => e.userId === userId && new Date(e.at).getTime() < this.thisWeek[0]) || (!!user?.firstSeen && new Date(user.firstSeen).getTime() < this.thisWeek[0]);
        return {
          userId,
          name: this.userName(userId),
          email: user?.email ?? null,
          brokerage: this.orgName(user?.orgId ?? this.orgOf(evs[0])),
          realAccounts: this.distinct(evs.map((e) => e.accountId)).size,
          activeDays: this.distinct(evs.map((e) => localDay(e.at))).size,
          lastActive,
          mainFeatures: this.featuresOf(evs).slice(0, 3).map((f) => f.label),
          returnedThisWeek: thisWeekBrokers.has(userId) && (lastWeekBrokers.has(userId) || earlierThanThisWeek),
        };
      })
      .sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));
  }

  brokerDetail(userId: string) {
    const user = this.users.get(userId);
    const all = this.scoped.filter((e) => e.userId === userId);
    const evs = this.inRange.filter((e) => e.userId === userId);
    const weeks = [...this.distinct(all.map((e) => weekKey(e.at)))].sort();
    const firstWeek = weeks[0];
    const nextWeek = firstWeek ? weekKey(new Date(new Date(firstWeek).getTime() + 7 * DAY + 12 * 3600 * 1000).toISOString()) : null;
    return {
      userId,
      name: this.userName(userId),
      email: user?.email ?? null,
      brokerage: this.orgName(user?.orgId ?? null),
      firstActive: user?.firstSeen ?? all[0]?.at ?? null,
      lastActive: user?.lastSeen ?? all[all.length - 1]?.at ?? null,
      activeDays: this.distinct(evs.map((e) => localDay(e.at))).size,
      activeWeeks: this.distinct(evs.map((e) => weekKey(e.at))).size,
      realAccounts: [...this.distinct(evs.map((e) => e.accountId))],
      features: this.featuresOf(evs),
      actions: evs.length,
      returnedFollowingWeek: nextWeek ? weeks.includes(nextWeek) : false,
      timeline: groupTimeline([...evs].reverse().slice(0, 200)),
    };
  }

  accountDetail(accountId: string) {
    const evs = this.scoped.filter((e) => e.accountId === accountId);
    const acct = this.accounts.get(accountId);
    const stages = FUNNEL_STAGES.map((s) => evs.some((e) => s.events.includes(e.name)));
    return {
      accountId,
      name: this.accountName(accountId),
      brokerage: this.orgName(acct?.orgId ?? (evs[0] ? this.orgOf(evs[0]) : null)),
      brokers: [...this.distinct(evs.map((e) => e.userId))].map((u) => this.userName(u)),
      isTest: !!acct?.isTest,
      flag: acct?.flag ?? null,
      activeDays: this.distinct(evs.map((e) => localDay(e.at))).size,
      stageReached: stages.lastIndexOf(true),
      timeline: groupTimeline(evs),
    };
  }

  /** Real accounts worked in the range, newest activity first. */
  accountsWorked() {
    const byAccount = new Map<string, SnapshotEvent[]>();
    for (const e of this.inRange) if (e.accountId) byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);
    return [...byAccount.entries()]
      .map(([accountId, evs]) => {
        const stages = FUNNEL_STAGES.map((s) => this.scoped.some((e) => e.accountId === accountId && s.events.includes(e.name)));
        return {
          accountId,
          name: this.accountName(accountId),
          brokerage: this.orgName(this.accounts.get(accountId)?.orgId ?? this.orgOf(evs[0])),
          brokers: [...this.distinct(evs.map((e) => e.userId))].map((u) => this.userName(u)),
          isTest: this.isTestAccount(accountId),
          lastActive: evs.reduce((m, e) => (e.at > m ? e.at : m), ''),
          stage: FUNNEL_STAGES[Math.max(0, stages.lastIndexOf(true))].label,
        };
      })
      .sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));
  }

  featureUsage() {
    return FEATURES.map((f) => {
      const evs = this.inRange.filter(f.matches);
      const daysByUser = new Map<string, Set<string>>();
      for (const e of evs) if (e.userId) daysByUser.set(e.userId, (daysByUser.get(e.userId) ?? new Set()).add(localDay(e.at)));
      return {
        key: f.key,
        label: f.label,
        uniqueBrokers: daysByUser.size,
        realAccounts: this.distinct(evs.map((e) => e.accountId)).size,
        brokerages: this.distinct(evs.map((e) => this.orgOf(e) ?? (e.userId ? `user:${e.userId}` : null))).size,
        repeatUsers: [...daysByUser.values()].filter((d) => d.size >= 2).length,
      };
    });
  }

  /** Accounts created or imported in the range, and how far each got (by the end of the range). */
  funnel() {
    const cohort = this.distinct(this.inRange.filter((e) => FUNNEL_STAGES[0].events.includes(e.name)).map((e) => e.accountId));
    const total = cohort.size;
    return FUNNEL_STAGES.map((stage, i) => {
      const reached = i === 0 ? total : [...cohort].filter((a) => this.scoped.some((e) => e.accountId === a && stage.events.includes(e.name) && new Date(e.at).getTime() < this.filters.to.getTime())).length;
      return { label: stage.label, accounts: reached, percent: total ? Math.round((reached / total) * 100) : 0 };
    });
  }

  retention() {
    const thisWeek = this.activeBrokersIn(this.thisWeek);
    const lastWeek = this.activeBrokersIn(this.lastWeek);
    const returning = [...thisWeek].filter((u) => lastWeek.has(u)).length;
    const daysByAccount = new Map<string, Set<string>>();
    const weeksByAccount = new Map<string, Set<string>>();
    for (const e of this.inRange) {
      if (!e.accountId || PASSIVE.has(e.name)) continue;
      daysByAccount.set(e.accountId, (daysByAccount.get(e.accountId) ?? new Set()).add(localDay(e.at)));
      weeksByAccount.set(e.accountId, (weeksByAccount.get(e.accountId) ?? new Set()).add(weekKey(e.at)));
    }
    return {
      brokersThisWeek: thisWeek.size,
      brokersAlsoLastWeek: returning,
      returningPercent: thisWeek.size ? Math.round((returning / thisWeek.size) * 100) : 0,
      accountsMultipleDays: [...daysByAccount.values()].filter((d) => d.size >= 2).length,
      accountsMultipleWeeks: [...weeksByAccount.values()].filter((w) => w.size >= 2).length,
      accountsWorked: daysByAccount.size,
    };
  }

  /** Answers are estimates: bucket midpoints, and Renewal IQ time only where it was measured. */
  timeSaved() {
    const from = this.filters.from.getTime();
    const to = this.filters.to.getTime();
    const rows = this.snapshot.timeSaved.filter((t) => {
      const at = new Date(t.at).getTime();
      if (at < from || at >= to) return false;
      if (!this.filters.includeFounder && this.users.get(t.userId)?.isFounder) return false;
      const test = this.isTestAccount(t.accountId);
      if (this.filters.accounts === 'real' && test) return false;
      if (this.filters.accounts === 'test' && !test) return false;
      if (this.filters.orgId && t.orgId !== this.filters.orgId) return false;
      if (this.filters.userId && t.userId !== this.filters.userId) return false;
      return true;
    });
    const workflows: SnapshotTimeSaved['workflow'][] = ['application', 'market_research', 'intake_import'];
    return workflows.map((workflow) => {
      const answered = rows.filter((r) => r.workflow === workflow && r.answer !== 'skipped');
      const normal = answered.map((r) => BUCKET_MINUTES[r.answer as keyof typeof BUCKET_MINUTES]);
      const measured = answered.filter((r) => r.rqMinutes !== null && r.rqMinutes !== undefined);
      const saved = measured.map((r) => BUCKET_MINUTES[r.answer as keyof typeof BUCKET_MINUTES] - (r.rqMinutes as number));
      return {
        workflow,
        responses: answered.length,
        skipped: rows.filter((r) => r.workflow === workflow && r.answer === 'skipped').length,
        byAnswer: Object.fromEntries((Object.keys(BUCKET_MINUTES) as (keyof typeof BUCKET_MINUTES)[]).map((k) => [k, answered.filter((r) => r.answer === k).length])) as Record<keyof typeof BUCKET_MINUTES, number>,
        medianNormalMinutes: median(normal),
        medianRqMinutes: median(measured.map((r) => r.rqMinutes as number)),
        measuredCount: measured.length,
        medianSavedMinutes: median(saved),
      };
    });
  }
}

/** Midpoint of each answer, in minutes ("60+" counted as 75 — a conservative estimate). */
export const BUCKET_MINUTES = { lt5: 2.5, '5to15': 10, '15to30': 22.5, '30to60': 45, '60plus': 75 } as const;

/** Same day + same action collapse into one line ("Oct 2 — 3 markets added"). */
export function groupTimeline(events: SnapshotEvent[]): { day: string; at: string; name: ProductEventName; count: number; label: string; userId: string | null }[] {
  const out: { day: string; at: string; name: ProductEventName; count: number; label: string; userId: string | null }[] = [];
  for (const e of events) {
    const day = localDay(e.at);
    const last = out[out.length - 1];
    if (last && last.day === day && last.name === e.name && last.userId === e.userId) {
      last.count++;
      last.label = `${last.count} ${EVENT_LABELS[e.name][1]}`;
      continue;
    }
    out.push({ day, at: e.at, name: e.name, count: 1, label: EVENT_LABELS[e.name]?.[0] ?? e.name, userId: e.userId });
  }
  return out;
}
