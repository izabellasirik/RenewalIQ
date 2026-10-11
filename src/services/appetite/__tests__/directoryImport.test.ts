import { describe, expect, it } from 'vitest';
import { IMPORT_TEMPLATE_CSV, parseCsvText, planImport, planImportJson } from '../directoryImport';
import type { AgencyCarrier } from '../agencyCarriers';

// Synthetic data only.
const existing = (patch: Partial<AgencyCarrier>): AgencyCarrier => ({ id: 'c1', baseRecordId: null, name: 'Example Program', marketType: 'mga', availableThrough: null, website: null, contactName: null, contactEmail: null, contactPhone: null, criteria: {}, strictness: 'hard', notes: null, source: 'manual', lastVerifiedAt: null, updatedAt: '2026-10-01T00:00:00Z', archivedAt: null, ...patch });

describe('directory import (Carrier 101 + 102)', () => {
  it('the template parses into one market with contacts and rules, no errors', () => {
    const plan = planImport(parseCsvText(IMPORT_TEMPLATE_CSV), []);
    expect(plan.errors).toEqual([]);
    expect(plan.markets).toHaveLength(1);
    const m = plan.markets[0];
    expect(m).toMatchObject({ ref: 'EX-001', accessRoute: 'indirect', accessStatus: 'ready', mga: 'Example MGA', wholesaler: 'Example Wholesale', paper: 'Example Paper Insurance Co' });
    expect(m.contacts.map((c) => c.name)).toEqual(['Sample Underwriter', 'Sample Service Rep']);
    expect(m.rules.map((r) => `${r.ref}:${r.coverage}:${r.category}:${r.operator}:${JSON.stringify(r.value)}:${r.answer}:${r.strength}`)).toEqual([
      'R1:motor_truck_cargo:commodity:any_of:["hazmat","explosives"]:no:hard',
      'R2:null:fleet_size:between:[1,25]:yes:soft',
      'R3:null:telematics:is_false:null:no:hard',
      'R4:null:other:text:"Loss runs for 5 years":unknown:info',
    ]);
    expect(m.rules[2].conditions).toEqual([{ category: 'fleet_size', operator: 'gt', value: 10 }]);
    expect(plan.preview[0]).toMatchObject({ action: 'new', verifiedHardNos: 2, unverifiedRules: 2 });
  });

  it('updates an existing market (by import reference, else by name) instead of duplicating it', () => {
    expect(planImport(parseCsvText(IMPORT_TEMPLATE_CSV), [existing({ name: 'example program' })]).preview[0]).toMatchObject({ action: 'update', existingName: 'example program' });
    expect(planImport(parseCsvText(IMPORT_TEMPLATE_CSV), [existing({ name: 'Renamed', externalRef: 'EX-001' })]).preview[0]).toMatchObject({ action: 'update', existingName: 'Renamed' });
  });

  it('refuses credential columns outright', () => {
    const plan = planImport(parseCsvText('record_type,market_ref,market,portal_password\nmarket,M1,X,secret'), []);
    expect(plan.markets).toEqual([]);
    expect(plan.errors[0]).toMatch(/never imported or stored/);
  });

  it('reports every problem with its row, and warns that an unverified hard NO will not decline', () => {
    const csv = [
      'record_type,market_ref,market,access_status,portal_url,rule_ref,category,operator,value,answer,strength,verified_at',
      'market,M1,Example,maybe,javascript:alert(1),,,,,,,',
      'rule,M1,,,,R1,zodiac,any_of,x,no,hard,',
      'rule,M1,,,,R2,fleet_size,gt,lots,no,hard,',
      'rule,M2,,,,R1,fleet_size,gt,5,no,hard,',
      'rule,M1,,,,R3,fleet_size,gt,25,no,hard,',
    ].join('\n');
    const plan = planImport(parseCsvText(csv), []);
    expect(plan.errors).toEqual([
      expect.stringMatching(/Row 2: portal_url must start with https/),
      expect.stringMatching(/Row 2: access_status "maybe"/),
      expect.stringMatching(/Row 3: category "zodiac"/),
      expect.stringMatching(/Row 4: gt needs a number/),
      expect.stringMatching(/Row 5: rule for unknown market_ref "M2"/),
    ]);
    expect(plan.warnings.some((w) => /Row 6: a hard NO without verified_at/.test(w))).toBe(true);
  });

  it('keeps the documented status of markets and rules exactly as written', () => {
    const csv = ['record_type,market_ref,market,access_status,documented_status,rule_ref,category,operator,value,answer,strength,verified_at', 'market,M1,Example,partial,PENDING VERIFICATION / PARTIAL,,,,,,,', 'rule,M1,,,SUPPORTED,R1,other,text,Team driving,no,hard,'].join('\n');
    const plan = planImport(parseCsvText(csv), []);
    expect(plan.errors).toEqual([]);
    expect(plan.markets[0].documentedStatus).toBe('PENDING VERIFICATION / PARTIAL');
    expect(plan.markets[0].rules[0]).toMatchObject({ documentedStatus: 'SUPPORTED', lastVerifiedAt: null });
    expect(planImportJson(JSON.stringify({ markets: plan.markets }), []).markets).toEqual(plan.markets);
  });

  it('accepts the same content as JSON', () => {
    const csvPlan = planImport(parseCsvText(IMPORT_TEMPLATE_CSV), []);
    const json = JSON.stringify({ markets: csvPlan.markets });
    const jsonPlan = planImportJson(json, []);
    expect(jsonPlan.errors).toEqual([]);
    expect(jsonPlan.markets).toEqual(csvPlan.markets);
  });

  it('parses quoted cells with commas, quotes and line breaks', () => {
    expect(parseCsvText('a,b\n"x, y","say ""hi""\nthere"')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });
});
