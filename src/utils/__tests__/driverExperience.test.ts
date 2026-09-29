import { describe, expect, it } from 'vitest';
import { driverExperience, driverExperienceWithBasis, monthsSince, usableCdlIssueDate } from '../driverExperience';
import { formatExperience } from '../duration';
import { fromDraft } from '../../components/riskProfile/DriversTable';
import { EMPTY_DURATION_DRAFT } from '../durationDraft';
import { extractDriverLicenseFields } from '../../services/extraction/fieldExtraction/idDocumentPatterns';
import { extractInsuranceFields } from '../../services/extraction/fieldExtraction/extractInsuranceFields';
import { mapDriverTable } from '../../services/extraction/fieldExtraction/tableMappers';
import { evaluateDriverRequirements, minDriverExperienceMonths } from '../../services/appetite/rules';
import { createEmptyRiskProfile } from '../../services/extraction/emptyRiskProfile';
import type { AppetiteRecord, DriverEntry } from '../../types';

const draft = (patch: Record<string, unknown>) => ({
  name: 'John Smith', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', issueDate: '', expirationDate: '', cdlOriginalIssueDate: '', hireDate: '', mvrReportDate: '', yearsExperience: EMPTY_DURATION_DRAFT, violations: '',
  ...patch,
});
const lines = (text: string) => text.split('\n').map((t) => ({ text: t }));

describe('driver experience from the original CDL issue date', () => {
  it('counts whole months to today and reads "13 yrs 1 mo"', () => {
    expect(monthsSince('2013-08-15', '2026-09-29')).toBe(157);
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '08/15/2013' }, '2026-09-29'))).toBe('13 yrs 1 mo');
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '2025-09-29' }, '2026-09-29'))).toBe('1 yr');
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '2026-01-15' }, '2026-09-29'))).toBe('8 mo');
    // Recalculated as time passes, never stored as a snapshot.
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '08/15/2013' }, '2027-08-15'))).toBe('14 yrs');
  });

  it('never from the DOB or the current license’s issue/renewal date — "—" instead', () => {
    expect(driverExperience({ dob: '1985-07-24' } as DriverEntry, '2026-09-29')).toBeUndefined();
    // Legacy rows counted from the current license's issue date: that was a renewal date, not experience.
    expect(driverExperience({ experienceFromIssueDate: true, yearsExperience: { months: 52 } } as DriverEntry)).toBeUndefined();
  });

  it('a CDL date that can’t be right is not used: invalid, future, before 18, or read two ways', () => {
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '13/45/2013' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2027-01-01' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2000-01-01', dob: '1985-07-24' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '08/15/13' }, '2026-09-29')).toBeNull(); // a 2-digit year is ambiguous
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2013-08-15', conflicts: { cdlOriginalIssueDate: [{ value: '2018-08-15', extractionMethod: 'image_ocr' }] } }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2013-08-15', dob: '1985-07-24' }, '2026-09-29')).toBe('2013-08-15');
  });

  it('a stated figure is used as stated; a broker correction wins over the calculation', () => {
    expect(driverExperienceWithBasis({ yearsExperience: 15 })).toEqual({ value: 15, basis: 'stated' });
    expect(driverExperienceWithBasis({ cdlOriginalIssueDate: '2013-08-15', yearsExperience: { months: 60 }, experienceManual: true }, '2026-09-29')).toEqual({ value: { months: 60 }, basis: 'manual' });
    expect(driverExperienceWithBasis({ cdlOriginalIssueDate: '2013-08-15', yearsExperience: { months: 60 } }, '2026-09-29')?.basis).toBe('cdl');
  });

  it('saving: a CDL date → calculated; a different typed figure → the broker’s correction; the source is kept while the date is unchanged', () => {
    const auto = fromDraft(draft({ cdlOriginalIssueDate: '2013-08-15', hireDate: '2024-05-01' }), false);
    expect(auto).toMatchObject({ cdlOriginalIssueDate: '2013-08-15', experienceManual: undefined, yearsExperience: undefined, hireDate: '2024-05-01' });
    const corrected = fromDraft(draft({ cdlOriginalIssueDate: '2013-08-15', yearsExperience: { years: '3', months: '0', orMore: false } }), true);
    expect(corrected).toMatchObject({ experienceManual: true, yearsExperience: { months: 36 } });
    const source = { documentId: 'd1', documentName: 'MVR.pdf', page: 1, excerpt: 'CDL Original Issue Date: 08/15/2013' };
    const before = { id: 'x', cdlOriginalIssueDate: '08/15/2013', cdlOriginalIssueSource: source } as DriverEntry;
    expect(fromDraft(draft({ cdlOriginalIssueDate: '2013-08-15' }), false, before).cdlOriginalIssueSource).toEqual(source);
    expect(fromDraft(draft({ cdlOriginalIssueDate: '2014-01-01' }), false, before).cdlOriginalIssueSource).toBeUndefined();
  });
});

describe('reading the original CDL issue date', () => {
  const MVR = [
    'MOTOR VEHICLE RECORD',
    'Name: ALEX R MORGAN',
    'DOB: 07/24/1985',
    'License Number: M512-781-85-264-0',
    'Class: A',
    'Issue Date: 05/23/2022',
    'CDL Original Issue Date: 08/15/2013',
    'Expiration Date: 07/24/2030',
  ].join('\n');

  it('from an MVR — not confused with the current license’s issue date', () => {
    const r = extractDriverLicenseFields(lines(MVR), MVR)!;
    expect(r.entry).toMatchObject({ issueDate: '05/23/2022', cdlOriginalIssueDate: '08/15/2013' });
    expect(r.cdlOriginalIssueLine?.text).toBe('CDL Original Issue Date: 08/15/2013');
    // The same when the CDL line comes first.
    const first = MVR.replace('Issue Date: 05/23/2022\nCDL Original Issue Date: 08/15/2013', 'CDL Original Issue Date: 08/15/2013\nIssue Date: 05/23/2022');
    expect(extractDriverLicenseFields(lines(first), first)!.entry).toMatchObject({ issueDate: '05/23/2022', cdlOriginalIssueDate: '08/15/2013' });
  });

  it('keeps where it was read', () => {
    const [d] = extractInsuranceFields({ documentName: 'MVR.pdf', fileType: 'txt', text: MVR, warnings: [] }, { documentId: 'doc1', documentName: 'MVR.pdf' }).filter((r) => r.fieldPath === 'drivers');
    expect((d.value as DriverEntry).cdlOriginalIssueSource).toMatchObject({ documentId: 'doc1', excerpt: 'CDL Original Issue Date: 08/15/2013' });
  });

  it('phrasings that say CDL/commercial; a bare "Original Issue Date" is not assumed to be the CDL', () => {
    const read = (line: string) => extractDriverLicenseFields(lines(`DRIVER LICENSE\nName: ALEX MORGAN\n${line}`), `DRIVER LICENSE ${line}`)?.entry.cdlOriginalIssueDate;
    expect(read('Original CDL Issue Date: 08/15/2013')).toBe('08/15/2013');
    expect(read('Commercial License Originally Issued: 08/15/2013')).toBe('08/15/2013');
    expect(read('CDL Orig Iss 08/15/2013')).toBe('08/15/2013');
    expect(read('Class A Original Issue Date: 08/15/2013')).toBe('08/15/2013');
    expect(read('CDL Since: 2013-08-15')).toBe('2013-08-15');
    expect(read('Original Issue Date: 08/15/2013')).toBeUndefined();
  });

  it('from a driver schedule column, separate from the license issue date', () => {
    const [row] = mapDriverTable({ headers: ['Driver Name', 'DOB', 'License Issue Date', 'Original CDL Issue Date'], rows: [['Jamie Carter', '03/14/1980', '02/01/2024', '06/10/2005']] });
    expect(row.entry).toMatchObject({ issueDate: '2024-02-01', cdlOriginalIssueDate: '2005-06-10' });
  });
});

describe('carrier appetite uses the calculated experience', () => {
  const record = {
    marketName: 'Test Market',
    minDriverAge: { value: null, verificationStatus: 'VERIFIED', ruleType: 'UNKNOWN' },
    minDriverExperienceYears: { value: 2, verificationStatus: 'VERIFIED', ruleType: 'HARD_RULE' },
  } as unknown as AppetiteRecord;
  const withDrivers = (drivers: Partial<DriverEntry>[]) => {
    const p = createEmptyRiskProfile('a');
    p.drivers = drivers.map((d, i) => ({ id: `d${i}`, ...d }));
    p.transportation.minDriverAge = { value: 30, confidence: 'high', isMissing: false, isConflicting: false };
    return p;
  };
  const cdlMonthsAgo = (m: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    return d.toISOString().slice(0, 10);
  };

  it('fails a 2-year minimum when a driver’s CDL is 13 months old, passes when all clear it', () => {
    expect(evaluateDriverRequirements(record, withDrivers([{ cdlOriginalIssueDate: cdlMonthsAgo(157) }, { cdlOriginalIssueDate: cdlMonthsAgo(13) }])).status).toBe('fail');
    expect(evaluateDriverRequirements(record, withDrivers([{ cdlOriginalIssueDate: cdlMonthsAgo(157) }, { cdlOriginalIssueDate: cdlMonthsAgo(40) }])).status).toBe('pass');
  });

  it('a driver with unknown experience keeps it from passing outright', () => {
    const p = withDrivers([{ cdlOriginalIssueDate: cdlMonthsAgo(157) }, { name: 'Unknown CDL date' }]);
    expect(minDriverExperienceMonths(p)).toEqual({ months: 157, complete: false });
    expect(evaluateDriverRequirements(record, p).status).toBe('warning');
  });
});
