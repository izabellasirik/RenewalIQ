import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FounderView, type FounderSnapshot, type SnapshotEvent } from '../founderMetrics';
import { PRODUCT_EVENT_NAMES, type ProductEventName } from '../trackEvent';

// Capture what the app records instead of calling the database.
const sent: { name: string; accountId?: string | null; metadata?: Record<string, unknown> }[] = [];
vi.mock('../trackEvent', async (original) => {
  const actual = await original<typeof import('../trackEvent')>();
  return {
    ...actual,
    trackEvent: (name: string, opts: { accountId?: string | null; metadata?: Record<string, unknown> } = {}) => void sent.push({ name, accountId: opts.accountId, metadata: opts.metadata }),
    trackAccountUpdated: (accountId: string) => void sent.push({ name: 'account_updated', accountId }),
  };
});
const { useAccountsStore } = await import('../../../state/useAccountsStore');
const store = () => useAccountsStore.getState();

describe('the database accepts every event the app sends (0070)', () => {
  it('the app’s event list and the migration’s allowed names are the same', () => {
    const sql = readFileSync(new URL('../../../../supabase/migrations/0070_founder_analytics_accuracy.sql', import.meta.url), 'utf8');
    const check = sql.slice(sql.indexOf('check (event_name in ('), sql.indexOf(')) not valid'));
    const allowed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([...PRODUCT_EVENT_NAMES].sort());
  });
});

describe('what the app records (fictional accounts)', () => {
  beforeEach(() => {
    sent.length = 0;
    useAccountsStore.setState({ accounts: [], hiddenAccounts: [], accountOwners: {}, cloudAccountIds: {}, missingItems: {}, quotes: {}, riskProfiles: {}, documents: {}, activityLog: {}, followUps: {}, currentUserId: null, currentUserEmail: null });
  });
  const names = () => sent.map((e) => e.name);

  it('one quote is counted once: Quoted, then its premium', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'submitted' });
    sent.length = 0;
    store().updateQuote(id, q, { status: 'quoted' });
    store().updateQuote(id, q, { premium: 12000 });
    expect(names().filter((n) => n === 'quote_added')).toHaveLength(1);
    expect(names()).toContain('quote_updated');
  });

  it('one quote is counted once: premium first, then Quoted', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'submitted' });
    sent.length = 0;
    store().updateQuote(id, q, { premium: 12000 });
    store().updateQuote(id, q, { status: 'quoted' });
    expect(names().filter((n) => n === 'quote_added')).toHaveLength(1);
  });

  it('notes, follow-up changes, account edits and bound policies are recorded', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    const q = store().addQuote(id, { marketName: 'Prairie Mutual (sample)', status: 'bound' });
    store().addFollowUp(id, { subject: 'Call Sam', dueDate: '2026-11-02', notes: '' });
    const fu = store().followUps[id][0].id;
    sent.length = 0;
    store().addAccountNote(id, 'Client prefers email');
    store().updateFollowUp(id, fu, { dueDate: '2026-11-05', notes: 'Rescheduled' });
    store().updateAccountInfo(id, { namedInsured: 'Lone Pine Freight Inc' });
    store().addPolicy(id, q, { kind: undefined, policyNumber: 'PN-1', carrier: 'Prairie Mutual (sample)', businessType: 'new', boundDate: '2026-10-20', netPremiumCents: 100000, taxesCents: 0, feesCents: 0 } as never);
    expect(names()).toEqual(expect.arrayContaining(['note_added', 'follow_up_updated', 'account_updated', 'policy_bound']));
    expect(sent.find((e) => e.name === 'follow_up_updated')?.metadata).toEqual({ source: 'rescheduled' });
    expect(sent.every((e) => e.accountId === id)).toBe(true);
  });

  it('Email Assistant: reviewing an email and opening a draft are recorded', () => {
    const id = store().createAccount('Lone Pine Freight LLC', 'TX');
    sent.length = 0;
    store().recordEmailReviewed(id, 'Reviewed an email');
    store().recordEmailDraftOpened(id, 'client@example.example', 'Documents');
    expect(names()).toEqual(['email_reviewed', 'email_draft_opened']);
  });
});

describe('what Founder Analytics counts', () => {
  const TO = new Date('2026-10-15T00:00:00');
  const at = (daysAgo: number) => new Date(TO.getTime() - daysAgo * 86400000 - 12 * 3600000).toISOString();
  let n = 0;
  const ev = (name: ProductEventName, userId: string, accountId: string | null, orgId: string | null, daysAgo = 1): SnapshotEvent => ({ id: `e${++n}`, name, at: at(daysAgo), userId, orgId, accountId, metadata: {} });
  const snap = (events: SnapshotEvent[]): FounderSnapshot => ({
    users: [
      { id: 'dxp1', name: 'Agent One', email: 'one@agency-d.example', orgId: 'orgD', isFounder: false, firstSeen: null, lastSeen: null },
      { id: 'dxp2', name: 'Agent Two', email: 'two@agency-d.example', orgId: 'orgD', isFounder: false, firstSeen: null, lastSeen: null },
      { id: 'other', name: 'Other Agent', email: 'x@agency-e.example', orgId: 'orgE', isFounder: false, firstSeen: null, lastSeen: null },
      { id: 'qa', name: 'QA Login', email: 'qa@agency-d.example', orgId: 'orgD', isFounder: false, isTest: true, firstSeen: null, lastSeen: null },
      { id: 'founder', name: 'Founder', email: 'anism.academy@gmail.com', orgId: 'orgF', isFounder: true, firstSeen: null, lastSeen: null },
    ],
    orgs: [
      { id: 'orgD', name: 'Agency D' },
      { id: 'orgE', name: 'Agency E' },
      { id: 'orgF', name: 'Founder Co' },
    ],
    accounts: [
      { id: 'd1', name: 'Fictional Haulers', orgId: 'orgD', createdAt: at(5), isTest: false, flag: null },
      { id: 'p1', name: 'Personal Account', orgId: null, createdAt: at(5), isTest: false, flag: null },
      { id: 'e1', name: 'Other Freight', orgId: 'orgE', createdAt: at(5), isTest: false, flag: null },
    ],
    timeSaved: [],
    events,
  });
  const view = (events: SnapshotEvent[], includeFounder = false) => new FounderView(snap(events), { from: new Date(TO.getTime() - 30 * 86400000), to: TO, accounts: 'real', includeFounder });

  it('active brokers, brokerages and quote counts match the events', () => {
    const k = view([
      ev('account_created', 'dxp1', 'd1', 'orgD'),
      ev('quote_added', 'dxp1', 'd1', 'orgD'),
      ev('quote_updated', 'dxp1', 'd1', 'orgD'),
      ev('note_added', 'dxp2', 'd1', 'orgD'),
      ev('intake_submitted', 'other', null, 'orgE'), // a client, not the broker
      ev('account_opened_on_later_day', 'other', 'e1', 'orgE'),
    ]).kpis();
    expect(k.activeBrokers).toBe(2);
    expect(k.activeBrokerages).toBe(1);
    expect(k.quotesAdded).toBe(1);
  });

  it('a client’s intake submission alone doesn’t make the broker active (but still counts as feature usage for accounts)', () => {
    const v = view([ev('intake_submitted', 'other', null, 'orgE')]);
    expect(v.kpis().activeBrokers).toBe(0);
    expect(v.featureUsage().find((f) => f.key === 'submission_intake')?.uniqueBrokers).toBe(0);
    expect(v.brokers()).toHaveLength(0);
  });

  it('agency attribution: the event’s agency, else the person’s agency (personal accounts)', () => {
    const v = view([ev('account_updated', 'dxp1', 'p1', null), ev('quote_added', 'other', 'e1', 'orgE')]);
    expect(v.orgName(v.orgOf(v.inRange[0]))).toBe('Agency D');
    expect(v.brokers().find((b) => b.userId === 'dxp1')?.brokerage).toBe('Agency D');
    expect(view([ev('note_added', 'dxp1', 'd1', 'orgD')], false).featureUsage().find((f) => f.key === 'account_updates')?.brokerages).toBe(1);
  });

  it('the founder is excluded unless included; test users are excluded from real usage and adoption', () => {
    const events = [ev('note_added', 'founder', null, 'orgF'), ev('note_added', 'qa', 'd1', 'orgD'), ev('note_added', 'dxp1', 'd1', 'orgD')];
    expect(view(events).kpis().activeBrokers).toBe(1);
    expect(view(events, true).kpis().activeBrokers).toBe(2);
    const adoption = view(events).adoption();
    expect(adoption.eligibleMembers).toBe(3); // dxp1, dxp2, other — not the founder, not the test login
  });
});
