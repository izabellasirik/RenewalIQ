import { describe, expect, it } from 'vitest';
import { LICENSE_UNREADABLE_TITLE, licenseReadIssue, licenseReadReasons, licenseWarnings } from '../licenseReadability';

describe('unreadable driver licenses', () => {
  it('says why, field by field', () => {
    expect(licenseReadReasons({ category: 'driver_license', readFailed: false, driver: { name: 'John Smith', licenseNumber: 'D123', dob: '1980-01-01', fieldConfidence: { licenseNumber: 'low' } } })).toEqual([
      'license number unclear',
      'expiration date unreadable',
    ]);
  });

  it('nothing readable at all → image quality', () => {
    expect(licenseReadReasons({ category: 'driver_license', readFailed: true })).toEqual(['image quality too low — no text could be read']);
    expect(licenseReadReasons({ category: 'driver_license', readFailed: false })).toEqual(['no driver details could be read from the image']);
  });

  it('a clear license, or another document, raises nothing', () => {
    expect(licenseReadReasons({ category: 'driver_license', readFailed: false, driver: { name: 'A', licenseNumber: '1', expirationDate: '2030-01-01', dob: '1980-01-01' } })).toEqual([]);
    expect(licenseReadReasons({ category: 'loss_run', readFailed: true })).toEqual([]);
  });

  it('round-trips through the document warnings (which are saved with the document)', () => {
    const warnings = licenseWarnings(['expiration date unreadable']);
    expect(warnings[0]).toBe(LICENSE_UNREADABLE_TITLE);
    expect(licenseReadIssue({ warnings })).toEqual({ title: LICENSE_UNREADABLE_TITLE, reason: 'expiration date unreadable' });
    expect(licenseReadIssue({ warnings: ['Scanned PDF'] })).toBeNull();
  });
});

describe('driving records (MVRs) are not licenses', () => {
  it('an MVR without a date of birth is never "unclear"', async () => {
    const { licenseReadReasons, isDriverRecordDocument } = await import('../licenseReadability');
    expect(isDriverRecordDocument('Jordan Avery- MVR PULL (3).pdf')).toBe(true);
    expect(isDriverRecordDocument('license-front.jpg', 'MOTOR VEHICLE RECORD\nDriver: Jordan Avery')).toBe(true);
    expect(isDriverRecordDocument('license-front.jpg', 'DRIVER LICENSE\nDOB 01/02/1985')).toBe(false);
    expect(licenseReadReasons({ category: 'driver_license', readFailed: false, driver: { name: 'Jordan Avery', licenseNumber: 'T1000001', expirationDate: '2028-01-01' }, isDriverRecord: true })).toEqual([]);
    expect(licenseReadReasons({ category: 'driver_license', readFailed: false, driver: { name: 'Jordan Avery', licenseNumber: 'T1000001', expirationDate: '2028-01-01' } })).toEqual(['date of birth unreadable']);
  });

  it('"Clearer driver license" items the app added are recognised; ones a person added or that were already requested are kept', async () => {
    const { isAutoLicenseRequest } = await import('../licenseReadability');
    const auto = (status: 'missing' | 'requested', doc: string) => ({ label: 'Clearer driver license — Jordan Avery', status, notes: `Needed because ${doc} could not be read clearly.` });
    expect(isAutoLicenseRequest(auto('missing', 'Jordan Avery- MVR PULL (3).pdf'))).toBe(true);
    expect(isAutoLicenseRequest(auto('missing', 'license-front.jpg'))).toBe(true);
    expect(isAutoLicenseRequest(auto('requested', 'license-front.jpg'))).toBe(false);
    expect(isAutoLicenseRequest({ label: 'Clearer driver license — Jordan Avery', status: 'missing' })).toBe(false);
    expect(isAutoLicenseRequest({ label: 'Clearer driver license — Jordan Avery', status: 'missing', notes: 'Client said they will send it Monday' })).toBe(false);
  });
});
