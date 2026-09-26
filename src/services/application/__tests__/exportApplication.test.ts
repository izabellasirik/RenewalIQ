import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import { emptyField, manualField } from '../../../types';
import { mapRiskProfileToApplication } from '../fieldMappingEngine';
import { APPLICATION_TEMPLATES } from '../templates';
import { generateApplicationCsv } from '../exportApplication';

function application() {
  const profile = createEmptyRiskProfile('a');
  profile.business.namedInsured = manualField('ABC Trucking');
  // Requested with a limit, and requested with none.
  profile.coverage = [
    { type: 'auto_liability', requestedLimit: manualField('1,000,000') },
    { type: 'motor_truck_cargo', requestedLimit: emptyField() },
  ];
  return mapRiskProfileToApplication(profile, APPLICATION_TEMPLATES[0]);
}

describe('the application CSV a broker shares', () => {
  it('has a title, section headings and Field/Value rows — no Section or Status columns', () => {
    const lines = generateApplicationCsv(application(), 'ABC Trucking').replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('ABC Trucking Application');
    expect(lines).toContain('Field,Value');
    expect(lines).toContain('Named Insured,ABC Trucking');
    expect(lines.join('\n')).not.toMatch(/Section|Status|auto_filled|manually_entered|missing/);
  });

  it('only filled-in data — a coverage requested without a limit is left out', () => {
    const csv = generateApplicationCsv(application(), 'ABC Trucking');
    expect(csv).toContain('"1,000,000"');
    expect(csv).not.toContain('limit not specified');
    expect(csv).not.toContain('Cargo');
    expect(csv).not.toMatch(/,\r\n|,$/m); // no field row with an empty value
  });
});
