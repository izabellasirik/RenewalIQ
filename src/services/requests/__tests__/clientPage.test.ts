import { describe, expect, it } from 'vitest';
import { itemState, requestProgress } from '../clientProgress';
import { detectDocumentSignals } from '../documentSignals';
import { placeUnassignedUpload } from '../matchUpload';
import { splitDriverMvrs, isGenericMvr } from '../../workflow/driverRequirements';
import { requirementKey } from '../../workflow/requirementKey';
import type { DriverEntry, MissingItem } from '../../../types';

const item = (received: boolean, confirmed: boolean, files = 0) => ({ received, confirmed, files: Array.from({ length: files }, (_, i) => ({ name: `f${i}`, uploadedAt: '' })) });

describe('client page states and progress', () => {
  it('A/B/D: missing, under review (not received), received', () => {
    expect(itemState(item(false, false))).toBe('missing');
    expect(itemState(item(true, false, 1))).toBe('review');
    expect(itemState(item(true, true, 1))).toBe('received');
  });
  it('C: under review never counts as received', () => {
    const p = requestProgress([item(true, true, 1), item(true, false, 1), item(false, false), item(false, false), item(true, false, 1)]);
    expect(p).toEqual({ total: 5, received: 1, reviewing: 2, remaining: 4 });
  });
  it('D: accepting an item moves it to received', () => {
    expect(requestProgress([item(true, true, 1), item(true, true, 1)]).remaining).toBe(0);
  });
});

describe('F/G/H: files sent with "Upload multiple documents"', () => {
  const slots = [
    { requestItemId: 'loss', label: 'Loss Runs', templateKey: 'loss_runs' },
    { requestItemId: 'mvrJ', label: 'MVR — John Smith' },
    { requestItemId: 'mvrA', label: 'MVR — Alex Johnson' },
    { requestItemId: 'ifta', label: 'IFTA — last 4 quarters', templateKey: 'ifta' },
  ];
  const sig = (text: string) => detectDocumentSignals({ text, fileName: 'x.pdf' });

  it('G: a clear match goes to its one item', () => {
    expect(placeUnassignedUpload({ signals: sig('Loss Run Report\nInsured: ABC Trucking'), outstanding: slots, accountName: 'ABC Trucking LLC' })).toEqual({ outcome: 'satisfied', requestItemId: 'loss' });
    expect(placeUnassignedUpload({ signals: sig('Motor Vehicle Record\nDriver Name: Alex Johnson'), outstanding: slots })).toEqual({ outcome: 'satisfied', requestItemId: 'mvrA' });
  });
  it('H: unreadable, unnamed or unclear files stay for review — never a guess', () => {
    expect(placeUnassignedUpload({ signals: sig(''), outstanding: slots }).outcome).toBe('needs_review');
    // An MVR without a readable name could be either driver's.
    const unnamed = placeUnassignedUpload({ signals: sig('Motor Vehicle Record'), outstanding: slots });
    expect(unnamed.outcome).toBe('needs_review');
    // Another company's loss run.
    expect(placeUnassignedUpload({ signals: sig('Loss Run Report\nInsured: Blue Ridge Logistics'), outstanding: slots, accountName: 'ABC Trucking LLC' }).outcome).toBe('needs_review');
    // Something nobody asked for.
    expect(placeUnassignedUpload({ signals: sig('Driver List\nDriver Schedule'), outstanding: slots }).outcome).toBe('needs_review');
  });
  it('H: matches for two items → review, naming both', () => {
    const two = [
      { requestItemId: 'a', label: 'Loss Runs', templateKey: 'loss_runs' },
      { requestItemId: 'b', label: 'Loss runs — prior carrier', templateKey: 'loss_runs' },
    ];
    const d = placeUnassignedUpload({ signals: sig('Loss Run Report'), outstanding: two });
    expect(d).toMatchObject({ outcome: 'needs_review', note: expect.stringContaining(' or ') });
  });
  it('a match only with something already received is flagged as a possible duplicate', () => {
    const d = placeUnassignedUpload({ signals: sig('Loss Run Report'), outstanding: [slots[1]], received: [slots[0]] });
    expect(d).toMatchObject({ outcome: 'needs_review', suggestedRequestItemId: 'loss' });
  });
});

describe('I/J: specific driver MVRs', () => {
  const mk = (id: string, label: string, status: MissingItem['status'] = 'missing', templateKey?: string): MissingItem => ({ id, accountId: 'a', type: 'document', label, status, templateKey, createdAt: '', updatedAt: '' });
  const drivers = [{ id: 'd1', name: 'John Smith' }, { id: 'd2', name: 'Alex Johnson' }, { id: 'd3', name: '  ' }] as DriverEntry[];
  const generic = mk('g', 'MVRs — all drivers', 'missing', 'mvr');

  it('the generic item becomes one requirement per named driver', () => {
    expect(isGenericMvr(generic)).toBe(true);
    const { display, splits } = splitDriverMvrs([generic], [generic], drivers);
    expect(display.map((d) => d.label)).toEqual(['MVR — John Smith', 'MVR — Alex Johnson']);
    expect(splits[0].drivers.map((d) => d.templateKey)).toEqual(['mvr:d1', 'mvr:d2']);
  });
  it('J: reuses an existing driver item instead of duplicating it, and skips one already received', () => {
    const john = mk('j', 'MVR — John Smith');
    const alex = mk('x', 'MVR — Alex Johnson', 'received');
    const { display, splits } = splitDriverMvrs([generic, john], [generic, john, alex], drivers);
    expect(display.map((d) => d.id)).toEqual(['j']); // John once (not twice); Alex already in
    expect(splits[0].drivers).toEqual([{ label: 'MVR — John Smith', templateKey: 'mvr:d1', existingId: 'j' }]);
    expect(new Set(display.map((d) => requirementKey(d))).size).toBe(display.length);
  });
  it('with no named drivers the generic item is left as it is', () => {
    expect(splitDriverMvrs([generic], [generic], []).display).toEqual([generic]);
  });
});
