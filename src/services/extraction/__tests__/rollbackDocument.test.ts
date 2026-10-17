import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../emptyRiskProfile';
import { applyManualEdit, applyFieldResolution, mergeIntoRiskProfile, rollbackDocument, updateRecordEntry, addRecordEntry } from '../extractionService';
import { settleLossRuns } from '../lossRunRecords';
import type { ExtractedFieldResult, LossRun, RiskProfile } from '../../../types';

const src = (documentId: string) => ({ documentId, documentName: `${documentId}.pdf` });
const r = (documentId: string, fieldPath: string, value: unknown, confidence: ExtractedFieldResult['confidence'] = 'high'): ExtractedFieldResult =>
  ({ fieldPath, value, confidence, source: src(documentId) }) as ExtractedFieldResult;

function profileFrom(...docs: ExtractedFieldResult[][]): RiskProfile {
  let p = createEmptyRiskProfile('acct');
  for (const results of docs) p = mergeIntoRiskProfile({ ...p }, results);
  return p;
}

const rollback = (p: RiskProfile, doc: string, runs: LossRun[] = []) => rollbackDocument(p, runs, doc, `${doc}.pdf`, '2026-09-29T00:00:00Z');

describe('rollbackDocument — values', () => {
  it('removes a value that came only from the removed document', () => {
    const { profile, report } = rollback(profileFrom([r('A', 'transportation.dotNumber', '1234567')]), 'A');
    expect(profile.transportation.dotNumber.isMissing).toBe(true);
    expect(report.removed.fields).toBe(1);
  });

  it('keeps a value another document also states, now credited to that document', () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1234567')], [r('B', 'transportation.dotNumber', '1234567', 'medium')]);
    expect(p.transportation.dotNumber.support?.map((s) => s.documentId)).toEqual(['B']);
    const { profile, report } = rollback(p, 'A');
    expect(profile.transportation.dotNumber.value).toBe('1234567');
    expect(profile.transportation.dotNumber.source?.documentId).toBe('B');
    expect(report.keptBySupport).toBe(1);
    // …and the other way round
    expect(rollback(p, 'B').profile.transportation.dotNumber.value).toBe('1234567');
  });

  it('keeps support when the stronger read replaces the source', () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1234567', 'medium')], [r('B', 'transportation.dotNumber', '1234567', 'high')]);
    expect(p.transportation.dotNumber.source?.documentId).toBe('B');
    expect(rollback(p, 'B').profile.transportation.dotNumber.value).toBe('1234567');
  });

  it("drops the removed document's conflicting value and clears the conflict", () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1111111', 'high')], [r('B', 'transportation.dotNumber', '2222222', 'medium')]);
    expect(p.transportation.dotNumber.isConflicting).toBe(true);
    const { profile } = rollback(p, 'B');
    expect(profile.transportation.dotNumber.value).toBe('1111111');
    expect(profile.transportation.dotNumber.isConflicting).toBe(false);
    expect(profile.transportation.dotNumber.alternateValues).toBeUndefined();
  });

  it('falls back to another document’s disagreeing value (demoted), never a guess', () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1111111', 'high')], [r('B', 'transportation.dotNumber', '2222222', 'medium')]);
    const f = rollback(p, 'A').profile.transportation.dotNumber;
    expect(f.value).toBe('2222222');
    expect(f.confidence).toBe('medium');
  });

  it('never touches a value the broker typed', () => {
    let p = profileFrom([r('A', 'transportation.dotNumber', '1111111')]);
    p = applyManualEdit(p, 'transportation', 'dotNumber', '9999999');
    const { profile, report } = rollback(p, 'A');
    expect(profile.transportation.dotNumber.value).toBe('9999999');
    expect(profile.transportation.dotNumber.reviewFlag).toBeUndefined();
    expect(report.flagged).toHaveLength(0);
  });

  it('keeps a value the broker confirmed from the removed document, flagged for review', () => {
    let p = profileFrom([r('A', 'transportation.dotNumber', '1111111')]);
    p = applyFieldResolution(p, 'transportation', 'dotNumber', { type: 'primary' });
    const { profile, report } = rollback(p, 'A');
    expect(profile.transportation.dotNumber.value).toBe('1111111');
    expect(profile.transportation.dotNumber.reviewFlag?.documentId).toBe('A');
    expect(report.flagged).toEqual([expect.objectContaining({ kind: 'field', label: 'Dot Number' })]);
  });

  it('leaves values from other documents alone', () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1111111')], [r('B', 'transportation.operatingRadius', '300')]);
    const { profile } = rollback(p, 'A');
    expect(profile.transportation.operatingRadius.value).toBe('300');
  });
});

describe('rollbackDocument — rows', () => {
  const driver = (doc: string, name: string, extra: Record<string, unknown> = {}) => r(doc, 'drivers', { name, dob: '1980-01-01', ...extra });

  it('removes rows only the document listed; keeps rows another document also lists', () => {
    const p = profileFrom([driver('A', 'John Smith'), driver('A', 'Maria Lopez')], [driver('B', 'Maria Lopez')]);
    expect(p.drivers).toHaveLength(2);
    const { profile, report } = rollback(p, 'A');
    expect(profile.drivers.map((d) => d.name)).toEqual(['Maria Lopez']);
    expect(profile.drivers[0].source?.documentId).toBe('B');
    expect(report.removed.drivers).toBe(1);
    expect(report.keptBySupport).toBe(1);
  });

  it('keeps broker-added rows', () => {
    const p = profileFrom([driver('A', 'John Smith')]);
    p.drivers = addRecordEntry(p.drivers, { name: 'Added By Broker' }, 'drv');
    expect(rollback(p, 'A').profile.drivers.map((d) => d.name)).toEqual(['Added By Broker']);
  });

  it('keeps a row the broker edited, flagged — never silently deleted', () => {
    const p = profileFrom([driver('A', 'John Smith')]);
    p.drivers = updateRecordEntry(p.drivers, p.drivers[0].id, { licenseState: 'TX' });
    const { profile, report } = rollback(p, 'A');
    expect(profile.drivers).toHaveLength(1);
    expect(profile.drivers[0].licenseState).toBe('TX');
    expect(profile.drivers[0].reviewFlag?.reason).toMatch(/edited/);
    expect(report.flagged[0]).toMatchObject({ kind: 'driver', label: 'Driver John Smith' });
  });

  it('keeps a driver the broker added notes to, flagged', () => {
    const p = profileFrom([driver('A', 'John Smith')]);
    p.drivers = [{ ...p.drivers[0], notes: [{ id: 'n1', text: 'Good driver', createdAt: '2026-01-01' }] }];
    const { profile } = rollback(p, 'A');
    expect(profile.drivers[0].reviewFlag?.reason).toMatch(/notes/);
  });

  it('removes vehicles and claims the same way', () => {
    const p = profileFrom(
      [r('A', 'vehicles', { vin: '1FUJGLDR5CLBP8834', year: 2012 }), r('A', 'lossHistory', { lossDate: '2025-01-02', claimType: 'Cargo', incurred: 1000, paid: 0, reserved: 0, status: 'closed' })],
      [r('B', 'vehicles', { vin: '3AKJHHDR5JSJW4520', year: 2018 })]
    );
    const { profile, report } = rollback(p, 'A');
    expect(profile.vehicles.map((v) => v.vin)).toEqual(['3AKJHHDR5JSJW4520']);
    expect(profile.lossHistory).toHaveLength(0);
    expect(report.removed).toMatchObject({ vehicles: 1, losses: 1 });
  });
});

describe('rollbackDocument — coverage lines', () => {
  it('removes a line the document created once nothing else supports it', () => {
    const p = profileFrom([r('A', 'coverageLine', 'motor_truck_cargo'), r('A', 'coverage.motor_truck_cargo.currentLimit', '$100,000')]);
    expect(p.coverage.find((c) => c.type === 'motor_truck_cargo')?.sources).toEqual(['A']);
    const { profile, report } = rollback(p, 'A');
    expect(profile.coverage.find((c) => c.type === 'motor_truck_cargo')).toBeUndefined();
    expect(report.removed.coverageLines).toBe(1);
  });

  it('keeps a line another document also lists', () => {
    const p = profileFrom([r('A', 'coverageLine', 'motor_truck_cargo')], [r('B', 'coverageLine', 'motor_truck_cargo')]);
    expect(rollback(p, 'A').profile.coverage.find((c) => c.type === 'motor_truck_cargo')?.sources).toEqual(['B']);
  });

  it('never removes a line the broker added', () => {
    const p = createEmptyRiskProfile('acct');
    p.coverage = [{ type: 'general_liability', requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } }];
    const merged = mergeIntoRiskProfile({ ...p }, [r('A', 'coverageLine', 'general_liability')]);
    expect(rollback(merged, 'A').profile.coverage).toHaveLength(1);
  });
});

describe('rollbackDocument — loss-run records', () => {
  const draft = (doc: string, key: string, extra: Partial<LossRun> = {}) => ({ key, carrier: 'Progressive', policyNumber: 'P-1', documentId: doc, ...extra });

  it('removes a record only the document created, and unlinks nothing else', () => {
    const p = createEmptyRiskProfile('acct');
    p.pendingLossRuns = [draft('A', 'k1')];
    const settled = settleLossRuns([], p, '2026-01-01T00:00:00Z');
    const { lossRuns, report } = rollbackDocument(settled.profile, settled.lossRuns, 'A', 'A.pdf');
    expect(lossRuns).toHaveLength(0);
    expect(report.removed.lossRuns).toBe(1);
  });

  it('keeps a record the broker edited, flagged', () => {
    const run: LossRun = { id: 'lr1', carrier: 'Progressive', documentId: 'A', editedByBroker: true, createdAt: 'x', updatedAt: 'y' };
    const { lossRuns, report } = rollbackDocument(createEmptyRiskProfile('acct'), [run], 'A', 'A.pdf');
    expect(lossRuns[0].reviewFlag?.documentId).toBe('A');
    expect(report.flagged[0].kind).toBe('lossRun');
  });

  it("clears only the fields a document filled in on the broker's own record", () => {
    const broker: LossRun = { id: 'lr1', carrier: 'Progressive', policyNumber: 'P-1', createdAt: 'x', updatedAt: 'x' };
    const p = createEmptyRiskProfile('acct');
    p.pendingLossRuns = [draft('A', 'k1', { reportDate: '2026-08-01', totalIncurred: 5000 })];
    const settled = settleLossRuns([broker], p, '2026-01-01T00:00:00Z');
    expect(settled.lossRuns[0]).toMatchObject({ reportDate: '2026-08-01', supportingDocumentIds: ['A'] });
    expect(settled.lossRuns[0].documentId).toBeUndefined(); // still the broker's record
    const { lossRuns } = rollbackDocument(settled.profile, settled.lossRuns, 'A', 'A.pdf');
    expect(lossRuns).toHaveLength(1);
    expect(lossRuns[0]).toMatchObject({ id: 'lr1', carrier: 'Progressive', policyNumber: 'P-1' });
    expect(lossRuns[0].reportDate).toBeUndefined();
    expect(lossRuns[0].totalIncurred).toBeUndefined();
  });
});

describe('rollbackDocument is pure', () => {
  it('does not change the profile it was given', () => {
    const p = profileFrom([r('A', 'transportation.dotNumber', '1234567'), r('A', 'drivers', { name: 'John Smith' })]);
    const before = JSON.stringify(p);
    rollback(p, 'A');
    expect(JSON.stringify(p)).toBe(before);
  });
});
