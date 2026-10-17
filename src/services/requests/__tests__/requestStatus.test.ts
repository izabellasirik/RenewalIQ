import { describe, expect, it } from 'vitest';
import type { Account, DocumentRequest, DocumentRequestItem, MissingItem } from '../../../types';
import { requestProgress } from '../requestStatus';
import { deriveAccountActions } from '../../workflow/nextActions';

const item = (id: string, status: DocumentRequestItem['status']): DocumentRequestItem => ({ id, missingItemId: `m_${id}`, label: `Doc ${id}`, status, position: 0 });
const req = (items: DocumentRequestItem[], extra: Partial<DocumentRequest> = {}): DocumentRequest => ({
  id: 'r1',
  accountId: 'acct',
  token: 't',
  contactName: 'Pat',
  channel: 'email',
  status: 'waiting',
  deliveryStatus: 'sent',
  requestedAt: '2026-10-01T12:00:00Z',
  followUpCount: 0,
  nextFollowUp: '2026-10-06',
  expiresAt: '2099-01-01T00:00:00Z',
  items,
  files: [],
  ...extra,
});

describe('client request status', () => {
  it('Prepared → Sent → Partially received → Received, pending review → Complete', () => {
    expect(requestProgress(req([item('a', 'requested'), item('b', 'requested')], { deliveryStatus: 'prepared' }))).toBe('prepared');
    expect(requestProgress(req([item('a', 'requested'), item('b', 'requested')]))).toBe('sent');
    expect(requestProgress(req([item('a', 'satisfied'), item('b', 'requested')]))).toBe('partially_received');
    expect(requestProgress(req([item('a', 'needs_review'), item('b', 'requested')]))).toBe('partially_received');
    expect(requestProgress(req([item('a', 'satisfied'), item('b', 'uploaded')]))).toBe('pending_review');
    expect(requestProgress(req([item('a', 'satisfied'), item('b', 'waived')]))).toBe('complete');
  });

  it('requests from before sending was tracked are "Sent (unconfirmed)", never "Sent"', () => {
    expect(requestProgress(req([item('a', 'requested')], { deliveryStatus: 'unconfirmed' }))).toBe('sent_unconfirmed');
  });

  it('cancelled and expired links say so', () => {
    expect(requestProgress(req([item('a', 'requested')], { status: 'cancelled' }))).toBe('cancelled');
    expect(requestProgress(req([item('a', 'requested')], { expiresAt: '2026-01-01T00:00:00Z' }), new Date('2026-10-09'))).toBe('expired');
  });
});

describe('Action required for client requests', () => {
  const account = { id: 'acct', namedInsured: 'ABC Trucking' } as Account;
  const items: MissingItem[] = [
    { id: 'm_a', accountId: 'acct', type: 'document', label: 'Doc a', status: 'missing', createdAt: '', updatedAt: '' },
  ];
  const actions = (r: DocumentRequest) => deriveAccountActions({ account, items, quotes: [], contacts: [], documentRequests: [r] }, '2026-10-09');

  it('a prepared request asks to be marked sent and has no follow-up', () => {
    const { now, upcoming } = actions(req([item('a', 'requested')], { deliveryStatus: 'prepared', nextFollowUp: '2026-10-08' }));
    const all = [...now, ...upcoming];
    expect(all.filter((a) => a.requestId === 'r1')).toHaveLength(1);
    expect(all.find((a) => a.requestId === 'r1')).toMatchObject({ requestPrepared: true, title: 'Request to Pat not marked as sent' });
    expect(all.some((a) => a.kind === 'client_follow_up')).toBe(false);
  });

  it('a sent request gets its follow-up; an unconfirmed one too, labelled unconfirmed', () => {
    const sent = actions(req([item('a', 'requested')], { nextFollowUp: '2026-10-08' })).now.find((a) => a.requestId === 'r1')!;
    expect(sent.kind).toBe('client_follow_up');
    expect(sent.detail).not.toContain('unconfirmed');
    const old = actions(req([item('a', 'requested')], { deliveryStatus: 'unconfirmed', nextFollowUp: '2026-10-08' })).now.find((a) => a.requestId === 'r1')!;
    expect(old.kind).toBe('client_follow_up');
    expect(old.detail).toContain('sending unconfirmed');
  });
});
