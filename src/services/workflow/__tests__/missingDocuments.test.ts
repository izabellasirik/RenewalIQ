import { describe, expect, it } from 'vitest';
import type { DocumentRequest, MissingItem, RiskProfile } from '../../../types';
import { followUpSummary, requirementRows, suggestedRequirements } from '../missingDocuments';

const item = (id: string, extra: Partial<MissingItem> = {}): MissingItem => ({ id, accountId: 'acct', type: 'document', label: `Doc ${id}`, status: 'missing', createdAt: '', updatedAt: '', ...extra });
const request = (extra: Partial<DocumentRequest>): DocumentRequest => ({
  id: 'r1',
  accountId: 'acct',
  token: 't',
  contactName: 'Pat',
  channel: 'email',
  status: 'waiting',
  deliveryStatus: 'sent',
  sentAt: '2026-10-03T12:00:00Z',
  requestedAt: '2026-10-03T12:00:00Z',
  followUpCount: 0,
  nextFollowUp: '2026-10-08',
  expiresAt: '2099-01-01T00:00:00Z',
  items: [],
  files: [],
  ...extra,
});
const state = (rows: ReturnType<typeof requirementRows>, id: string) => rows.find((r) => r.item.id === id)!.state;

describe('missing documents: one state per requirement, from explicit data only', () => {
  it('not requested, prepared, requested and unconfirmed', () => {
    const items = [item('a'), item('b'), item('c'), item('d', { status: 'requested', requestedAt: '2026-10-01T10:00:00Z' })];
    const rows = requirementRows({
      items,
      requests: [
        request({ id: 'prep', deliveryStatus: 'prepared', items: [{ id: 'x', missingItemId: 'b', label: 'Doc b', status: 'requested', position: 0 }] }),
        request({ id: 'old', deliveryStatus: 'unconfirmed', items: [{ id: 'y', missingItemId: 'c', label: 'Doc c', status: 'requested', position: 0 }] }),
      ],
    });
    expect(state(rows, 'a')).toBe('not_requested');
    expect(state(rows, 'b')).toBe('prepared');
    expect(state(rows, 'c')).toBe('sent_unconfirmed');
    expect(rows.find((r) => r.item.id === 'c')).toMatchObject({ askedOf: 'Pat', askedOn: '2026-10-03' });
    expect(state(rows, 'd')).toBe('sent'); // asked by phone, marked requested by hand
  });

  it('an upload waiting for review, an auto-matched document waiting for verification, a checked one', () => {
    const rows = requirementRows({
      items: [item('a', { status: 'requested' }), item('b', { status: 'received', verification: 'pending' }), item('c', { status: 'received', verification: 'verified' }), item('d', { status: 'received' })],
      requests: [request({ items: [{ id: 'x', missingItemId: 'a', label: 'Doc a', status: 'needs_review', position: 0 }] })],
    });
    expect(state(rows, 'a')).toBe('pending_review');
    expect(state(rows, 'b')).toBe('needs_verification');
    expect(state(rows, 'c')).toBe('received');
    expect(state(rows, 'd')).toBe('received'); // received before verification existed: the broker marked it
  });

  it('expired: by the broker’s date, or by the license’s own expiration on the Risk Profile', () => {
    const rows = requirementRows(
      {
        items: [
          item('cert', { status: 'received', expiresOn: '2026-09-30' }),
          item('lic', { status: 'received', templateKey: 'driver_license:d1' }),
          item('ok', { status: 'received', expiresOn: '2027-01-01' }),
        ],
        requests: [],
        drivers: [{ id: 'd1', name: 'Jordan Avery', expirationDate: '09/01/2026' }],
      },
      '2026-10-09'
    );
    expect(state(rows, 'cert')).toBe('expired');
    expect(state(rows, 'lic')).toBe('expired');
    expect(rows.find((r) => r.item.id === 'lic')!.expiresOn).toBe('2026-09-01');
    expect(state(rows, 'ok')).toBe('received');
  });

  it('not applicable keeps its reason; a plain waiver stays a waiver', () => {
    const rows = requirementRows({ items: [item('a', { status: 'waived', waiveKind: 'not_applicable', waiveReason: 'No CDL drivers' }), item('b', { status: 'waived' })], requests: [] });
    expect(state(rows, 'a')).toBe('not_applicable');
    expect(state(rows, 'b')).toBe('waived');
  });

  it('last and next follow-up count only requests that went out', () => {
    const s = followUpSummary(
      [item('a', { status: 'requested', requestedAt: '2026-10-01T09:00:00Z', followUpDate: '2026-10-12' })],
      [
        request({ items: [{ id: 'x', missingItemId: 'b', label: 'b', status: 'requested', position: 0 }], lastFollowUpAt: '2026-10-06T09:00:00Z', nextFollowUp: '2026-10-10' }),
        request({ id: 'prep', deliveryStatus: 'prepared', requestedAt: '2026-10-08T09:00:00Z', nextFollowUp: '2026-10-09', items: [{ id: 'y', missingItemId: 'c', label: 'c', status: 'requested', position: 0 }] }),
      ]
    );
    expect(s).toEqual({ lastFollowUp: '2026-10-06', nextFollowUp: '2026-10-10' });
  });

  it('suggestions come from the Risk Profile: licenses, medical certificates for CDL drivers only, registrations', () => {
    const profile = {
      drivers: [
        { id: 'd1', name: 'Jordan Avery', licenseClass: 'A' },
        { id: 'd2', name: 'Sam Lee', licenseClass: 'D' },
      ],
      vehicles: [{ id: 'v1', year: 2021, make: 'FREIGHTLINER', model: 'CASCADIA', vin: '1FUJGLDR9MLMA1234' }],
    } as unknown as RiskProfile;
    expect(suggestedRequirements(profile).map((s) => s.label)).toEqual([
      'Driver’s license — Jordan Avery',
      'Driver’s license — Sam Lee',
      'Medical certificate — Jordan Avery',
      'Vehicle registration — 2021 FREIGHTLINER CASCADIA (VIN …MA1234)',
      'Prior insurance — current declarations page',
    ]);
  });
});
