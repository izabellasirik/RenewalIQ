import { describe, expect, it } from 'vitest';
import { driverFromRow, driverToRow, lossFromRow, lossToRow, vehicleFromRow, vehicleToRow, withoutDetails } from '../recordRows';
import type { DriverEntry, LossEntry, VehicleEntry } from '../../../types';

// Regression: only a handful of driver fields had database columns, so an edited driver's license
// number, class, dates, address… vanished on the next load from the cloud (refresh / other device).
describe('record rows keep every field through a save and reload', () => {
  it('an edited driver comes back exactly as saved', () => {
    const driver: DriverEntry = {
      id: 'drv_1',
      name: 'John Smith',
      dob: '1980-04-02',
      address: '12 Main St, Tulsa OK',
      licenseState: 'OK',
      licenseNumber: 'D1234567',
      licenseClass: 'A',
      isCDL: true,
      issueDate: '2009-06-15',
      expirationDate: '2029-04-02',
      restrictions: 'B',
      endorsements: 'N',
      yearsExperience: { months: 198 },
      violations: 'None',
      fieldConfidence: { expirationDate: 'low' },
      isManual: true,
      lastUpdatedAt: '2026-09-27T10:00:00.000Z',
    };
    const row = driverToRow(driver, 'acct_1', 'user_1');
    expect(row.years_experience).toBe(16);
    expect(row.experience_months).toBe(198);
    // Round trip through JSON, like the database does.
    const back = driverFromRow(JSON.parse(JSON.stringify(row)));
    expect(back).toEqual({ ...driver, source: undefined });
  });

  it('a new driver field needs no repo change (it rides in details)', () => {
    const driver = { id: 'd', name: 'A', isManual: true, hireDate: '2024-01-10' } as DriverEntry & { hireDate: string };
    expect((driverFromRow(JSON.parse(JSON.stringify(driverToRow(driver, 'a', 'u')))) as typeof driver).hireDate).toBe('2024-01-10');
  });

  it('vehicles keep their plate; losses keep extra claim details', () => {
    const v: VehicleEntry = { id: 'v', vin: '1XK', make: 'Kenworth', year: 2020, plate: 'OK-123', isManual: true };
    expect(vehicleFromRow(JSON.parse(JSON.stringify(vehicleToRow(v, 'a', 'u'))))).toEqual({ ...v, model: undefined, value: undefined, bodyType: undefined, lastUpdatedAt: undefined, source: undefined });
    const l = { id: 'l', lossDate: '2025-02-01', claimType: 'Auto Liability', paid: 100, reserved: 0, incurred: 100, status: 'closed', claimNumber: 'C-9' } as LossEntry & { claimNumber: string };
    expect((lossFromRow(JSON.parse(JSON.stringify(lossToRow(l, 'a', 'u')))) as typeof l).claimNumber).toBe('C-9');
  });

  it('an old database row with no details column still loads', () => {
    const row = withoutDetails(driverToRow({ id: 'd', name: 'Old', licenseState: 'TX' }, 'a', 'u'));
    expect(driverFromRow(row)).toMatchObject({ id: 'd', name: 'Old', licenseState: 'TX' });
  });
});
