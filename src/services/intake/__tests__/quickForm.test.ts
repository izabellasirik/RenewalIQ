import { describe, expect, it } from 'vitest';
import { quickAnswers, type QuickRow } from '../quickForm';
import type { IntakeAnswers } from '../../supabase/intakeRepo';

const empty = { namedInsured: '', contactName: '', contactEmail: '', contactPhone: '', dotNumber: '', mcNumber: '', yearsInBusiness: null, powerUnits: null, driverCount: null, operationType: '', commoditiesHauled: '', operatingRadius: '', operatingStates: '', coverageRequested: [], currentCarrier: '', effectiveDate: '', additionalNotes: '', vinNumbers: [''], additionalContacts: [] } as IntakeAnswers;
const row = (kind: QuickRow['kind'], value: string, label = ''): QuickRow => ({ id: value, kind, label, value });

describe('quick form answers', () => {
  it('puts each piece where the agency expects it', () => {
    const a = quickAnswers(empty, [row('namedInsured', 'Sample Hauling LLC'), row('dotNumber', '1234567'), row('vin', '1FUJGLDR12LM00001, 1FUJGLDR12LM00002'), row('contact', 'pat@example.com'), row('contact', '(555) 010-2000'), row('contact', 'Pat Sample')], '');
    expect([a.namedInsured, a.dotNumber, a.contactEmail, a.contactPhone, a.contactName]).toEqual(['Sample Hauling LLC', '1234567', 'pat@example.com', '(555) 010-2000', 'Pat Sample']);
    expect(a.vinNumbers).toEqual(['1FUJGLDR12LM00001', '1FUJGLDR12LM00002']);
  });
  it('coverage, Other and notes go into the notes', () => {
    const a = quickAnswers(empty, [row('coverage', 'Auto liability $1M'), row('other', '6 trucks', 'Fleet size'), row('', 'ignored')], 'Need quotes by Friday');
    expect(a.additionalNotes).toBe('Need quotes by Friday\nCoverage: Auto liability $1M\nFleet size: 6 trucks');
    expect(a.vinNumbers).toEqual(['']);
  });
});
