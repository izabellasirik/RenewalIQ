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
