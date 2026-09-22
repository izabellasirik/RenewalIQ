import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountsStore } from '../../../state/useAccountsStore';

const store = () => useAccountsStore.getState();

beforeEach(() => {
  useAccountsStore.setState({ accounts: [], hiddenAccounts: [], accountOwners: {}, cloudAccountIds: {}, missingItems: {}, quotes: {}, riskProfiles: {}, documents: {}, activityLog: {}, currentUserId: null, currentUserEmail: null });
});

describe('multiple quotes per market', () => {
  it('keeps every quote, newest sets the headline premium, and a selected one overrides it', () => {
    const id = store().createAccount('ABC Trucking', 'TX');
    const q = store().addQuote(id, { marketName: 'Progressive', status: 'submitted' });
    const a = store().addQuoteOption(id, q, { label: 'Option A', premium: 18750 });
    store().addQuoteOption(id, q, { label: 'Option B', premium: 21000 });

    let quote = store().quotes[id].find((x) => x.id === q)!;
    expect(quote.options).toHaveLength(2);
    expect(quote.status).toBe('quoted');
    expect(quote.premium).toBe(21000);

    store().selectQuoteOption(id, q, a);
    quote = store().quotes[id].find((x) => x.id === q)!;
    expect(quote.premium).toBe(18750);

    store().deleteQuoteOption(id, q, a);
    quote = store().quotes[id].find((x) => x.id === q)!;
    expect(quote.options).toHaveLength(1);
    expect(quote.premium).toBe(21000);
    expect(store().activityLog[id].map((e) => e.message)).toEqual(expect.arrayContaining(['Progressive quoted $18,750 (Option A).', 'Progressive quoted $21,000 (Option B).']));
  });
});

describe('sign-out visibility', () => {
  it("hides a broker's cloud accounts when signed out and restores them for that broker only", () => {
    const local = store().createAccount('Local Only Co', 'TX');
    const cloud = store().createAccount('Cloud Co', 'TX');
    useAccountsStore.setState((s) => ({ cloudAccountIds: { ...s.cloudAccountIds, [cloud]: true }, accountOwners: { [cloud]: 'user-a' } }));

    store().setCurrentUserId(null);
    expect(store().accounts.map((a) => a.id)).toEqual([local]);
    expect(store().hiddenAccounts.map((a) => a.id)).toEqual([cloud]);

    store().setCurrentUserId('user-b', 'b@agency.com');
    expect(store().accounts.map((a) => a.id)).toEqual([local]);

    store().setCurrentUserId('user-a', 'a@agency.com');
    expect(store().accounts.map((a) => a.id).sort()).toEqual([cloud, local].sort());
    expect(store().hiddenAccounts).toHaveLength(0);
  });
});

describe('who assigned the broker', () => {
  it('records the signed-in user in the activity message', () => {
    const id = store().createAccount('ABC Trucking', 'TX');
    store().setCurrentUserId('user-a', 'anism@agency.com');
    store().setAssignedBroker(id, { name: 'Roman' });
    store().setAssignedBroker(id, { name: 'anism@agency.com', email: 'anism@agency.com' });
    const messages = store().activityLog[id].map((e) => e.message);
    expect(messages).toContain('Assigned to Roman by anism@agency.com.');
    expect(messages).toContain('Assigned to anism@agency.com (self-assigned).');
  });
});

describe('follow-ups on any open market status', () => {
  it('a Preparing market with a follow-up date is scheduled for that day, not flagged now', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const id = store().createAccount('Adriatic Test', 'TX');
    const q = store().addQuote(id, { marketName: 'Adriatic Ins Co', status: 'preparing' });
    store().updateQuote(id, q, { followUpDate: '2026-09-25' });
    const account = store().accounts.find((a) => a.id === id)!;
    const input = { account, items: [], quotes: store().quotes[id], contacts: [] };
    expect(deriveAccountActions(input, '2026-09-22').now.some((a) => a.quoteId === q)).toBe(false);
    expect(deriveAccountActions(input, '2026-09-22').upcoming.find((a) => a.quoteId === q)?.dueDate).toBe('2026-09-25');
    expect(deriveAccountActions(input, '2026-09-25').now.find((a) => a.quoteId === q)?.title).toBe('Submission to Adriatic Ins Co not sent yet');
    expect(store().activityLog[id].some((e) => e.message === 'Carrier follow-up with Adriatic Ins Co set for Sep 25.')).toBe(true);
  });
});
