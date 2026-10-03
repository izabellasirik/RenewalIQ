import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountsStore } from '../../../state/useAccountsStore';
import { deriveAccountActions } from '../../workflow/nextActions';
import { draftRequestFollowUpEmail } from '../../workflow/emailDraft';
import { detectDocumentSignals, normalizePersonName, sameCompany } from '../documentSignals';
import { matchRequestUpload, requirementShape } from '../matchUpload';
import { outstandingRequestItems, type DocumentRequest, type DocumentRequestItem } from '../../../types';

const store = () => useAccountsStore.getState();

function newAccount(): string {
  useAccountsStore.setState({ accounts: [], missingItems: {}, quotes: {}, riskProfiles: {}, documents: {}, activityLog: {}, matchResults: {}, documentRequests: {} });
  return store().createAccount('ABC Trucking', 'TX');
}

const item = (id: string, missingItemId: string, label: string, status: DocumentRequestItem['status'] = 'requested', position = 0): DocumentRequestItem => ({ id, missingItemId, label, status, position });

function request(accountId: string, items: DocumentRequestItem[], extra: Partial<DocumentRequest> = {}): DocumentRequest {
  return {
    id: 'req-1',
    accountId,
    token: '00000000-0000-0000-0000-000000000001',
    contactName: 'Pat Client',
    channel: 'email',
    status: 'waiting',
    requestedAt: '2026-09-20T12:00:00Z',
    followUpCount: 0,
    nextFollowUp: '2026-09-28',
    expiresAt: '2026-12-31T00:00:00Z',
    items,
    files: [],
    ...extra,
  };
}

describe('document signals', () => {
  it('reads kinds, names and quarters', () => {
    const s = detectDocumentSignals({ text: 'MOTOR VEHICLE RECORD\nName: SMITH, JOHN A\n', fileName: 'mvr.pdf' });
    expect(s.kinds).toContain('mvr');
    expect(s.names).toEqual(['john smith']);
    const ifta = detectDocumentSignals({ text: 'IFTA Quarterly Fuel Tax Return — 2nd Quarter 2026', fileName: 'scan.pdf' });
    expect(ifta.kinds).toContain('ifta');
    expect(ifta.quarters).toContain('Q2 2026');
    expect(detectDocumentSignals({ text: '', fileName: 'IMG_0001.jpg' }).kinds).toEqual([]);
  });

  it('normalizes names', () => {
    expect(normalizePersonName('SMITH, ALEX J')).toBe('alex smith');
    expect(normalizePersonName('Alex J. Smith')).toBe('alex smith');
  });
});

describe('matching an upload to what was requested', () => {
  const mvrJohn = { requestItemId: 'a', label: 'MVR — John Smith' };
  const mvrMaria = { requestItemId: 'b', label: 'MVR — Maria Lopez' };
  const loss = { requestItemId: 'c', label: 'Loss runs' };
  const iftaQ2 = { requestItemId: 'd', label: 'IFTA Q2' };

  it('knows the shape of common requirements', () => {
    expect(requirementShape(mvrJohn)).toEqual({ kind: 'mvr', entity: 'john smith' });
    expect(requirementShape(iftaQ2)).toMatchObject({ kind: 'ifta', quarter: 'Q2' });
    expect(requirementShape({ label: 'Safety manual' }).kind).toBeUndefined();
  });

  it('satisfies only when the document confirms it', () => {
    const s = detectDocumentSignals({ text: 'Motor Vehicle Record\nDriver Name: John Smith', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: s, slot: mvrJohn, others: [mvrJohn, mvrMaria, loss] })).toEqual({ outcome: 'satisfied' });
  });

  it('sends the wrong driver to review and suggests the right item', () => {
    const s = detectDocumentSignals({ text: 'Motor Vehicle Record\nDriver Name: Maria Lopez', fileName: 'x.pdf' });
    const d = matchRequestUpload({ signals: s, slot: mvrJohn, others: [mvrJohn, mvrMaria, loss] });
    expect(d.outcome).toBe('needs_review');
    expect(d.outcome === 'needs_review' && d.suggestedRequestItemId).toBe('b');
  });

  it('never guesses: unreadable, unnamed, wrong kind, wrong quarter, unknown requirement → review', () => {
    const none = detectDocumentSignals({ text: '', fileName: 'IMG_1.jpg' });
    expect(matchRequestUpload({ signals: none, slot: loss, others: [loss] }).outcome).toBe('needs_review');
    expect(matchRequestUpload({ signals: undefined, slot: loss, others: [loss] }).outcome).toBe('needs_review');
    const unnamed = detectDocumentSignals({ text: 'Motor Vehicle Record', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: unnamed, slot: mvrJohn, others: [mvrJohn] }).outcome).toBe('needs_review');
    const lossDoc = detectDocumentSignals({ text: 'Loss Run Report', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: lossDoc, slot: mvrJohn, others: [mvrJohn, loss] })).toMatchObject({ outcome: 'needs_review', suggestedRequestItemId: 'c' });
    const q3 = detectDocumentSignals({ text: 'IFTA return 3rd quarter 2026', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: q3, slot: iftaQ2, others: [iftaQ2] }).outcome).toBe('needs_review');
    expect(matchRequestUpload({ signals: lossDoc, slot: { requestItemId: 'z', label: 'Safety manual' }, others: [] }).outcome).toBe('needs_review');
    expect(matchRequestUpload({ signals: lossDoc, slot: loss, others: [loss] }).outcome).toBe('satisfied');
  });
});

describe('company check', () => {
  const loss = { requestItemId: 'c', label: 'Loss runs' };
  it('reads the insured, not the insurance carrier', () => {
    const s = detectDocumentSignals({ text: 'LOSS RUN REPORT\nCarrier: Progressive\nNamed Insured: Blue Ridge Logistics, LLC   Policy #: P-1', fileName: 'x.pdf' });
    expect(s.insuredNames).toEqual(['Blue Ridge Logistics, LLC']);
  });
  it('treats suffixes and punctuation as the same business', () => {
    expect(sameCompany('ABC Trucking, LLC', 'ABC Trucking')).toBe(true);
    expect(sameCompany('A.B.C. Trucking Inc', 'ABC Trucking LLC')).toBe(true);
    expect(sameCompany('ABC Transportation', 'ABC Transportation LLC')).toBe(true);
    expect(sameCompany('Smith Trucking', 'ABC Trucking')).toBe(false); // only the industry word in common
    expect(sameCompany('A.B.C. Trucking', 'Smith Trucking')).toBe(false);
    expect(sameCompany('Blue Ridge Logistics', 'ABC Trucking')).toBe(false);
  });
  it("sends another company's document to review", () => {
    const other = detectDocumentSignals({ text: 'Loss Run Report\nInsured: Blue Ridge Logistics LLC', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: other, slot: loss, others: [loss], accountName: 'ABC Trucking LLC' })).toMatchObject({ outcome: 'needs_review', note: expect.stringMatching(/Blue Ridge Logistics LLC, not ABC Trucking LLC/) });
    const mine = detectDocumentSignals({ text: 'Loss Run Report\nInsured: ABC Trucking', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: mine, slot: loss, others: [loss], accountName: 'ABC Trucking LLC' }).outcome).toBe('satisfied');
    // No insured named on it: the company check doesn't block (the other checks still apply).
    const unnamed = detectDocumentSignals({ text: 'Loss Run Report', fileName: 'x.pdf' });
    expect(matchRequestUpload({ signals: unnamed, slot: loss, others: [loss], accountName: 'ABC Trucking LLC' }).outcome).toBe('satisfied');
  });
});

describe('follow-up message', () => {
  it('lists only what is still outstanding, with the link', () => {
    const r = request('acct', [item('1', 'm1', 'Loss runs', 'satisfied', 0), item('2', 'm2', 'IFTA Q2', 'requested', 1), item('3', 'm3', 'MVR — John Smith', 'requested', 2)]);
    const out = outstandingRequestItems(r);
    expect(out.map((i) => i.label)).toEqual(['IFTA Q2', 'MVR — John Smith']);
    const d = draftRequestFollowUpEmail({ account: { namedInsured: 'ABC Trucking' }, contactName: 'Pat Client', outstanding: out, received: 1, uploadLink: 'https://x/request/t' });
    expect(d.body).toContain('IFTA Q2');
    expect(d.body).toContain('MVR — John Smith');
    expect(d.body).not.toContain('Loss runs');
    expect(d.body).toContain('https://x/request/t');
    expect(d.subject).toContain('2 items');
  });
});

describe("Today's Plate", () => {
  let accountId: string;
  beforeEach(() => {
    accountId = newAccount();
  });

  function actions(requests: DocumentRequest[]) {
    const account = store().accounts.find((a) => a.id === accountId)!;
    return deriveAccountActions({ account, items: store().missingItems[accountId] ?? [], quotes: [], contacts: [], documentRequests: requests }, '2026-09-28');
  }

  it('one follow-up per open request (not one per item), only while something is outstanding', () => {
    store().addMissingItems(accountId, [{ type: 'document', label: 'Loss runs' }, { type: 'document', label: 'IFTA Q2' }]);
    const [a, b] = store().missingItems[accountId];
    store().markItemsRequested(accountId, [a.id, b.id], { followUpDate: '2026-09-28' });
    const before = store().missingItems[accountId].length;

    const partial = request(accountId, [item('1', a.id, a.label, 'satisfied'), item('2', b.id, b.label, 'requested', 1)], { status: 'partial' });
    const got = [...actions([partial]).now, ...actions([partial]).upcoming];
    const reqActions = got.filter((x) => x.requestId === 'req-1');
    expect(reqActions).toHaveLength(1);
    expect(reqActions[0].title).toBe('1 item still needed from Pat Client');
    // The chased items don't also show up as separate item follow-ups.
    expect(got.filter((x) => x.kind === 'client_follow_up' && !x.requestId)).toHaveLength(0);

    const complete = request(accountId, [item('1', a.id, a.label, 'satisfied'), item('2', b.id, b.label, 'satisfied', 1)], { status: 'complete' });
    expect([...actions([complete]).now, ...actions([complete]).upcoming].filter((x) => x.requestId)).toHaveLength(0);
    // Requests never add checklist items.
    expect(store().missingItems[accountId]).toHaveLength(before);
  });

  it('an upload needing review is an action until resolved', () => {
    store().addMissingItems(accountId, [{ type: 'document', label: 'Loss runs' }]);
    const [a] = store().missingItems[accountId];
    const r = request(accountId, [item('1', a.id, a.label, 'needs_review')], {
      files: [{ id: 'f1', requestItemId: '1', fileName: 'scan.pdf', storagePath: 't/k/scan.pdf', uploadedAt: '2026-09-27T00:00:00Z', matchStatus: 'needs_review', matchNote: 'Couldn’t tell' }],
    });
    expect(actions([r]).now.some((x) => x.title === 'Review scan.pdf')).toBe(true);
  });
});
