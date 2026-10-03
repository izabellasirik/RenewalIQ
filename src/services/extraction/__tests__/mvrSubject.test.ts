import { describe, expect, it } from 'vitest';
import { extractInsuranceFields } from '../fieldExtraction/extractInsuranceFields';
import { gateExtraction } from '../validation';
import { mergeIntoRiskProfile } from '../extractionService';
import { createEmptyRiskProfile } from '../emptyRiskProfile';
import type { DriverEntry, ExtractedFieldResult } from '../../../types';
import type { RawDocument } from '../../ingestion';

/**
 * An MVR yields (or enriches) its license holder only — never a person it merely mentions. Every
 * name and number here is invented; no real record is (or may be) committed to this repository.
 */
const NOW = new Date('2026-09-29T12:00:00');
const SUBJECT = { name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0', dob: '07/24/1985' };
const OTHERS = /whitfield|holloway|karen|white|paul|brown|robert|clerk|jordan|lee|dana|mark|emily|stone/i;

const doc = (name: string, lines: string[], tables?: RawDocument['tables']): RawDocument => ({ documentName: name, fileType: 'txt', text: lines.join('\n'), warnings: [], ...(tables ? { tables } : {}) });

function run(d: RawDocument, extra: ExtractedFieldResult[] = []) {
  const results = [...extractInsuranceFields(d, { documentId: d.documentName, documentName: d.documentName, isImageSource: false }), ...extra];
  return gateExtraction({ results, text: d.text, fileName: d.documentName, scanned: false }, NOW);
}
const applied = (g: ReturnType<typeof run>) => g.applied.filter((r) => r.fieldPath === 'drivers').map((r) => r.value as DriverEntry);
const held = (g: ReturnType<typeof run>) => g.review.filter((r) => r.fieldPath === 'drivers').map((r) => r.value as DriverEntry);

const LAYOUTS: Record<string, RawDocument> = {
  'requester section before the driver': doc('mvr-requester.pdf', [
    'MOTOR VEHICLE REPORT',
    'Requested By',
    'Name: DANA WHITFIELD',
    'Company: Harbor Insurance Agency',
    'Phone: 555-010-2000',
    'Driver Information',
    'Name: ALEX R MORGAN',
    'DOB: 07/24/1985',
    'License Number: M512-781-85-264-0',
    'License State: FL',
    'Class: A',
    'Status: VALID',
    'Original CDL Issue Date: 05/10/2008',
    'Expiration Date: 07/24/2030',
  ]),
  'employer contact, notes, reviewer and custodian': doc('driver-record.pdf', [
    'DRIVER RECORD',
    'Driver Name: ALEX R MORGAN',
    'Date of Birth: 07/24/1985',
    'License #: M512-781-85-264-0',
    'State: FL',
    'Class: A CDL',
    'Employer: Coastal Freight LLC',
    'Name: MARK HOLLOWAY',
    'Title: Safety Director',
    'Notes: Previously co-driver with KAREN WHITE',
    'Reviewed by: OFFICER PAUL BROWN',
    'Certified by: ROBERT CLERK, Custodian of Records',
  ]),
  'medical examiner before the license holder': doc('mvr-examiner-first.pdf', [
    'DRIVING RECORD',
    'MEDICAL EXAMINER',
    'Name: JORDAN P LEE',
    'License Number: ME99887766',
    'National Registry #: 4455667788',
    'LICENSE HOLDER',
    'Name: ALEX R MORGAN',
    'DOB: 07/24/1985',
    'License Number: M512-781-85-264-0',
    'Issue Date: 05/23/2022',
  ]),
  'examiner lines with no heading': doc('mvr-inline-examiner.pdf', [
    'MOTOR VEHICLE RECORD',
    'Name: ALEX R MORGAN',
    'DOB: 07/24/1985',
    'License Number: M512-781-85-264-0',
    'Class: A',
    'Medical Examiner Name: EMILY STONE',
    'License Number: ME55512345',
    'Phone: 305-555-0199',
  ]),
  'a table of associated persons': doc(
    'mvr-associated.pdf',
    ['MOTOR VEHICLE RECORD', 'Name: ALEX R MORGAN', 'DOB: 07/24/1985', 'License Number: M512-781-85-264-0', 'Class: A'],
    [{ headers: ['Name', 'DOB', 'License Number'], rows: [['KAREN WHITE', '02/02/1990', 'W123-456-78-901-0']] }]
  ),
};

describe('MVR: only the subject / license holder becomes a driver', () => {
  for (const [label, d] of Object.entries(LAYOUTS)) {
    it(label, () => {
      const g = run(d);
      expect(g.classification.category).toBe('mvr');
      const got = applied(g);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject(SUBJECT);
      // Nobody else is applied, and nobody else's details were attached to the driver.
      expect(JSON.stringify(got)).not.toMatch(OTHERS);
      expect(JSON.stringify(got)).not.toMatch(/ME99887766|ME55512345|W123-456/);
    });
  }

  it('the person listed in a table is held for review, not dropped silently and not applied', () => {
    const g = run(LAYOUTS['a table of associated persons']);
    expect(held(g).map((d) => d.name)).toEqual(['KAREN WHITE']);
    expect(g.review.find((r) => r.fieldPath === 'drivers')?.reason).toMatch(/someone else the record mentions/);
  });

  it('two different people and no way to tell whose record it is → nothing applied, sent to Needs Review', () => {
    const g = run(doc('two-names.pdf', ['MOTOR VEHICLE RECORD', 'Name: ALEX R MORGAN', 'Name: SAM T RIVERA', 'DOB: 07/24/1985', 'License Number: M512-781-85-264-0']));
    expect(applied(g)).toHaveLength(0);
    expect(held(g)).toHaveLength(1);
  });

  it('a second reader (e.g. the vision model) naming the examiner as the driver is held for review', () => {
    const d = LAYOUTS['medical examiner before the license holder'];
    const examinerAsDriver: ExtractedFieldResult = {
      fieldPath: 'drivers',
      value: { name: 'Jordan P Lee', licenseNumber: 'ME99887766', dob: '01/02/1970' },
      confidence: 'medium',
      extractionMethod: 'ai_vision' as never,
      source: { documentId: 'x', documentName: d.documentName },
    };
    const g = run(d, [examinerAsDriver]);
    expect(applied(g).map((x) => x.name)).toEqual(['Alex R Morgan']);
    expect(held(g).map((x) => x.name)).toEqual(['Jordan P Lee']);
    expect(g.review.find((r) => r.fieldPath === 'drivers')?.reason).toMatch(/doesn’t match this driving record’s license holder/);
  });

  it('a driver’s license card is unchanged: its holder is read', () => {
    const g = run(doc('license.jpg', ['FLORIDA DRIVER LICENSE', 'Name: ALEX R MORGAN', 'DOB: 07/24/1985', 'DL #: M512-781-85-264-0', 'Class: A', 'Exp: 07/24/2030']));
    expect(applied(g)).toHaveLength(1);
    expect(applied(g)[0]).toMatchObject({ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0' });
  });
});

describe('MVR → Risk Profile: an existing driver is enriched, not duplicated', () => {
  const mvr = LAYOUTS['requester section before the driver'];
  const withDriver = (existing: Partial<DriverEntry>) => {
    const p = createEmptyRiskProfile('acct');
    p.drivers = [{ id: 'd1', ...existing } as DriverEntry];
    return p;
  };

  it('same license number (name written differently, no DOB on file) → one driver, filled in', () => {
    const p = mergeIntoRiskProfile(withDriver({ name: 'Alex Morgan', licenseNumber: 'M512781852640' }), run(mvr).applied);
    expect(p.drivers).toHaveLength(1);
    expect(p.drivers[0]).toMatchObject({ id: 'd1', dob: '07/24/1985' });
  });

  it('same name + DOB (no license on file) → one driver, license added', () => {
    const p = mergeIntoRiskProfile(withDriver({ name: 'MORGAN, ALEX R', dob: '1985-07-24' }), run(mvr).applied);
    expect(p.drivers).toHaveLength(1);
    expect(p.drivers[0]).toMatchObject({ id: 'd1', licenseNumber: 'M512-781-85-264-0' });
  });

  it('the requester, examiner and others never appear in the profile; provenance points at the MVR', () => {
    const p = mergeIntoRiskProfile(createEmptyRiskProfile('acct'), run(mvr).applied);
    expect(p.drivers.map((d) => d.name)).toEqual(['Alex R Morgan']);
    expect(p.drivers[0].source?.documentName).toBe('mvr-requester.pdf');
    expect(p.drivers[0].cdlOriginalIssueDate).toBe('05/10/2008');
    expect(p.drivers[0].cdlOriginalIssueSource?.excerpt).toContain('Original CDL Issue Date');
  });

  it('a different person on file stays separate', () => {
    const p = mergeIntoRiskProfile(withDriver({ name: 'Sam Rivera', licenseNumber: 'R111-222-33-444-0', dob: '01/01/1990' }), run(mvr).applied);
    expect(p.drivers.map((d) => d.name)).toEqual(['Sam Rivera', 'Alex R Morgan']);
  });
});
