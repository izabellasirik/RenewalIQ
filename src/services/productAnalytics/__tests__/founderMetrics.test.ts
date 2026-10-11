import { describe, expect, it } from 'vitest';
import { FounderView, groupTimeline, type FounderSnapshot, type SnapshotEvent } from '../founderMetrics';
import type { ProductEventName } from '../trackEvent';

const TO = new Date('2026-10-15T00:00:00');
const daysAgo = (d: number, h = 10) => new Date(TO.getTime() - d * 86400000 + h * 3600000 - 24 * 3600000).toISOString();
let n = 0;
const ev = (name: ProductEventName, userId: string, accountId: string | null, at: string, metadata: Record<string, unknown> = {}): SnapshotEvent => ({
  id: `e${++n}`,
  name,
  at,
  userId,
  orgId: userId === 'u3' ? 'orgB' : userId === 'founder' ? 'orgF' : 'orgA',
  accountId,
  metadata,
});

function snapshot(): FounderSnapshot {
  return {
    users: [
      { id: 'u1', name: 'Roman', email: 'roman@a.com', orgId: 'orgA', isFounder: false, firstSeen: daysAgo(13), lastSeen: daysAgo(1) },
      { id: 'u2', name: 'Denis', email: 'denis@a.com', orgId: 'orgA', isFounder: false, firstSeen: daysAgo(3), lastSeen: daysAgo(3) },
      { id: 'u3', name: 'Bea', email: 'bea@b.com', orgId: 'orgB', isFounder: false, firstSeen: daysAgo(10), lastSeen: daysAgo(10) },
      { id: 'founder', name: 'Founder', email: 'anism.academy@gmail.com', orgId: 'orgF', isFounder: true, firstSeen: daysAgo(2), lastSeen: daysAgo(2) },
    ],
    orgs: [
      { id: 'orgA', name: 'Adriatic Agency' },
      { id: 'orgB', name: 'Blue Harbor' },
      { id: 'orgF', name: 'Founder Co' },
    ],
    accounts: [
      { id: 'a1', name: 'Nova Light LLC', orgId: 'orgA', createdAt: daysAgo(13), isTest: false, flag: null },
      { id: 'a2', name: 'Harbor Freight', orgId: 'orgA', createdAt: daysAgo(3), isTest: false, flag: null },
      { id: 'a3', name: 'Blue Ridge', orgId: 'orgB', createdAt: daysAgo(10), isTest: false, flag: null },
      { id: 't1', name: 'Test Account', orgId: 'orgA', createdAt: daysAgo(2), isTest: true, flag: null },
      { id: 'f1', name: 'Founder demo', orgId: 'orgF', createdAt: daysAgo(2), isTest: false, flag: null },
    ],
    events: [
      // Roman: account a1 last week and this week (returning), lots of actions on a1 this week
      ev('account_created', 'u1', 'a1', daysAgo(13)),
      ev('document_processed', 'u1', 'a1', daysAgo(13)),
      ev('risk_profile_reviewed', 'u1', 'a1', daysAgo(9)),
      ...Array.from({ length: 10 }, (_, i) => ev('market_added', 'u1', 'a1', daysAgo(2, 9 + i / 10))),
      ev('quote_added', 'u1', 'a1', daysAgo(1)),
      ev('carrier_appetite_generated', 'u1', 'a1', daysAgo(2)),
      // Denis: a2 only re-opened this week (not "active" on its own), plus created it
      ev('account_created', 'u2', 'a2', daysAgo(16)),
      ev('account_opened_on_later_day', 'u2', 'a2', daysAgo(3)),
      ev('market_search_completed', 'u2', null, daysAgo(3), { source: 'market_finder' }),
      // Bea (other brokerage): last week only
      ev('account_imported', 'u3', 'a3', daysAgo(10)),
      ev('application_downloaded', 'u3', 'a3', daysAgo(10)),
      // Test account & founder's own testing — excluded by default
      ev('account_created', 'u1', 't1', daysAgo(2)),
      ev('application_downloaded', 'u1', 't1', daysAgo(2)),
      ev('account_created', 'founder', 'f1', daysAgo(2)),
      ev('quote_added', 'founder', 'f1', daysAgo(2)),
    ],
    timeSaved: [
      { userId: 'u1', orgId: 'orgA', accountId: 'a1', workflow: 'application', answer: '30to60', rqMinutes: 12, at: daysAgo(2) },
      { userId: 'u3', orgId: 'orgB', accountId: 'a3', workflow: 'application', answer: '60plus', rqMinutes: null, at: daysAgo(10) },
      { userId: 'u2', orgId: 'orgA', accountId: 'a2', workflow: 'application', answer: 'skipped', rqMinutes: null, at: daysAgo(3) },
      { userId: 'u1', orgId: 'orgA', accountId: 't1', workflow: 'application', answer: 'lt5', rqMinutes: 1, at: daysAgo(2) },
    ],
  };
}

const view = (over: Partial<ConstructorParameters<typeof FounderView>[1]> = {}) =>
  new FounderView(snapshot(), { from: new Date(TO.getTime() - 30 * 86400000), to: TO, accounts: 'real', includeFounder: false, ...over });

describe('Founder Analytics numbers', () => {
  it('defaults: real accounts only, the founder’s own activity left out', () => {
    const k = view().kpis();
    expect(k.activeBrokers).toBe(3); // u1, u2, u3 — not the founder
    expect(k.activeBrokerages).toBe(2);
    expect(k.newRealAccounts).toBe(3); // a1, a2, a3 — not t1 (test) or f1 (founder)
    expect(k.applicationsDownloaded).toBe(1); // a3 only; t1 is a test account
    expect(k.quotesAdded).toBe(1);
  });

  it('Weekly Active Accounts: one per real account with a workflow action that week — a re-open alone doesn’t count', () => {
    const k = view().kpis();
    expect(k.weeklyActiveAccounts).toBe(1); // a1 (12 actions) = 1; a2 was only re-opened
    expect(k.weeklyActiveAccountsLastWeek).toBe(2); // a1, a3
  });

  it('returning brokers: active this week and last week', () => {
    expect(view().kpis().returningBrokers).toBe(1); // Roman
    const r = view().retention();
    expect(r).toMatchObject({ brokersThisWeek: 2, brokersAlsoLastWeek: 1, returningPercent: 50 });
    expect(r.accountsMultipleDays, JSON.stringify(r)).toBe(1); // a1
    expect(r.accountsMultipleWeeks, JSON.stringify(r)).toBe(1);
  });

  it('Market Finder accounts are unique accounts, not search clicks', () => {
    const k = view().kpis();
    expect(k.marketFinderAccounts).toBe(1); // a1 (carrier appetite); the account-less search adds no account
    expect(k.marketFinderSearches).toBe(1);
  });

  it('feature usage counts brokers, accounts, brokerages and repeat users — not clicks', () => {
    const mq = view().featureUsage().find((f) => f.key === 'markets_quotes')!;
    expect(mq).toMatchObject({ uniqueBrokers: 1, realAccounts: 1, brokerages: 1, repeatUsers: 1 }); // 10 market adds + 1 quote = still 1 account
  });

  it('broker table and detail', () => {
    const rows = view().brokers();
    const roman = rows.find((r) => r.userId === 'u1')!;
    expect(roman).toMatchObject({ brokerage: 'Adriatic Agency', realAccounts: 1, activeThisWeek: true, returningFromPreviousWeek: true });
    expect(roman.mainFeatures[0]).toBeDefined();
    const d = view().brokerDetail('u1');
    expect(d.activeWeeks).toBeGreaterThanOrEqual(2);
    expect(d.timeline.some((t) => t.label === '10 markets added')).toBe(true);
  });

  it('workflow funnel over accounts created/imported in the range', () => {
    const f = view().funnel();
    expect(f[0]).toMatchObject({ accounts: 3, percent: 100 });
    expect(f.find((s) => s.label === 'Submission Assistant')).toMatchObject({ accounts: 1, percent: 33 });
    expect(f.find((s) => s.label === 'Quote added')).toMatchObject({ accounts: 1 });
  });

  it('filters: test accounts only / include founder / one brokerage', () => {
    expect(view({ accounts: 'test' }).kpis().newRealAccounts).toBe(1);
    expect(view({ includeFounder: true }).kpis().activeBrokers).toBe(4);
    expect(view({ orgId: 'orgB' }).kpis().activeBrokers).toBe(1);
    expect(view({ feature: 'submission_assistant' }).kpis().activeBrokers).toBe(1);
  });

  it('account timeline groups the same action on the same day', () => {
    const t = groupTimeline(view().accountDetail('a1').timeline.map((x) => ({ id: x.label, name: x.name, at: x.at, userId: x.userId, orgId: null, accountId: 'a1', metadata: {} })));
    expect(view().accountDetail('a1').timeline.map((x) => x.label)).toContain('10 markets added');
    expect(t.length).toBeGreaterThan(0);
  });

  it('time saved: estimates only — medians of answer midpoints, and saved time only where Renewal IQ time was measured', () => {
    const app = view().timeSaved().find((w) => w.workflow === 'application')!;
    expect(app.responses).toBe(2); // test account and skipped excluded from answers
    expect(app.skipped).toBe(1);
    expect(app.medianNormalMinutes).toBe((45 + 75) / 2);
    expect(app.measuredCount).toBe(1);
    expect(app.medianRqMinutes).toBe(12);
    expect(app.medianSavedMinutes).toBe(45 - 12);
  });

  describe('retention (the "multiple active days but Returned = No" bug)', () => {
    const D = 86400000;
    const to = new Date('2026-10-15T00:00:00');
    const at = (d: number) => new Date(to.getTime() - d * D - 3 * 3600000).toISOString();
    const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@x.com`, orgId: 'org', isFounder: false, firstSeen: null, lastSeen: null, ...extra });
    const e = (id: string, u: string, d: number, name: ProductEventName = 'document_uploaded'): SnapshotEvent => ({ id, name, at: at(d), userId: u, orgId: 'org', accountId: 'acc', metadata: {} });
    const make = (events: SnapshotEvent[], extra: Partial<FounderSnapshot> = {}) =>
      new FounderView(
        { events, users: [user('NEW'), user('LAPSED'), user('BACK'), user('OPENER'), user('IDLE', { role: 'agent', joinedAt: at(20) }), user('FOUNDER', { isFounder: true })], orgs: [{ id: 'org', name: 'DXP' }], accounts: [{ id: 'acc', name: 'Acc', orgId: 'org', createdAt: null, isTest: false, flag: null }], timeSaved: [], ...extra },
        { from: new Date(to.getTime() - 30 * D), to, accounts: 'real', includeFounder: false }
      );
    const events = [
      // NEW: started this week, active on 3 days — active this week, not "returning"
      e('n1', 'NEW', 1), e('n2', 'NEW', 3), e('n3', 'NEW', 5),
      // LAPSED: 4 active days two to three weeks ago, nothing this week
      e('l1', 'LAPSED', 9), e('l2', 'LAPSED', 12), e('l3', 'LAPSED', 15), e('l4', 'LAPSED', 20),
      // BACK: active last week and this week — returning
      e('b1', 'BACK', 8), e('b2', 'BACK', 2),
      // OPENER: only re-opened an account this week — not active
      e('o1', 'OPENER', 1, 'account_opened_on_later_day'), e('o2', 'OPENER', 10),
    ];

    it('separates active days, this week and returning, so none of them reads as a contradiction', () => {
      const rows = Object.fromEntries(make(events).brokers().map((r) => [r.userId, r]));
      expect(rows.NEW).toMatchObject({ activeDays: 3, daysActiveThisWeek: 3, activeThisWeek: true, returningFromPreviousWeek: false });
      expect(rows.LAPSED).toMatchObject({ activeDays: 4, daysActiveThisWeek: 0, activeThisWeek: false, returningFromPreviousWeek: false });
      expect(rows.BACK).toMatchObject({ activeDays: 2, daysActiveThisWeek: 1, activeThisWeek: true, returningFromPreviousWeek: true });
      expect(rows.OPENER).toMatchObject({ activeDays: 1, daysActiveThisWeek: 0, activeThisWeek: false });
    });

    it('re-opening an account is not activity anywhere', () => {
      const v = make(events);
      expect(v.activeBrokersIn(v.thisWeek).has('OPENER')).toBe(false);
      expect(v.kpis()).toMatchObject({ weeklyActiveBrokers: 2, returningBrokers: 1 });
    });

    it('first and most recent meaningful activity come from the database when it knows them', () => {
      const v = make(events, { users: [user('NEW', { firstMeaningful: '2026-09-01T10:00:00.000Z', lastMeaningful: at(1) })] } as Partial<FounderSnapshot>);
      const row = v.brokers().find((r) => r.userId === 'NEW')!;
      expect(row.firstActivity).toBe('2026-09-01T10:00:00.000Z');
      expect(row.lastActivity).toBe(at(1));
    });

    it('lists members who never did anything, open invitations and unaffiliated sign-ups — never the founder', () => {
      const v = make(events, {
        invitations: [{ orgId: 'org', email: 'pending@dxp.com', role: 'agent', createdAt: at(4), status: 'open' }],
        unaffiliatedSignups: 2,
      });
      const a = v.adoption();
      expect(a.complete).toBe(true);
      expect(a.notActivated.map((m) => m.userId)).toEqual(['IDLE']);
      expect(a.eligibleMembers).toBe(5); // NEW, LAPSED, BACK, OPENER, IDLE — not FOUNDER
      expect(a.activatedMembers).toBe(4);
      expect(a.invitations.map((i) => i.email)).toEqual(['pending@dxp.com']);
      expect(a.unaffiliatedSignups).toBe(2);
      expect(make(events).adoption().complete).toBe(false); // before 0047
    });
  });
});
