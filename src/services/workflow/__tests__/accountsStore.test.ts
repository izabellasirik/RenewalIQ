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

describe('one task per request email', () => {
  it('groups items requested from the same contact with the same follow-up date', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const id = store().createAccount('Blue Ridge', 'TX');
    const sara = store().addContact(id, { name: 'Sara' });
    const ids = store().addMissingItems(id, [
      { label: 'Application', type: 'document' },
      { label: 'MVR — Marcus Hill', type: 'document' },
      { label: 'MVR — Anthony Reed', type: 'document' },
      { label: 'IFTA', type: 'document' },
    ]);
    store().markItemsRequested(id, ids.slice(0, 3), { contactId: sara, followUpDate: '2026-09-25' });
    store().markItemsRequested(id, [ids[3]], { contactId: sara, followUpDate: '2026-09-28' });
    const account = store().accounts.find((a) => a.id === id)!;
    const derive = () => deriveAccountActions({ account, items: store().missingItems[id], quotes: [], contacts: [{ id: sara, name: 'Sara' }] }, '2026-09-22');

    const clientFollowUps = derive().upcoming.filter((a) => a.kind === 'client_follow_up');
    expect(clientFollowUps).toHaveLength(2);
    const group = clientFollowUps.find((a) => a.itemIds)!;
    expect(group.title).toBe('3 documents requested from Sara');
    expect(group.itemIds!.sort()).toEqual(ids.slice(0, 3).sort());

    // Rescheduling the group moves all three together (and stays one task).
    store().setItemsFollowUp(id, group.itemIds!, '2026-09-26');
    const moved = derive().upcoming.filter((a) => a.kind === 'client_follow_up' && a.itemIds);
    expect(moved).toHaveLength(1);
    expect(moved[0].dueDate).toBe('2026-09-26');
  });
});

describe('manual follow-ups', () => {
  it('shows on Today\'s Plate on its date and disappears once done', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const id = store().createAccount('Blue Ridge', 'TX');
    const fu = store().addFollowUp(id, { subject: 'Sara', dueDate: '2026-09-24', notes: 'Confirm new driver start date' });
    const account = store().accounts.find((a) => a.id === id)!;
    const derive = (today: string) => deriveAccountActions({ account, items: [], quotes: [], contacts: [], followUps: store().followUps[id] }, today);

    expect(derive('2026-09-22').upcoming.find((a) => a.followUpId === fu)?.title).toBe('Follow up: Sara');
    const due = derive('2026-09-24').now.find((a) => a.followUpId === fu)!;
    expect(due.kind).toBe('follow_up');
    expect(due.detail).toContain('Confirm new driver start date');

    store().completeFollowUp(id, fu);
    expect(derive('2026-09-24').now.some((a) => a.followUpId === fu)).toBe(false);
    expect(store().activityLog[id].map((e) => e.message)).toEqual(expect.arrayContaining(['Follow-up for Sara scheduled for Sep 24 — Confirm new driver start date.', 'Followed up: Sara.']));
  });
});

describe('new accounts start with the submission checklist', () => {
  it('a blank account gets the standard checklist right away', () => {
    const id = store().createAccount('Checklist Co', 'TX');
    expect(store().missingItems[id].map((i) => i.label)).toEqual(['Application', 'Loss Runs', 'MVRs — all drivers', 'IFTA — last 4 quarters', 'Unit List', 'Driver List']);
    expect(store().missingItems[id].every((i) => i.status === 'missing')).toBe(true);
  });

  it('documents uploaded to create the account mark their items received', async () => {
    const { createEmptyRiskProfile } = await import('../../extraction/emptyRiskProfile');
    const lossRun = { id: 'doc_lr', name: 'loss_runs.pdf', category: 'loss_run', status: 'processed', fileType: 'pdf', sizeBytes: 1, uploadedAt: '2026-09-24T00:00:00.000Z' };
    const id = store().createAccountFromExtraction('Docs Co', 'TX', [lossRun] as never, createEmptyRiskProfile('x'));
    const lr = store().missingItems[id].find((i) => i.label === 'Loss Runs')!;
    expect(lr.status).toBe('received');
    expect(lr.documentId).toBe('doc_lr');
    expect(store().missingItems[id].find((i) => i.label === 'Application')!.status).toBe('missing');
  });
});

describe('existing accounts get the checklist when opened', () => {
  const blankOld = (id: string) => {
    useAccountsStore.setState((s) => ({
      accounts: [...s.accounts, { id, namedInsured: 'Old Co', state: 'TX', status: 'new', archived: false, createdAt: '2026-09-01', updatedAt: '2026-09-01' }],
      missingItems: { ...s.missingItems, [id]: [] },
    }));
  };

  it('an old account with no checklist gets one', () => {
    blankOld('acct_old');
    store().ensureChecklist('acct_old');
    expect(store().missingItems.acct_old).toHaveLength(6);
    store().ensureChecklist('acct_old'); // idempotent
    expect(store().missingItems.acct_old).toHaveLength(6);
  });

  it('never re-adds a checklist the broker emptied', () => {
    blankOld('acct_old');
    store().ensureChecklist('acct_old');
    for (const item of [...store().missingItems.acct_old]) store().deleteMissingItem('acct_old', item.id);
    store().ensureChecklist('acct_old');
    expect(store().missingItems.acct_old).toHaveLength(0);
  });

  it("a cloud account waits until the cloud data has loaded", () => {
    blankOld('acct_cloud');
    useAccountsStore.setState({ cloudAccountIds: { acct_cloud: true }, currentUserId: 'u1', cloudHydratedFor: null });
    store().ensureChecklist('acct_cloud');
    expect(store().missingItems.acct_cloud).toHaveLength(0);
    useAccountsStore.setState({ cloudHydratedFor: 'u1', currentUserId: null }); // no cloud save in this test
    useAccountsStore.setState({ currentUserId: 'u1' });
    store().ensureChecklist('acct_cloud');
    expect(store().missingItems.acct_cloud).toHaveLength(6);
  });
});

describe('activity records who did it', () => {
  it('stamps the signed-in user on new events, and nobody when signed out', () => {
    store().setCurrentUserId('u-roman', 'roman@dxpserinc.com');
    const id = store().createAccount('Actor Co', 'TX');
    const created = store().activityLog[id].at(-1)!;
    expect(created.actorId).toBe('u-roman');
    expect(created.actorName).toBe('roman@dxpserinc.com');
    store().setCurrentUserId(null);
    const local = store().createAccount('Local Co', 'TX');
    expect(store().activityLog[local].at(-1)!.actorId).toBeUndefined();
  });
});

describe('a document that arrives as a link', () => {
  it("that can't be opened shows the clear status, keeps the URL, and extracts nothing", async () => {
    const { vi } = await import('vitest');
    const { linkAsFile, GOOGLE_LINK_UNREADABLE_MESSAGE } = await import('../../ingestion/documentLinks');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const id = store().createAccount('Link Co', 'TX');
    const before = JSON.stringify(store().riskProfiles[id]);
    const [docId] = store().addFiles(id, [linkAsFile('https://drive.google.com/file/d/xyz/view')]);
    await vi.waitFor(() => expect(store().documents[id].find((d) => d.id === docId)?.status).toBe('error'), { timeout: 10000 });
    const doc = store().documents[id].find((d) => d.id === docId)!;
    expect(doc.warnings).toEqual([GOOGLE_LINK_UNREADABLE_MESSAGE]);
    expect(doc.sourceUrl).toBe('https://drive.google.com/file/d/xyz/view');
    expect(doc.fieldsExtracted).toBeUndefined();
    expect(JSON.stringify(store().riskProfiles[id])).toBe(before);
    expect(store().activityLog[id].at(-1)?.message).toContain('Could not access the document linked');
    vi.unstubAllGlobals();
  }, 20000); // first load of the document-reading module (PDF/OCR libraries) can be slow on a busy machine
});

describe('marking a task done', () => {
  it('a renewal reminder disappears when done, logs it, and comes back for a different date', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const id = store().createAccount('Renewal Co', 'TX');
    const derive = (eff: string) => deriveAccountActions({ account: store().accounts.find((a) => a.id === id)!, items: [], quotes: [], contacts: [], effectiveDate: eff }, '2026-09-26').now;
    const renewal = derive('2026-10-13').find((a) => a.kind === 'renewal')!;
    expect(renewal.title).toBe('Renewal effective Oct 13');
    store().markActionDone(renewal);
    expect(derive('2026-10-13').some((a) => a.kind === 'renewal')).toBe(false);
    expect(store().activityLog[id].at(-1)).toMatchObject({ type: 'action_done', message: 'Marked done: Renewal effective Oct 13.' });
    expect(derive('2026-10-20').some((a) => a.kind === 'renewal')).toBe(true); // new date → new task
  });

  it('a scheduled follow-up is completed (not just hidden)', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const id = store().createAccount('FU Co', 'TX');
    store().addFollowUp(id, { subject: 'Sara', dueDate: '2026-09-26', notes: '' });
    const acct = () => store().accounts.find((a) => a.id === id)!;
    const fu = deriveAccountActions({ account: acct(), items: [], quotes: [], contacts: [], followUps: store().followUps[id] }, '2026-09-26').now.find((a) => a.kind === 'follow_up')!;
    store().markActionDone(fu);
    expect(store().followUps[id][0].doneAt).toBeTruthy();
    expect(acct().doneActions).toBeUndefined();
    store().reopenFollowUp(id, fu.followUpId!);
    expect(store().followUps[id][0].doneAt).toBeUndefined();
    expect(deriveAccountActions({ account: acct(), items: [], quotes: [], contacts: [], followUps: store().followUps[id] }, '2026-09-26').now.some((a) => a.kind === 'follow_up')).toBe(true);
  });

  it('a done task is listed as done and Undo brings it back', async () => {
    const { deriveAccountActions, deriveDoneActions } = await import('../nextActions');
    const id = store().createAccount('Undo Co', 'TX');
    const input = () => ({ account: store().accounts.find((a) => a.id === id)!, items: [], quotes: [], contacts: [], effectiveDate: '2026-10-13' });
    const renewal = deriveAccountActions(input(), '2026-09-26').now.find((a) => a.kind === 'renewal')!;
    store().markActionDone(renewal);
    const done = deriveDoneActions(input(), '2026-09-26');
    expect(done.map((d) => d.action.title)).toEqual(['Renewal effective Oct 13']);
    store().undoActionDone(id, done[0].key, done[0].action.title);
    expect(deriveDoneActions(input(), '2026-09-26')).toEqual([]);
    expect(deriveAccountActions(input(), '2026-09-26').now.some((a) => a.kind === 'renewal')).toBe(true);
    expect(store().activityLog[id].at(-1)).toMatchObject({ type: 'action_reopened', message: 'Reopened: Renewal effective Oct 13.' });
  });

  it('account notes: added with author and time, editable, and never written to Activity', async () => {
    const id = store().createAccount('Notes Co', 'TX');
    const activityBefore = store().activityLog[id]?.length ?? 0;
    store().addAccountNote(id, '  Owner prefers calls after 3pm  ');
    const [note] = store().accounts.find((a) => a.id === id)!.notes!;
    expect(note.text).toBe('Owner prefers calls after 3pm');
    expect(note.authorName).toBeTruthy();
    expect(note.createdAt).toBeTruthy();
    store().updateAccountNote(id, note.id, 'Owner prefers calls after 4pm');
    const edited = store().accounts.find((a) => a.id === id)!.notes![0];
    expect(edited.text).toBe('Owner prefers calls after 4pm');
    expect(edited.updatedAt).toBeTruthy();
    expect(edited.createdAt).toBe(note.createdAt);
    store().addAccountNote(id, '   ');
    expect(store().accounts.find((a) => a.id === id)!.notes).toHaveLength(1);
    expect(store().activityLog[id]?.length ?? 0).toBe(activityBefore);
  });
});


// Regression: markets couldn't be edited after being added (carrier name, a quote's premium/date,
// decline reason), and notes could only be added — never corrected.
describe('editing an existing market', () => {
  it('edits carrier, status, dates and decline reason without losing quotes or notes', () => {
    const id = store().createAccount('ABC Trucking', 'TX');
    const q = store().addQuote(id, { marketName: 'Progresive', status: 'submitted', submittedAt: '2026-09-20' });
    store().addQuoteOption(id, q, { premium: 12000 });
    store().addQuoteNote(id, q, 'UW wants loss runs');
    store().updateQuote(id, q, { marketName: 'Progressive', status: 'declined', submittedAt: '2026-09-21', followUpDate: '2026-10-01', declineReason: 'Outside appetite' });
    const quote = store().quotes[id].find((x) => x.id === q)!;
    expect(quote).toMatchObject({ marketName: 'Progressive', status: 'declined', submittedAt: '2026-09-21', followUpDate: '2026-10-01', declineReason: 'Outside appetite' });
    expect(quote.options).toHaveLength(1);
    expect(quote.notes.map((n) => n.text)).toEqual(['UW wants loss runs']);
    store().updateQuote(id, q, { declineReason: 'Hazmat exposure' });
    expect(store().quotes[id].find((x) => x.id === q)!.declineReason).toBe('Hazmat exposure');
  });

  it("edits a recorded quote's premium and date; the headline premium follows", () => {
    const id = store().createAccount('ABC Trucking', 'TX');
    const q = store().addQuote(id, { marketName: 'Canal', status: 'submitted' });
    const o = store().addQuoteOption(id, q, { label: 'Option A', premium: 18000 });
    store().updateQuoteOption(id, q, o, { premium: 17250, receivedAt: '2026-09-15T12:00:00.000Z', label: 'Option A2' });
    const quote = store().quotes[id].find((x) => x.id === q)!;
    expect(quote.options![0]).toMatchObject({ premium: 17250, receivedAt: '2026-09-15T12:00:00.000Z', label: 'Option A2' });
    expect(quote.premium).toBe(17250);
    expect(store().activityLog[id].map((e) => e.message)).toContain('Edited Canal Option A: premium $17,250, quote date Sep 15, name "Option A2".');
  });

  it('a dated note is editable: text changes, its date stays, the edit is recorded', () => {
    const id = store().createAccount('ABC Trucking', 'TX');
    store().setCurrentUserId('u1', 'roman@agency.com');
    const q = store().addQuote(id, { marketName: 'Canal', status: 'submitted' });
    store().addQuoteNote(id, q, 'Quote expected Friday');
    const before = store().quotes[id].find((x) => x.id === q)!.notes[0];
    expect(before.authorName).toBe('roman@agency.com');
    store().updateQuoteNote(id, q, before.id, 'Quote expected Monday');
    const after = store().quotes[id].find((x) => x.id === q)!.notes[0];
    expect(after).toMatchObject({ id: before.id, text: 'Quote expected Monday', createdAt: before.createdAt, updatedByName: 'roman@agency.com' });
    expect(after.updatedAt).toBeTruthy();
  });
});

describe('merging a newer cloud copy of markets', () => {
  it('keeps the newest version of each market, keeps local deletes, adds markets others created', async () => {
    const { mergeWorkflowList } = await import('../mergeCloud');
    const seen = '2026-09-27T10:00:00.000Z';
    const local = [
      { id: 'a', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-27T11:00:00Z', marketName: 'A edited here' },
      { id: 'b', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z', marketName: 'B old' },
    ];
    const cloud = [
      { id: 'a', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-27T10:30:00Z', marketName: 'A older' },
      { id: 'b', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-27T10:45:00Z', marketName: 'B edited elsewhere' },
      { id: 'c', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z', marketName: 'C deleted here' },
      { id: 'd', createdAt: '2026-09-27T10:40:00Z', updatedAt: '2026-09-27T10:40:00Z', marketName: 'D added elsewhere' },
    ];
    const names = mergeWorkflowList(local, cloud, seen).map((x) => x.marketName).sort();
    expect(names).toEqual(['A edited here', 'B edited elsewhere', 'D added elsewhere']);
  });
});

describe('requesting a document that is not on the checklist yet', () => {
  it('adds it as Requested from the contact, with the dates and instructions, and it shows on Today\'s Plate', async () => {
    const { deriveAccountActions } = await import('../nextActions');
    const { draftClientRequestEmail } = await import('../emailDraft');
    const id = store().createAccount('Blue Ridge Logistics', 'TX');
    const john = store().addContact(id, { name: 'John Smith', email: 'john@blueridge.com' });
    // The standard checklist already has MVRs, still outstanding: the request is for that row (no duplicate).
    const [mvr] = store().addMissingItems(id, [{ label: 'Updated MVR', type: 'document', newCopyOfReceived: true }]);
    expect(store().missingItems[id].find((i) => i.id === mvr)!.label).toBe('MVRs — all drivers');
    // Once received, asking for an updated one adds its own row.
    store().markItemReceived(id, mvr);
    const [itemId] = store().addMissingItems(id, [{ label: 'Updated MVR', type: 'document', newCopyOfReceived: true }]);
    expect(itemId).not.toBe(mvr);
    store().markItemsRequested(id, [itemId], { contactId: john, requestedOn: '2026-09-27', followUpDate: '2026-09-30', instructions: 'dated within the last 14 days' });
    const item = store().missingItems[id].find((i) => i.id === itemId)!;
    expect(item).toMatchObject({ label: 'Updated MVR', status: 'requested', requestedFromContactId: john, followUpDate: '2026-09-30', instructions: 'dated within the last 14 days' });
    expect(item.requestedAt!.slice(0, 10)).toBe('2026-09-27');
    const account = store().accounts.find((a) => a.id === id)!;
    const email = draftClientRequestEmail({ account, contact: { id: john, name: 'John Smith' }, items: [item] });
    expect(email.body).toContain('• Updated MVR — dated within the last 14 days');
    const onTheDay = deriveAccountActions({ account, items: store().missingItems[id], quotes: [], contacts: [{ id: john, name: 'John Smith' }] }, '2026-09-30');
    expect(onTheDay.now.some((a) => a.kind === 'client_follow_up' && a.itemId === itemId)).toBe(true);
    expect(store().activityLog[id].map((e) => e.message)).toContain('Requested Updated MVR from John Smith.');
  });
});

describe('driver notes', () => {
  it('are dated, carry the author, are editable, and are saved with the driver', async () => {
    const { driverFromRow, driverToRow } = await import('../../supabase/recordRows');
    const id = store().createAccount('ABC Trucking', 'TX');
    store().setCurrentUserId('u1', 'denis@agency.com');
    store().addDriver(id, { name: 'John Smith', hireDate: '2024-05-01' });
    const driverId = store().riskProfiles[id].drivers[0].id;
    store().addDriverNote(id, driverId, 'Two speeding tickets in 2023');
    const note = store().riskProfiles[id].drivers[0].notes![0];
    expect(note).toMatchObject({ text: 'Two speeding tickets in 2023', authorName: 'denis@agency.com' });
    store().updateDriverNote(id, driverId, note.id, 'One speeding ticket in 2023');
    const driver = store().riskProfiles[id].drivers[0];
    expect(driver.notes![0]).toMatchObject({ text: 'One speeding ticket in 2023', createdAt: note.createdAt, updatedByName: 'denis@agency.com' });
    const back = driverFromRow(JSON.parse(JSON.stringify(driverToRow(driver, id, 'u1'))));
    expect(back.notes).toEqual(driver.notes);
    expect(back.hireDate).toBe('2024-05-01');
  });
});

describe('loss runs', () => {
  it('a report holds its claims; totals come from them, or from the report when not itemized; removing it keeps the claims', async () => {
    const { lossRunTotals } = await import('../../../components/riskProfile/LossRunsPanel');
    const id = store().createAccount('ABC Trucking', 'TX');
    const runId = store().addLossRun(id, { carrier: 'Progressive', policyNumber: 'PGR-1', reportDate: '2026-09-20', coverageStart: '2025-10-01', coverageEnd: '2026-10-01', claimCount: 2, totalIncurred: 30000 });
    let run = store().accounts.find((a) => a.id === id)!.lossRuns![0];
    expect(lossRunTotals(run, [])).toMatchObject({ claims: 2, incurred: 30000, itemized: false });
    store().addLoss(id, { lossDate: '2026-01-10', claimType: 'Auto Liability', paid: 5000, reserved: 2000, incurred: 7000, status: 'open', lossRunId: runId, claimNumber: 'C-1' });
    const claims = store().riskProfiles[id].lossHistory.filter((l) => l.lossRunId === runId);
    expect(lossRunTotals(run, claims)).toMatchObject({ claims: 1, incurred: 7000, paid: 5000, reserve: 2000, itemized: true });
    store().updateLossRun(id, runId, { reportDate: '2026-09-25' });
    run = store().accounts.find((a) => a.id === id)!.lossRuns![0];
    expect(run.reportDate).toBe('2026-09-25');
    store().deleteLossRun(id, runId);
    expect(store().accounts.find((a) => a.id === id)!.lossRuns).toEqual([]);
    expect(store().riskProfiles[id].lossHistory).toHaveLength(1);
    expect(store().riskProfiles[id].lossHistory[0].lossRunId).toBeUndefined();
  });
});
