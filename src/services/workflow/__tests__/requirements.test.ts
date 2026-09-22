import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountsStore } from '../../../state/useAccountsStore';
import { deriveAccountActions } from '../nextActions';
import { carriersFor, forwardedAt, normalizeMissingItems, requirementKey } from '../requirementKey';
import { CHECKLIST_TEMPLATES, expandTemplate } from '../checklistTemplates';
import type { MissingItem } from '../../../types';

const store = () => useAccountsStore.getState();
const items = (accountId: string) => store().missingItems[accountId] ?? [];
const quotes = (accountId: string) => store().quotes[accountId] ?? [];

function newAccount(): string {
  useAccountsStore.setState({ accounts: [], missingItems: {}, quotes: {}, riskProfiles: {}, documents: {}, activityLog: {}, matchResults: {} });
  return store().createAccount('ABC Trucking', 'TX');
}

function startTruckingChecklist(accountId: string) {
  store().addMissingItems(accountId, expandTemplate(CHECKLIST_TEMPLATES[0], store().riskProfiles[accountId]));
}

function actionsFor(accountId: string) {
  const account = store().accounts.find((a) => a.id === accountId)!;
  return deriveAccountActions({ account, items: items(accountId), quotes: quotes(accountId), contacts: [] });
}

describe('requirement identity', () => {
  it('ignores case, spacing, plurals and freshness words', () => {
    expect(requirementKey({ label: 'Application' })).toBe('application');
    expect(requirementKey({ label: '  application ' })).toBe('application');
    expect(requirementKey({ label: 'Signed Application' })).toBe('application');
    expect(requirementKey({ label: 'Loss Runs' })).toBe(requirementKey({ label: 'loss run' }));
    expect(requirementKey({ label: 'Current MVR — John Smith' })).toBe(requirementKey({ label: 'MVR - john  smith' }));
    expect(requirementKey({ label: 'John Smith MVR' })).toBe('mvr|john smith');
    expect(requirementKey({ label: 'IFTA — last 4 quarters' })).toBe(requirementKey({ label: 'IFTA returns' }));
  });

  it('keeps unrecognized items separate unless their text matches', () => {
    expect(requirementKey({ label: 'Safety manual' })).not.toBe(requirementKey({ label: 'Safety program' }));
    expect(requirementKey({ label: 'Safety  Manual' })).toBe(requirementKey({ label: 'safety manual' }));
    expect(requirementKey({ label: 'App fee receipt' })).not.toBe('application');
  });
});

describe('shared checklist requirements', () => {
  let accountId: string;
  beforeEach(() => {
    accountId = newAccount();
  });

  it('1. standard Application exists → Trinity requests Application → no duplicate', () => {
    startTruckingChecklist(accountId);
    const before = items(accountId).length;
    const trinity = store().addQuote(accountId, { marketName: 'Trinity', status: 'submitted' });

    const id = store().recordCarrierRequest(accountId, trinity, { label: 'application', type: 'document' });

    expect(items(accountId)).toHaveLength(before);
    const apps = items(accountId).filter((i) => requirementKey(i) === 'application');
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(id);
    expect(apps[0].templateKey).toBe('application');
    expect(carriersFor(apps[0])).toEqual([trinity]);
    expect(quotes(accountId).find((q) => q.id === trinity)?.status).toBe('additional_info_requested');
  });

  it('2. Trinity + Progressive request Application → one row, both carriers', () => {
    const trinity = store().addQuote(accountId, { marketName: 'Trinity', status: 'submitted' });
    const progressive = store().addQuote(accountId, { marketName: 'Progressive', status: 'submitted' });

    const a = store().recordCarrierRequest(accountId, trinity, { label: 'Application', type: 'document' });
    const b = store().recordCarrierRequest(accountId, progressive, { label: 'Signed application ', type: 'document' });
    // Starting the standard checklist afterwards must not add a second Application either.
    startTruckingChecklist(accountId);

    expect(a).toBe(b);
    const apps = items(accountId).filter((i) => requirementKey(i) === 'application');
    expect(apps).toHaveLength(1);
    expect(carriersFor(apps[0]).sort()).toEqual([progressive, trinity].sort());
    // The "action required" names both carriers on one row.
    const req = actionsFor(accountId).now.find((x) => x.itemId === a && x.kind === 'action_required');
    expect(req?.title).toMatch(/Trinity, Progressive requested Application/);
  });

  it("3. two different drivers' MVRs remain separate", () => {
    const trinity = store().addQuote(accountId, { marketName: 'Trinity', status: 'submitted' });
    const john = store().recordCarrierRequest(accountId, trinity, { label: 'MVR — John Smith', type: 'document' });
    const david = store().recordCarrierRequest(accountId, trinity, { label: 'MVR — David Smith', type: 'document' });
    const johnAgain = store().recordCarrierRequest(accountId, trinity, { label: 'Current MVR - john smith', type: 'document' });

    expect(john).not.toBe(david);
    expect(johnAgain).toBe(john);
    expect(items(accountId).filter((i) => requirementKey(i).startsWith('mvr|'))).toHaveLength(2);
  });

  it('4. existing duplicate data is reconciled without losing carrier relationships', () => {
    const base = { accountId: 'acct', type: 'document' as const, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
    const legacy: MissingItem[] = [
      { ...base, id: 'item_template', label: 'Application', templateKey: 'application', status: 'missing', notes: 'I need to fill out' },
      // Legacy single-carrier rows (pre-shared model), one already requested from the client, one already sent to Progressive.
      { ...base, id: 'item_trinity', label: 'application', status: 'requested', neededByQuoteId: 'q_trinity', requestedAt: '2026-09-10T15:00:00.000Z', requestedFromContactId: 'c_john', followUpDate: '2026-09-15', createdAt: '2026-09-10T15:00:00.000Z' },
      { ...base, id: 'item_prog', label: 'Application ', status: 'received', neededByQuoteId: 'q_prog', receivedAt: '2026-09-12T10:00:00.000Z', documentId: 'doc_app', forwardedToCarrierAt: '2026-09-13T10:00:00.000Z', notes: 'Signed copy', createdAt: '2026-09-11T00:00:00.000Z' },
      { ...base, id: 'item_mvr_j', label: 'MVR — John Smith', status: 'missing', neededByQuoteId: 'q_trinity' },
      { ...base, id: 'item_mvr_d', label: 'MVR — David Smith', status: 'missing' },
    ];

    const merged = normalizeMissingItems(legacy);

    expect(merged).toHaveLength(3); // Application, John's MVR, David's MVR
    const app = merged.find((i) => requirementKey(i) === 'application')!;
    expect(app.id).toBe('item_template'); // the checklist's own row survives
    expect(carriersFor(app).sort()).toEqual(['q_prog', 'q_trinity']);
    expect(forwardedAt(app, 'q_prog')).toBe('2026-09-13T10:00:00.000Z');
    expect(forwardedAt(app, 'q_trinity')).toBeUndefined();
    expect(app.status).toBe('received');
    expect(app.receivedAt).toBe('2026-09-12T10:00:00.000Z');
    expect(app.documentId).toBe('doc_app');
    expect(app.requestedAt).toBe('2026-09-10T15:00:00.000Z');
    expect(app.requestedFromContactId).toBe('c_john');
    expect(app.notes).toContain('I need to fill out');
    expect(app.notes).toContain('Signed copy');
    expect(app.neededByQuoteId).toBeUndefined();
    expect(app.forwardedToCarrierAt).toBeUndefined();
    expect(carriersFor(merged.find((i) => i.id === 'item_mvr_j')!)).toEqual(['q_trinity']);

    // Idempotent: reconciling again changes nothing.
    expect(normalizeMissingItems(merged)).toEqual(merged);
  });

  it('4b. reconciliation leaves activity history untouched and runs on rename collisions', () => {
    const trinity = store().addQuote(accountId, { marketName: 'Trinity', status: 'submitted' });
    store().recordCarrierRequest(accountId, trinity, { label: 'Application', type: 'document' });
    const [manual] = store().addMissingItems(accountId, [{ label: 'Acord form', type: 'document' }]);
    const historyBefore = store().activityLog[accountId].length;

    store().updateMissingItem(accountId, manual, { label: 'ACORD Application' });

    const apps = items(accountId).filter((i) => requirementKey(i) === 'application');
    expect(apps).toHaveLength(1);
    expect(carriersFor(apps[0])).toEqual([trinity]);
    expect(store().activityLog[accountId].length).toBeGreaterThan(historyBefore);
  });

  it('5. receiving the shared document creates a send action for every waiting carrier', () => {
    startTruckingChecklist(accountId);
    const trinity = store().addQuote(accountId, { marketName: 'Trinity', status: 'submitted' });
    const progressive = store().addQuote(accountId, { marketName: 'Progressive', status: 'submitted' });
    const declined = store().addQuote(accountId, { marketName: 'Northland', status: 'submitted' });
    const appId = store().recordCarrierRequest(accountId, trinity, { label: 'Application', type: 'document' });
    store().recordCarrierRequest(accountId, progressive, { label: 'Application', type: 'document' });
    store().recordCarrierRequest(accountId, declined, { label: 'Application', type: 'document' });
    store().updateQuote(accountId, declined, { status: 'declined' });

    store().markItemReceived(accountId, appId);

    const send = actionsFor(accountId).now.filter((a) => a.kind === 'ready_to_send' && a.itemId === appId);
    expect(send.map((a) => a.title).sort()).toEqual(['Send Application to Progressive', 'Send Application to Trinity']);
    expect(send.map((a) => a.quoteId).sort()).toEqual([progressive, trinity].sort());

    // Sending to one carrier clears only that carrier's action and puts that quote back to waiting.
    store().markItemSentToCarrier(accountId, appId, trinity);
    const after = actionsFor(accountId).now.filter((a) => a.kind === 'ready_to_send' && a.itemId === appId);
    expect(after.map((a) => a.quoteId)).toEqual([progressive]);
    expect(quotes(accountId).find((q) => q.id === trinity)?.status).toBe('waiting_on_carrier');
    expect(quotes(accountId).find((q) => q.id === progressive)?.status).toBe('additional_info_requested');
  });
});
