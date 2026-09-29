import { describe, expect, it } from 'vitest';
import { driverExperience, monthsSince, usableCdlIssueDate } from '../driverExperience';
import { formatExperience } from '../duration';
import { fromDraft } from '../../components/riskProfile/DriversTable';
import { extractDriverLicenseFields } from '../../services/extraction/fieldExtraction/idDocumentPatterns';
import { extractInsuranceFields } from '../../services/extraction/fieldExtraction/extractInsuranceFields';
import { mapDriverTable } from '../../services/extraction/fieldExtraction/tableMappers';
import { evaluateDriverRequirements, minDriverExperienceMonths } from '../../services/appetite/rules';
import { createEmptyRiskProfile } from '../../services/extraction/emptyRiskProfile';
import type { AppetiteRecord, DriverEntry } from '../../types';

const draft = (patch: Record<string, unknown>) => ({
  name: 'John Smith', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', issueDate: '', expirationDate: '', cdlOriginalIssueDate: '', hireDate: '', mvrReportDate: '', violations: '',
  ...patch,
});
const lines = (text: string) => text.split('\n').map((t) => ({ text: t }));

describe('driver experience from the original CDL issue date', () => {
  it('Experience = today − CDL Since, "X yrs Y mos" — the Issued date plays no part', () => {
    // Issued: May 23, 2022 · CDL Since: Aug 16, 2013 · Experience: 13 yrs 1 mo
    const d = { issueDate: '05/23/2022', cdlOriginalIssueDate: '08/16/2013', dob: '07/24/1985' };
    expect(formatExperience(driverExperience(d, '2026-09-29'))).toBe('13 yrs 1 mo');
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '2013-07-16' }, '2026-09-29'))).toBe('13 yrs 2 mos');
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '2025-09-29' }, '2026-09-29'))).toBe('1 yr');
    expect(formatExperience(driverExperience({ cdlOriginalIssueDate: '2026-01-15' }, '2026-09-29'))).toBe('8 mos');
    expect(monthsSince('2013-08-16', '2026-09-29')).toBe(157);
  });

  it('recalculates as time passes (never a stored snapshot)', () => {
    const d = { cdlOriginalIssueDate: '08/16/2013' };
    expect(formatExperience(driverExperience(d, '2026-09-29'))).toBe('13 yrs 1 mo');
    expect(formatExperience(driverExperience(d, '2027-08-16'))).toBe('14 yrs');
    expect(formatExperience(driverExperience(d, '2027-10-20'))).toBe('14 yrs 2 mos');
  });

  it('no CDL Since → "—": not from Issued, DOB, or a figure typed/stated before', () => {
    expect(driverExperience({ issueDate: '2022-05-23', dob: '1985-07-24' } as DriverEntry, '2026-09-29')).toBeUndefined();
    expect(driverExperience({ yearsExperience: 15 } as DriverEntry, '2026-09-29')).toBeUndefined();
    expect(driverExperience({ experienceFromIssueDate: true, yearsExperience: { months: 52 }, issueDate: '2022-05-23' } as DriverEntry)).toBeUndefined();
  });

  it('a CDL Since that can’t be right is not used: invalid, future, before 18, 2-digit year, or read two ways', () => {
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '13/45/2013' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2027-01-01' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2000-01-01', dob: '1985-07-24' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '08/15/13' }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2013-08-15', conflicts: { cdlOriginalIssueDate: [{ value: '2018-08-15', extractionMethod: 'image_ocr' }] } }, '2026-09-29')).toBeNull();
    expect(usableCdlIssueDate({ cdlOriginalIssueDate: '2013-08-15', dob: '1985-07-24' }, '2026-09-29')).toBe('2013-08-15');
  });

  it('entering CDL Since by hand: Issued stays separate, experience follows at once; a document’s source is kept only while the date is unchanged', () => {
    const typed = fromDraft(draft({ issueDate: '2022-05-23', cdlOriginalIssueDate: '2013-08-16' }));
    expect(typed).toMatchObject({ issueDate: '2022-05-23', cdlOriginalIssueDate: '2013-08-16', cdlOriginalIssueSource: undefined });
    expect(formatExperience(driverExperience(typed, '2026-09-29'))).toBe('13 yrs 1 mo');
    const source = { documentId: 'd1', documentName: 'MVR.pdf', page: 1, excerpt: 'CDL Original Issue Date: 08/16/2013' };
    const before = { id: 'x', cdlOriginalIssueDate: '08/16/2013', cdlOriginalIssueSource: source } as DriverEntry;
    expect(fromDraft(draft({ cdlOriginalIssueDate: '2013-08-16' }), before).cdlOriginalIssueSource).toEqual(source);
    expect(fromDraft(draft({ cdlOriginalIssueDate: '2014-01-01' }), before).cdlOriginalIssueSource).toBeUndefined();
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

  it('no CDL Since on file → unconfirmed, never matched on a stated figure', () => {
    const p = withDrivers([{ name: 'A', yearsExperience: 20 }]);
    expect(minDriverExperienceMonths(p)).toEqual({ months: null, complete: false });
    expect(evaluateDriverRequirements(record, p).status).toBe('warning');
  });

  it('a driver with unknown experience keeps it from passing outright', () => {
    const p = withDrivers([{ cdlOriginalIssueDate: cdlMonthsAgo(157) }, { name: 'Unknown CDL date' }]);
    expect(minDriverExperienceMonths(p)).toEqual({ months: 157, complete: false });
    expect(evaluateDriverRequirements(record, p).status).toBe('warning');
  });
});

describe('the MVR fills in the driver read from their license photo', () => {
  const photoRow = (): DriverEntry => ({ id: 'drv1', name: 'Sergey A Gaponov', dob: '07/24/1985', licenseNumber: 'G151-781-85-264-0', licenseState: 'FL', licenseClass: 'A', issueDate: '05/23/2022', source: { documentId: 'photo', documentName: 'license.jpg' } });
  const mvrResult = (patch: Partial<DriverEntry> = {}) => ({
    fieldPath: 'drivers' as const,
    value: { name: 'SERGEY GAPONOV', dob: '07/24/1985', licenseNumber: 'G151-781-85-264-0', cdlOriginalIssueDate: '08/15/2013', cdlOriginalIssueSource: { documentId: 'mvr', documentName: 'MVR.pdf', excerpt: 'CDL Original Issue Date: 08/15/2013' }, ...patch },
    confidence: 'medium' as const,
    source: { documentId: 'mvr', documentName: 'MVR.pdf' },
  });

  it('same license number → one driver, with the CDL date and where it came from; experience appears', async () => {
    const { mergeIntoRiskProfile } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [photoRow()];
    const merged = mergeIntoRiskProfile(p, [mvrResult()]);
    expect(merged.drivers).toHaveLength(1);
    expect(merged.drivers[0]).toMatchObject({ cdlOriginalIssueDate: '08/15/2013', cdlOriginalIssueSource: { documentId: 'mvr' }, support: [{ documentId: 'mvr' }] });
    expect(formatExperience(driverExperience(merged.drivers[0], '2026-09-29'))).toBe('13 yrs 1 mo');
    expect(merged.drivers[0].issueDate).toBe('05/23/2022'); // Issued stays its own field
  });

  it('a different license number or DOB is another person — never merged', async () => {
    const { mergeIntoRiskProfile } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [photoRow()];
    expect(mergeIntoRiskProfile(p, [mvrResult({ licenseNumber: 'X999-000-00-000-0' })]).drivers).toHaveLength(2);
    const q = createEmptyRiskProfile('b');
    q.drivers = [photoRow()];
    expect(mergeIntoRiskProfile(q, [mvrResult({ dob: '01/01/1990' })]).drivers).toHaveLength(2);
  });

  it('two documents with different CDL dates → a conflict, experience "—"', async () => {
    const { mergeIntoRiskProfile } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [{ ...photoRow(), cdlOriginalIssueDate: '2013-08-15' }];
    const merged = mergeIntoRiskProfile(p, [mvrResult({ cdlOriginalIssueDate: '08/15/2016' })]);
    expect(driverExperience(merged.drivers[0], '2026-09-29')).toBeUndefined();
  });

  it('removing the MVR removes the date it filled in (and only that)', async () => {
    const { mergeIntoRiskProfile, rollbackDocument } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [photoRow()];
    const merged = mergeIntoRiskProfile(p, [mvrResult()]);
    const { profile } = rollbackDocument(merged, [], 'mvr', 'MVR.pdf');
    expect(profile.drivers).toHaveLength(1);
    expect(profile.drivers[0].cdlOriginalIssueDate).toBeUndefined();
    expect(profile.drivers[0]).toMatchObject({ licenseNumber: 'G151-781-85-264-0', issueDate: '05/23/2022' });
  });
});

describe('the same person from two documents is one driver', () => {
  it('"Michael Mong" on a list + "Michael Scott Mong" on his license → one row, gaps filled, nothing overwritten; removing the license takes back only what it filled', async () => {
    const { mergeIntoRiskProfile, rollbackDocument } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [{ id: 'm1', name: 'Michael Mong', licenseState: 'TX', source: { documentId: 'list', documentName: 'Equipment list.pdf' } }];
    const license = {
      fieldPath: 'drivers' as const,
      value: { name: 'Michael Scott Mong', dob: '02/03/1980', licenseNumber: 'M123456', licenseState: 'CA', issueDate: '01/10/2021' },
      confidence: 'medium' as const,
      source: { documentId: 'lic', documentName: 'MICHAEL MONG.jpg' },
    };
    const merged = mergeIntoRiskProfile(p, [license]);
    expect(merged.drivers).toHaveLength(1);
    expect(merged.drivers[0]).toMatchObject({ name: 'Michael Mong', licenseState: 'TX', dob: '02/03/1980', licenseNumber: 'M123456', issueDate: '01/10/2021', support: [{ documentId: 'lic' }] });
    const { profile } = rollbackDocument(merged, [], 'lic', 'MICHAEL MONG.jpg');
    expect(profile.drivers).toHaveLength(1);
    expect(profile.drivers[0]).toMatchObject({ name: 'Michael Mong', licenseState: 'TX' });
    expect(profile.drivers[0].dob).toBeUndefined();
    expect(profile.drivers[0].licenseNumber).toBeUndefined();
  });

  it('same name but a different DOB or license number stays two people; two rows of one document are never merged', async () => {
    const { mergeIntoRiskProfile } = await import('../../services/extraction/extractionService');
    const p = createEmptyRiskProfile('a');
    p.drivers = [{ id: 'm1', name: 'Michael Mong', dob: '02/03/1980', source: { documentId: 'list', documentName: 'list.pdf' } }];
    const other = (value: Partial<DriverEntry>, documentId = 'lic') => ({ fieldPath: 'drivers' as const, value, confidence: 'high' as const, source: { documentId, documentName: 'x' } });
    expect(mergeIntoRiskProfile({ ...p, drivers: [...p.drivers] }, [other({ name: 'Michael Mong', dob: '05/05/1995' })]).drivers).toHaveLength(2);
    expect(mergeIntoRiskProfile({ ...p, drivers: [...p.drivers] }, [other({ name: 'Michael Mong', dob: '02/03/1980', licenseState: 'TX' }, 'list')]).drivers).toHaveLength(2);
  });
});

describe('CDL date layouts', () => {
  it('"Original Issue Date" under a CDL heading; not under another section', () => {
    const doc = ['DRIVER LICENSE', 'Name: ALEX MORGAN', 'Issue Date: 05/23/2022', 'CDL Information', 'Class: A', 'Original Issue Date: 08/15/2013', 'Medical Certificate', 'Original Issue Date: 01/01/2020'].join('\n');
    expect(extractDriverLicenseFields(lines(doc), doc)?.entry).toMatchObject({ cdlOriginalIssueDate: '08/15/2013', issueDate: '05/23/2022' });
    const regular = ['DRIVER LICENSE', 'Name: ALEX MORGAN', 'Regular License', 'Original Issue Date: 08/15/2003'].join('\n');
    expect(extractDriverLicenseFields(lines(regular), regular)?.entry.cdlOriginalIssueDate).toBeUndefined();
  });

  it('one row: "CDL  Class A  Original Issue: 08/15/2013"', () => {
    const doc = 'DRIVER LICENSE\nName: ALEX MORGAN\nCDL   Class A   Original Issue: 08/15/2013';
    expect(extractDriverLicenseFields(lines(doc), doc)?.entry.cdlOriginalIssueDate).toBe('08/15/2013');
  });
});
