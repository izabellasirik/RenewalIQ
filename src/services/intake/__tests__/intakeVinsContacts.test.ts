import { describe, expect, it } from 'vitest';
import { intakeExtraContacts, intakeVehicles } from '../importIntakeSubmission';
import type { IntakeSubmission } from '../../../types';

const sub = (over: Partial<IntakeSubmission>) => ({ id: 'isub_1', contactName: 'Ann', contactEmail: 'ann@x.com', ...over }) as IntakeSubmission;

describe('intake VINs and extra contacts on import', () => {
  it('each VIN becomes a Fleet row from the intake form — none twice, none already on the list', () => {
    const v = intakeVehicles(sub({ vinNumbers: ['1HGCM82633A004352', '1hgcm82633a004352', '3AKJHHDR5LSLA1234'] }), [{ id: 'x', vin: '3AKJHHDR5LSLA1234' }]);
    expect(v.map((x) => x.vin)).toEqual(['1HGCM82633A004352']);
    expect(v[0].source?.documentName).toBe('Intake form submission');
    expect(intakeVehicles(sub({}))).toEqual([]);
  });
  it('extra contacts: named ones only, not the main contact again', () => {
    const c = intakeExtraContacts(sub({ additionalContacts: [{ name: 'Bob', email: 'bob@x.com', phone: '555' }, { name: 'Ann B', email: 'ANN@x.com' }, { email: 'no-name@x.com' }] }), [{ name: 'Ann', email: 'ann@x.com' }]);
    expect(c).toEqual([{ name: 'Bob', email: 'bob@x.com', phone: '555' }]);
  });
});
