import { describe, expect, it } from 'vitest';
import { extractInsuranceFields } from '../fieldExtraction/extractInsuranceFields';
import { gateExtraction } from '../validation';
import { mergeIntoRiskProfile, applyReviewCandidate } from '../extractionService';
import { createEmptyRiskProfile } from '../emptyRiskProfile';
import { deriveDriverSummary, deriveVehicleSummary } from '../../../utils/deriveInsights';
import { evaluateFleetSize } from '../../appetite/rules';
import type { AppetiteRecord } from '../../../types';
import type { DriverEntry, ExtractedFieldResult, VehicleEntry } from '../../../types';
import { ALL_FIXTURES, DRIVER_SCHEDULE, GARBAGE, LICENSE, MISREAD_VIN, MVR, MVR_COLUMNS, SCHEDULE, TITLE, TITLE_VIN, UNCERTAIN_VIN, type Fixture } from './fixtures/syntheticDocuments';

const NOW = new Date('2026-09-29T12:00:00');

/** The whole read: document → readers → classify/validate → applied / review / rejected. */
function run(f: Fixture) {
  const results = extractInsuranceFields(f.doc, { documentId: f.id, documentName: f.doc.documentName, isImageSource: f.scanned });
  return gateExtraction({ results, text: f.doc.text, fileName: f.doc.documentName, scanned: f.scanned }, NOW);
}
const of = <T extends { fieldPath: string }>(list: T[], path: string) => list.filter((r) => r.fieldPath === path);
const drivers = (list: ExtractedFieldResult[]) => of(list, 'drivers').map((r) => r.value as DriverEntry);
const vehicles = (list: ExtractedFieldResult[]) => of(list, 'vehicles').map((r) => r.value as VehicleEntry);
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether one applied result is right, judged against what a careful human takes from the fixture.
 * Anything applied that isn't in `expected` counts as wrong.
 */
function isCorrect(r: ExtractedFieldResult, f: Fixture): boolean {
  if (r.fieldPath === 'drivers') {
    const d = r.value as DriverEntry;
    return f.expected.drivers.some((e) => norm(e.name) === norm(d.name) && (!e.licenseNumber || norm(e.licenseNumber) === norm(d.licenseNumber)));
  }
  if (r.fieldPath === 'vehicles') {
    const v = r.value as VehicleEntry;
    return f.expected.vehicles.some((e) => (e.vin ? e.vin === v.vin : true) && (e.year === undefined || e.year === v.year) && (e.make === undefined || norm(e.make) === norm(v.make)));
  }
  if (r.fieldPath in f.expected.fields) return JSON.stringify(f.expected.fields[r.fieldPath]) === JSON.stringify(r.value);
  // Other values (a vehicle type from a schedule column, a minimum experience) are judged by being derived from rows that were right.
  return r.extractionMethod === 'deterministic_import' && (r.fieldPath === 'transportation.vehicleTypes' || r.fieldPath === 'transportation.minDriverExperienceYears');
}

describe('A — driver license', () => {
  it('one driver, nothing else becomes a driver', () => {
    const g = run(LICENSE);
    expect(g.classification.category).toBe('driver_license');
    expect(drivers(g.applied)).toHaveLength(1);
    expect(drivers(g.applied)[0]).toMatchObject({ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0', dob: '07/24/1985', licenseClass: 'A', isCDL: true });
    expect(of(g.review, 'drivers')).toHaveLength(0);
  });
});

describe('B — MVR with a medical certificate', () => {
  it('one driver: the subject — not the examiner, "Jurisdiction", or "Speciality Code"', () => {
    const g = run(MVR);
    expect(g.classification.category).toBe('mvr');
    const [d, ...others] = drivers(g.applied);
    expect(others).toHaveLength(0);
    expect(d).toMatchObject({ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0', expirationDate: '07/24/2030' });
    // The examiner's license number is not the driver's.
    expect(JSON.stringify([...g.applied, ...g.review])).not.toContain('ME99887766');
    expect(JSON.stringify(g.applied)).not.toMatch(/Jordan|Jurisdiction|Speciality/i);
  });

  it('laid out in columns: labels are dropped, and with two people the subject is not guessed', () => {
    const g = run(MVR_COLUMNS);
    expect(g.classification.category).toBe('mvr');
    expect(drivers(g.applied)).toHaveLength(0);
    const held = of(g.review, 'drivers').map((c) => (c.value as DriverEntry).name);
    expect(held).toEqual(['Alex R Morgan', 'Jordan P Lee']);
    expect(of(g.review, 'drivers')[0].reason).toMatch(/one driver, but 2 possible drivers/);
    // "Address:", "Jurisdiction:", "Speciality Code:" are neither applied nor offered.
    expect(JSON.stringify([...g.applied, ...g.review])).not.toMatch(/Address:|Jurisdiction|Speciality|REG\. NUMBER/);
  });
});

describe('C — vehicle title', () => {
  it('one vehicle from its VIN; labels, the owner address and ZIP are not vehicles', () => {
    const g = run(TITLE);
    expect(g.classification.category).toBe('vehicle_title');
    expect(vehicles(g.applied)).toEqual([expect.objectContaining({ vin: TITLE_VIN, year: 2015, make: 'Freightliner' })]);
    expect(of(g.review, 'vehicles')).toHaveLength(0);
    expect(of(g.applied, 'transportation.fleetSize')).toHaveLength(0);
    // The owner's details are not the business's; "{=a" is not an address.
    expect(g.applied.some((r) => r.fieldPath.startsWith('business.'))).toBe(false);
    expect(JSON.stringify([...g.applied, ...g.review])).not.toContain('{=a');
  });
});

describe('D — vehicle schedule', () => {
  it('keeps every legitimate vehicle (no one-vehicle limit on a schedule)', () => {
    const g = run(SCHEDULE);
    expect(g.classification.category).toBe('vehicle_schedule');
    expect(vehicles(g.applied).map((v) => v.vin)).toEqual(SCHEDULE.expected.vehicles.map((v) => v.vin));
    expect(of(g.applied, 'transportation.fleetSize')[0].value).toBe(4);
    expect(g.review).toHaveLength(0);
  });
});

describe('E — garbage', () => {
  it('nothing applied, nothing even offered for review', () => {
    const g = run(GARBAGE);
    expect(g.applied.filter((r) => r.fieldPath !== 'coverageLine')).toEqual([]);
    expect(g.review).toEqual([]);
  });
});

describe('F — one uncertain identifier', () => {
  it('held for review with the reason — not applied, not invented, not thrown away', () => {
    const g = run(UNCERTAIN_VIN);
    expect(vehicles(g.applied)).toEqual([]);
    const [held] = of(g.review, 'vehicles');
    expect(held.value).toMatchObject({ vin: MISREAD_VIN, year: 2021, make: 'Freightliner' });
    expect(held.reason).toMatch(/VIN could not be read confidently/);
  });

  it('a date that cannot exist is questioned, not reinterpreted', () => {
    const doc = { ...LICENSE.doc, text: LICENSE.doc.text.replace('DOB: 07/24/1985', 'DOB: 13/45/1985') };
    const g = run({ ...LICENSE, doc });
    expect(drivers(g.applied)).toEqual([]);
    expect(of(g.review, 'drivers')[0].reason).toMatch(/isn’t a valid date/);
  });

  it('applied by the broker, it counts; corrected, it’s the broker’s', () => {
    const g = run(UNCERTAIN_VIN);
    const [held] = g.review;
    const fixedVin = MISREAD_VIN; // the broker checked the paper and it is right
    const profile = applyReviewCandidate(createEmptyRiskProfile('a'), held, { ...(held.value as object), vin: fixedVin });
    expect(profile.vehicles).toHaveLength(1);
    expect(profile.vehicles[0]).toMatchObject({ vin: fixedVin, isManual: true, source: expect.objectContaining({ documentId: UNCERTAIN_VIN.id }) });
  });
});

describe('G — downstream numbers only see applied data', () => {
  it('fleet count, driver count, average age and Market Finder ignore held and rejected candidates', () => {
    let profile = createEmptyRiskProfile('acct');
    for (const f of [TITLE, GARBAGE, MVR_COLUMNS, UNCERTAIN_VIN]) profile = mergeIntoRiskProfile(profile, run(f).applied);
    expect(profile.vehicles).toHaveLength(1);
    expect(profile.drivers).toHaveLength(0);
    expect(deriveVehicleSummary(profile.vehicles).totalVehicleCount).toBe(1);
    expect(deriveVehicleSummary(profile.vehicles).averageVehicleAge).toBe(NOW.getFullYear() - 2015);
    expect(deriveDriverSummary(profile.drivers).driverCount).toBe(0);
    expect(profile.transportation.fleetSize.isMissing).toBe(true);
    // Market Finder: no fleet size was confirmed, so it asks rather than matching on a made-up 7.
    const record = { marketName: 'Test Market', fleetSize: { value: { min: 5, max: 50 }, verificationStatus: 'VERIFIED', ruleType: 'HARD_RULE' } } as unknown as AppetiteRecord;
    expect(evaluateFleetSize(record, profile).status).toBe('warning');
  });
});

describe('H — good documents keep working', () => {
  it('a driver schedule applies every driver and the count', () => {
    const g = run(DRIVER_SCHEDULE);
    expect(drivers(g.applied).map((d) => d.name)).toEqual(['Jamie Carter', 'Morgan Diaz', 'Riley Chen']);
    expect(of(g.applied, 'transportation.driverCount')[0].value).toBe(3);
    expect(g.review).toHaveLength(0);
  });
});

describe('auto-apply precision', () => {
  /**
   * AUTO-APPLY PRECISION = correct automatically applied fields/entities ÷ all automatically
   * applied ones, over every synthetic fixture. The bar is 100%: anything wrong that gets applied
   * is a failure, however much else was read. (Recall is reported, not optimized.)
   */
  it('is 100% across the synthetic documents', () => {
    let applied = 0;
    let correct = 0;
    let expectedEntities = 0;
    let appliedEntities = 0;
    const wrong: string[] = [];
    for (const f of ALL_FIXTURES) {
      const g = run(f);
      for (const r of g.applied) {
        if (r.fieldPath === 'coverageLine') continue;
        applied++;
        if (isCorrect(r, f)) correct++;
        else wrong.push(`${f.id}: ${r.fieldPath} = ${JSON.stringify(r.value).slice(0, 80)}`);
      }
      expectedEntities += f.expected.drivers.length + f.expected.vehicles.length;
      appliedEntities += drivers(g.applied).length + vehicles(g.applied).length;
    }
    const precision = applied ? correct / applied : 1;
    console.info(`[extraction] auto-apply precision ${(precision * 100).toFixed(1)}% (${correct}/${applied}); entity recall ${appliedEntities}/${expectedEntities}`);
    expect(wrong).toEqual([]);
    expect(precision).toBe(1);
  });
});

describe('an application that mentions licenses, CDLs and MVRs is still an application', () => {
  it('its business fields are read and applied — not held as a license’s or an MVR’s', () => {
    const text = [
      'COMMERCIAL AUTO APPLICATION',
      'Named Insured: ATCO SERVICES LLC',
      'Legal Entity: LLC',
      'FEIN: 12-3456789',
      'Mailing Address: 100 W Main St, Chicago, IL 60601',
      'Years in Business: 7',
      'DOT Number: 1234567',
      'DRIVER INFORMATION',
      'Driver Name   DOB   Driver License #   State   CDL Class',
      'Do you obtain MVRs on all drivers? Yes',
    ].join('\n');
    const f: Fixture = { id: 'app', scanned: false, doc: { documentName: 'ATCO application.pdf', fileType: 'txt', text, warnings: [] }, expected: { drivers: [], vehicles: [], fields: {} } };
    const g = run(f);
    expect(g.classification.category).toBe('application');
    const applied = Object.fromEntries(g.applied.map((r) => [r.fieldPath, r.value]));
    expect(applied).toMatchObject({
      'business.namedInsured': 'ATCO SERVICES LLC',
      'business.fein': '12-3456789',
      'business.address': '100 W Main St, Chicago, IL 60601',
      'business.state': 'IL',
      'transportation.dotNumber': '1234567',
    });
    expect(drivers(g.applied)).toEqual([]); // no bogus "driver" from the license reader
  });

  it('a real license or MVR is unaffected', () => {
    expect(run(LICENSE).classification.category).toBe('driver_license');
    expect(run(MVR).classification.category).toBe('mvr');
  });
});
