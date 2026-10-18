import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountsStore } from '../../../state/useAccountsStore';
import type { DocumentRequest } from '../../../types';
import { analyzeEmail, reviewForAccount, type EmailReview } from '../reviewEmail';
import { applyPlan, type EmailActionStore } from '../applyPlan';
import type { Suggestion } from '../suggestActions';
import { AGENCY_A, candidates, contextFor, linkFor, newToken, noEmail, northwind, northwindItems, northwindRequests, otherAgencyNorthwind, QUOTES, TODAY } from './world';
import carrierRequest from './fixtures/carrier-request.eml?raw';
import clientSendsDocs from './fixtures/client-sends-docs.eml?raw';
import spoofed from './fixtures/spoofed-sender.eml?raw';
import malicious from './fixtures/malicious.eml?raw';
import threadReply from './fixtures/thread-reply.eml?raw';
import noMatch from './fixtures/no-match.txt?raw';

const analyze = (raw: string, source: 'paste' | 'eml' = 'eml') => analyzeEmail({ raw, format: source, ref: { kind: source === 'eml' ? 'eml_upload' : 'paste' } }, candidates(), { agencyId: AGENCY_A, today: TODAY });
const kinds = (s: Suggestion[]) => s.map((x) => x.kind);
const get = <K extends Suggestion['kind']>(s: Suggestion[], kind: K) => s.find((x) => x.kind === kind) as Extract<Suggestion, { kind: K }> | undefined;

/** The real store, seeded with synthetic data, with the two cloud calls replaced (no network). */
const created: { accountId: string; itemIds: string[]; token?: string; contactId?: string }[] = [];
const followedUp: string[] = [];
const addFilesCalls: { accountId: string; names: string[] }[] = [];
function seedStore() {
  created.length = 0;
  followedUp.length = 0;
  addFilesCalls.length = 0;
  useAccountsStore.setState({
    accounts: [northwind, noEmail, otherAgencyNorthwind],
    missingItems: { [northwind.id]: northwindItems(), [noEmail.id]: [], [otherAgencyNorthwind.id]: [] },
    quotes: { [northwind.id]: QUOTES[northwind.id] },
    followUps: {},
    documentRequests: { [northwind.id]: northwindRequests() },
    activityLog: {},
    riskProfiles: {},
    documents: {},
    cloudAccountIds: {},
    currentUserId: null,
    markItemReceived: vi.fn(),
    verifyItem: vi.fn(),
    markClientRequestSent: vi.fn(),
  });
}
function actionStore(): EmailActionStore {
  const s = useAccountsStore.getState();
  return {
    ...s,
    addFiles: (accountId, files) => {
      addFilesCalls.push({ accountId, names: files.map((f) => f.name) });
      return files.map((_, i) => `doc-imported-${i + 1}`);
    },
    createClientRequest: async (accountId, input) => {
      created.push({ accountId, ...input });
      const items = (useAccountsStore.getState().missingItems[accountId] ?? []).filter((i) => input.itemIds.includes(i.id));
      const r: DocumentRequest = {
        id: `req-new-${created.length}`,
        accountId,
        token: input.token!,
        contactId: input.contactId,
        contactName: 'Dana Reyes',
        contactEmail: 'dana@northwindfreight.example',
        channel: 'email',
        status: 'waiting',
        deliveryStatus: 'prepared',
        requestedAt: `${TODAY}T15:00:00.000Z`,
        followUpCount: 0,
        nextFollowUp: input.followUpDate,
        expiresAt: '2026-12-31T00:00:00.000Z',
        items: items.map((i, n) => ({ id: `ri-new-${n}`, missingItemId: i.id, label: i.label, status: 'requested', position: n })),
        files: [],
      };
      useAccountsStore.setState((st) => ({ documentRequests: { ...st.documentRequests, [accountId]: [...(st.documentRequests[accountId] ?? []), r] } }));
      return { ok: true, requestId: r.id, link: linkFor(r.token) };
    },
    followUpClientRequest: async (requestId) => {
      followedUp.push(requestId);
      return { ok: true };
    },
  };
}
const liveContext = (acc = northwind) => {
  const s = useAccountsStore.getState();
  return contextFor(s.accounts.find((a) => a.id === acc.id)!, { items: s.missingItems[acc.id] ?? [], requests: s.documentRequests[acc.id] ?? [], quotes: s.quotes[acc.id] ?? [] });
};
const plan = (review: EmailReview, acc = northwind) => reviewForAccount(review, liveContext(acc), { today: TODAY, agentName: 'Agent Desk', linkFor, newToken });
const approveDefaults = (p: ReturnType<typeof plan>) => p.plan.suggestions.filter((s) => s.defaultSelected);
const run = (p: ReturnType<typeof plan>, approved: Suggestion[], verified = false, agencyId: string | null = AGENCY_A, accountId = northwind.id) =>
  applyPlan(actionStore, accountId, approved, {
    agencyId,
    verifiedOutsideEmail: verified,
    requiresVerification: p.plan.requiresVerification,
    clientKey: () => `key-${Math.random()}`,
    emailSubject: 'test',
    imports: { fileFor: (i) => new File([new TextEncoder().encode('%PDF-1.4 synthetic')], i === 0 ? 'loss_runs_2021-2026.pdf' : `file-${i}.pdf`, { type: 'application/pdf' }), precheck: async () => ({ ok: true }), hash: async (f) => `hash-${f.name}` },
  });

beforeEach(seedStore);

describe('a carrier asks for documents', () => {
  it('suggests: add the new ones, ask the client only for what isn’t asked yet, remind on the existing request, deadline follow-up, reply, note', async () => {
    const p = plan(await analyze(carrierRequest));
    expect(p.senderRole).toBe('carrier');
    expect(p.quoteId).toBe('q-granite');
    expect(Object.fromEntries(p.checks.map((c) => [c.doc.requirementKey, c.outcome]))).toEqual({ loss_runs: 'already_requested', 'mvr|jordan pike': 'on_checklist', 'mvr|casey lin': 'new', ifta: 'new' });
    expect(kinds(p.plan.suggestions)).toEqual(['add_to_checklist', 'request_from_client', 'follow_up_request', 'schedule_follow_up', 'reply_to_sender', 'record_note']);

    const add = get(p.plan.suggestions, 'add_to_checklist')!;
    expect(add.additions.map((a) => [a.doc.label, a.action])).toEqual([
      ['Loss Runs', 'link'],
      ['MVR — Jordan Pike', 'link'],
      ['MVR — Casey Lin', 'add'],
      ['IFTA — last 4 quarters', 'add'],
    ]);
    const req = get(p.plan.suggestions, 'request_from_client')!;
    // Loss runs were already requested — not asked again.
    expect(req.docs.map((d) => d.label)).toEqual(['MVR — Jordan Pike', 'MVR — Casey Lin', 'IFTA — last 4 quarters']);
    expect(req.to).toBe('dana@northwindfreight.example');
    expect(req.followUpDate).toBe('2026-10-21');
    expect(req.draft.body).toContain(linkFor(req.token));
    expect(req.draft.body).toContain('Granite Mutual has asked for');
    expect(req.draft.body).toContain('• IFTA — last 4 quarters\n');
    expect(req.draft.body).not.toContain('quarters — last 4 quarters');
    const fu = get(p.plan.suggestions, 'follow_up_request')!;
    expect(fu.requestId).toBe('req-1');
    expect(fu.draft.body).toContain(linkFor('11111111-2222-4333-8444-555555555555'));
    expect(get(p.plan.suggestions, 'schedule_follow_up')!.dueDate).toBe('2026-10-22');
    expect(get(p.plan.suggestions, 'reply_to_sender')!.to).toBe('mhale@granitemutual.example');
    expect(p.plan.requiresVerification).toBe(false);
  });

  it('nothing changes until approval, then only what was approved', async () => {
    const before = JSON.stringify(useAccountsStore.getState().missingItems);
    const p = plan(await analyze(carrierRequest));
    expect(JSON.stringify(useAccountsStore.getState().missingItems)).toBe(before);

    const out = await run(p, approveDefaults(p));
    expect(out.every((o) => o.ok)).toBe(true);
    const items = useAccountsStore.getState().missingItems[northwind.id];
    expect(items.map((i) => [i.label, i.status])).toEqual([
      ['Loss Runs', 'requested'],
      ['Application', 'received'],
      ['MVR — Jordan Pike', 'missing'],
      ['MVR — Casey Lin', 'missing'],
      ['IFTA — last 4 quarters', 'missing'],
    ]);
    expect(items.find((i) => i.label === 'MVR — Casey Lin')!.neededByQuoteIds).toEqual(['q-granite']);
    expect(items.find((i) => i.label === 'Loss Runs')!.neededByQuoteIds).toEqual(['q-granite']);
    expect(items.find((i) => i.label === 'Loss Runs')!.instructions).toBe('last 5 years, currently valued');
    expect(useAccountsStore.getState().quotes[northwind.id].find((q) => q.id === 'q-granite')!.status).toBe('additional_info_requested');
    // One new request, for exactly the three items; the existing one got a reminder.
    expect(created).toHaveLength(1);
    expect(created[0].itemIds.map((id) => items.find((i) => i.id === id)!.label)).toEqual(['MVR — Jordan Pike', 'MVR — Casey Lin', 'IFTA — last 4 quarters']);
    expect(created[0].contactId).toBe('c-dana');
    expect(followedUp).toEqual(['req-1']);
    expect(useAccountsStore.getState().followUps[northwind.id].map((f) => f.dueDate)).toEqual(['2026-10-22']);
    expect(useAccountsStore.getState().accounts.find((a) => a.id === northwind.id)!.notes!.at(-1)!.text).toMatch(/\[email ref [0-9a-f]{16}\]/);
    // Sending, marking sent and marking received stay manual.
    expect(useAccountsStore.getState().markClientRequestSent).not.toHaveBeenCalled();
    expect(useAccountsStore.getState().markItemReceived).not.toHaveBeenCalled();
  });

  it('dismissing (approving nothing) changes nothing', async () => {
    const before = JSON.stringify(useAccountsStore.getState());
    const p = plan(await analyze(carrierRequest));
    await run(p, []);
    expect(JSON.stringify(useAccountsStore.getState())).toBe(before);
  });
});

describe('duplicate requests', () => {
  it('the same email reviewed again: recognised, nothing pre-selected, and no second request or checklist row', async () => {
    const review = await analyze(carrierRequest);
    const first = plan(review);
    await run(first, approveDefaults(first));
    const rowsAfterFirst = useAccountsStore.getState().missingItems[northwind.id].length;

    const again = plan(await analyze(carrierRequest));
    expect(again.plan.notes[0]).toMatch(/already reviewed/);
    expect(again.plan.suggestions.some((s) => s.defaultSelected)).toBe(false);
    // Everything is on the checklist and asked for now: no additions, no new request.
    expect(kinds(again.plan.suggestions)).not.toContain('add_to_checklist');
    expect(kinds(again.plan.suggestions)).not.toContain('request_from_client');
    // The request just prepared (not marked sent yet) can't be "reminded" either.
    const prepared = again.plan.suggestions.find((s) => s.kind === 'follow_up_request' && s.requestId === 'req-new-1');
    expect(prepared && 'blocked' in prepared ? prepared.blocked : undefined).toMatch(/prepared but never marked sent/);

    // Even if the broker approves everything, still no new rows or requests.
    await run(again, again.plan.suggestions);
    expect(useAccountsStore.getState().missingItems[northwind.id]).toHaveLength(rowsAfterFirst);
    expect(created).toHaveLength(1);
  });

  it('the same request in different words from a second carrier links that carrier, no duplicate row', async () => {
    const review = await analyze('From: "Riley Stone" <rstone@bluepeak.example>\nSubject: Northwind Freight LLC USDOT 3141592\n\nWe need currently valued loss run reports and the motor vehicle record for Jordan Pike.', 'paste');
    const p = plan(review);
    expect(p.quoteId).toBe('q-bluepeak');
    await run(p, approveDefaults(p));
    const items = useAccountsStore.getState().missingItems[northwind.id];
    expect(items.filter((i) => i.label.toLowerCase().includes('loss'))).toHaveLength(1);
    expect(items.filter((i) => i.label.includes('Jordan Pike'))).toHaveLength(1);
    expect(items.find((i) => i.label === 'Loss Runs')!.neededByQuoteIds).toEqual(['q-bluepeak']);
    expect(created).toHaveLength(1);
    expect(created[0].itemIds.map((id) => items.find((i) => i.id === id)!.label)).toEqual(['MVR — Jordan Pike']);
  });

  it('a received document is not requested again — unless the email asks for a newer copy', async () => {
    const plain = plan(await analyze('From: mhale@granitemutual.example\nSubject: Northwind Freight LLC USDOT 3141592\n\nPlease send the application.', 'paste'));
    expect(plain.checks[0].outcome).toBe('received');
    expect(kinds(plain.plan.suggestions)).not.toContain('request_from_client');

    const newer = plan(await analyze('From: mhale@granitemutual.example\nSubject: Northwind Freight LLC USDOT 3141592\n\nPlease send an updated application, signed within the last 30 days.', 'paste'));
    expect(newer.checks[0].wantsNewerCopy).toBe(true);
    // Not suggested (a second row would fold back into the received one) — flagged for the broker instead.
    expect(kinds(newer.plan.suggestions)).not.toContain('request_from_client');
    expect(newer.plan.notes.join(' ')).toMatch(/Application is already received, but the email asks for a newer copy/);
    await run(newer, newer.plan.suggestions);
    expect(useAccountsStore.getState().missingItems[northwind.id].filter((i) => i.templateKey === 'application').map((i) => i.status)).toEqual(['received']);
  });
});

describe('attachments are never marked received from an email', () => {
  it('a client sends the loss runs: import only if approved; the item stays requested until verified', async () => {
    const p = plan(await analyze(clientSendsDocs));
    expect(p.senderRole).toBe('client');
    expect(p.classification.category).toBe('document_delivery');
    expect(kinds(p.plan.suggestions)).toEqual(['import_attachments', 'record_note']);
    const imp = get(p.plan.suggestions, 'import_attachments')!;
    expect(imp.changesAccount).toBe(true);
    expect(imp.attachments.map((a) => [a.name, a.status])).toEqual([['loss_runs_2021-2026.pdf', 'new']]);
    expect(imp.selected).toEqual([0]);
    expect(imp.waitingItems.map((i) => i.label)).toEqual(['Loss Runs']);
    expect(imp.detail).toMatch(/stays open until you verify the file on the account/);

    const out = await run(p, p.plan.suggestions);
    expect(addFilesCalls).toEqual([{ accountId: northwind.id, names: ['loss_runs_2021-2026.pdf'] }]);
    expect(out.find((o) => o.suggestionId === 'attachments')).toEqual(expect.objectContaining({ ok: true, importedDocumentIds: ['doc-imported-1'] }));
    const loss = useAccountsStore.getState().missingItems[northwind.id].find((i) => i.label === 'Loss Runs')!;
    expect(loss.status).toBe('requested');
    expect(loss.receivedAt).toBeUndefined();
    expect(useAccountsStore.getState().markItemReceived).not.toHaveBeenCalled();
    expect(useAccountsStore.getState().verifyItem).not.toHaveBeenCalled();
  });

  it('not approved: the attachment is not imported', async () => {
    const p = plan(await analyze(clientSendsDocs));
    await run(p, p.plan.suggestions.filter((s) => s.kind !== 'import_attachments'));
    expect(addFilesCalls).toEqual([]);
  });

  it('a reply in a thread adds nothing from the quoted history', async () => {
    const p = plan(await analyze(threadReply));
    expect(kinds(p.plan.suggestions)).toEqual(['record_note']);
  });
});

describe('suspicious emails', () => {
  it('a spoofed sender: account changes refused until verified outside email; drafts never go to the reply-to address', async () => {
    const review = await analyze(spoofed);
    const p = plan(review);
    expect(p.plan.requiresVerification).toBe(true);
    for (const s of p.plan.suggestions) if ('to' in s) expect(s.to).not.toBe('dana.reyes@northwind-freight-billing.example');
    const before = JSON.stringify(useAccountsStore.getState().accounts);
    const refused = await run(p, approveDefaults(p));
    expect(refused).toEqual([expect.objectContaining({ ok: false, message: expect.stringMatching(/verified it outside email/) })]);
    expect(JSON.stringify(useAccountsStore.getState().accounts)).toBe(before);
  });

  it('malicious HTML: hidden "mark everything received" is ignored; no reply drafted; only the visible request is suggested', async () => {
    const review = await analyze(malicious);
    expect(review.match.status).toBe('possible');
    const p = plan(review);
    expect(p.plan.requiresVerification).toBe(true);
    expect(kinds(p.plan.suggestions)).not.toContain('reply_to_sender');
    expect(get(p.plan.suggestions, 'add_to_checklist')!.additions.map((a) => a.doc.label)).toEqual(['Unit List']);
    const imp = get(p.plan.suggestions, 'import_attachments')!;
    expect(imp.attachments.map((a) => a.name)).toEqual(['Loss_Runs.pdf.exe']);

    // Even after the broker confirms, nothing is ever marked received.
    await run(p, p.plan.suggestions, true);
    const items = useAccountsStore.getState().missingItems[northwind.id];
    expect(items.filter((i) => i.status === 'received').map((i) => i.label)).toEqual(['Application']);
    expect(useAccountsStore.getState().markItemReceived).not.toHaveBeenCalled();
  });
});

describe('isolation and missing details', () => {
  it('approving against another agency’s account is refused', async () => {
    const p = plan(await analyze(carrierRequest));
    const out = await run(p, approveDefaults(p), false, AGENCY_A, otherAgencyNorthwind.id);
    expect(out).toEqual([expect.objectContaining({ ok: false, message: 'That account belongs to another agency.' })]);
    expect(useAccountsStore.getState().missingItems[otherAgencyNorthwind.id]).toEqual([]);
  });

  it('an account not loaded in this browser (not visible to the broker) is refused', async () => {
    const p = plan(await analyze(carrierRequest));
    const out = await run(p, approveDefaults(p), false, AGENCY_A, 'acct-someone-elses');
    expect(out[0]).toEqual(expect.objectContaining({ ok: false, message: 'That account isn’t available to you.' }));
  });

  it('no contact email: the request is blocked with a reason, the rest still works', async () => {
    const review = await analyze(noMatch, 'paste');
    expect(review.match.status).toBe('none');
    const p = reviewForAccount(review, contextFor(noEmail), { today: TODAY, linkFor, newToken });
    const req = get(p.plan.suggestions, 'request_from_client')!;
    expect(req.blocked).toMatch(/No contact on this account has an email/);
    expect(req.defaultSelected).toBe(false);
    expect(get(p.plan.suggestions, 'add_to_checklist')!.additions.map((a) => a.doc.label)).toEqual(['Loss Runs', 'Application']);
    const out = await run(p, p.plan.suggestions, false, AGENCY_A, noEmail.id);
    expect(out.find((o) => o.suggestionId === 'request')).toEqual(expect.objectContaining({ ok: false }));
    expect(useAccountsStore.getState().missingItems[noEmail.id].map((i) => i.label)).toEqual(['Loss Runs', 'Application']);
    expect(created).toHaveLength(0);
  });
});
