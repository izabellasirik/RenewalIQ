import { describe, expect, it } from 'vitest';
import { IMPORT_TEMPLATE_CSV, parseCsvText, planImport, planImportJson, relinkPlan } from '../directoryImport';
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

describe('directory import — linking to existing markets (no duplicates, programs kept separate)', () => {
  // Synthetic built-ins: one carrier-wide record and two programs of another carrier.
  const BUILT_INS = [
    { id: 'appetite_example_wide', marketName: 'Example Mutual', parentCompany: 'Example Mutual' },
    { id: 'appetite_sample_a', marketName: 'Sample Casualty Alpha', parentCompany: 'Sample Casualty Company', programName: 'Alpha' },
    { id: 'appetite_sample_b', marketName: 'Sample Casualty Beta', parentCompany: 'Sample Casualty Company', programName: 'Beta' },
  ];
  const market = (patch: Record<string, unknown>) => ({ ref: 'm1', name: 'Example Mutual via Some Wholesaler', accessStatus: 'ready', rules: [], ...patch });
  const json = (...ms: Record<string, unknown>[]) => JSON.stringify({ markets: ms });

  it('a market linked to a built-in becomes the agency version of it', () => {
    const plan = planImportJson(json(market({ baseRecordId: 'appetite_example_wide' })), [], BUILT_INS);
    expect(plan.errors).toEqual([]);
    expect(plan.preview[0]).toMatchObject({ action: 'new', linkedTo: { kind: 'built-in', id: 'appetite_example_wide', name: 'Example Mutual' }, possibleDuplicates: [] });
    expect(plan.markets[0].baseRecordId).toBe('appetite_example_wide');
  });

  it('an unknown built-in id is an error', () => {
    expect(planImportJson(json(market({ baseRecordId: 'appetite_nope' })), [], BUILT_INS).errors[0]).toMatch(/doesn't exist/);
  });

  it('a look-alike is flagged, never linked on its own — and every program of a carrier is listed separately', () => {
    const plan = planImportJson(json(market({}), market({ ref: 'm2', name: 'Sample Casualty via Some MGA' })), [], BUILT_INS);
    expect(plan.preview[0]).toMatchObject({ action: 'new', linkedTo: undefined });
    expect(plan.preview[0].possibleDuplicates.map((d) => d.name)).toEqual(['Example Mutual']);
    expect(plan.preview[1].possibleDuplicates.map((d) => `${d.name}/${d.program}`)).toEqual(['Sample Casualty Alpha/Alpha', 'Sample Casualty Beta/Beta']);
    expect(plan.warnings.some((w) => /may already exist under another name/.test(w))).toBe(true);
    expect(plan.markets.every((m) => !m.baseRecordId && !m.linkTo)).toBe(true);
  });

  it("the words after 'via' are the route, not the market — no false duplicate", () => {
    expect(planImportJson(json(market({ name: 'Other Carrier via Example Mutual' })), [], BUILT_INS).preview[0].possibleDuplicates).toEqual([]);
  });

  it('the admin links or keeps separate; two imported markets can never be merged into one', () => {
    let plan = planImportJson(json(market({}), market({ ref: 'm2', name: 'Example Mutual direct' })), [], BUILT_INS);
    plan = relinkPlan(plan, 'm1', { kind: 'built-in', id: 'appetite_example_wide', name: 'Example Mutual' }, [], BUILT_INS);
    expect(plan.errors).toEqual([]);
    expect(plan.preview[0].linkedTo?.id).toBe('appetite_example_wide');
    plan = relinkPlan(plan, 'm2', { kind: 'built-in', id: 'appetite_example_wide', name: 'Example Mutual' }, [], BUILT_INS);
    expect(plan.errors[0]).toMatch(/both link to "Example Mutual"/);
    plan = relinkPlan(plan, 'm2', null, [], BUILT_INS);
    expect(plan.errors).toEqual([]);
  });

  it("links to one of the agency's own markets with a different name; refuses one already holding another import", () => {
    const mine = existing({ id: '11111111-1111-4111-8111-111111111111', name: 'Example Mut.' });
    expect(planImportJson(json(market({ linkTo: mine.id })), [mine], BUILT_INS).preview[0]).toMatchObject({ action: 'update', existingName: 'Example Mut.', linkedTo: { kind: 'agency', id: mine.id } });
    expect(planImportJson(json(market({ linkTo: mine.id })), [{ ...mine, externalRef: 'other-ref' }], BUILT_INS).errors[0]).toMatch(/never merged/);
    expect(planImportJson(json(market({ linkTo: '22222222-2222-4222-8222-222222222222' })), [mine], BUILT_INS).errors[0]).toMatch(/isn't one of your agency's markets/);
  });

  it("the agency's existing version of a built-in is updated, not duplicated", () => {
    const version = existing({ id: '33333333-3333-4333-8333-333333333333', baseRecordId: 'appetite_example_wide', name: 'Example Mutual (ours)' });
    expect(planImportJson(json(market({ baseRecordId: 'appetite_example_wide' })), [version], BUILT_INS).preview[0]).toMatchObject({ action: 'update', existingName: 'Example Mutual (ours)' });
  });
});

describe('directory import — a built-in link is never changed on re-import', () => {
  it('warns instead of silently ignoring it', () => {
    const plan = planImportJson(JSON.stringify({ markets: [{ ref: 'm1', name: 'X', accessStatus: 'ready', baseRecordId: 'appetite_example_wide', rules: [] }] }), [existing({ name: 'X', externalRef: 'm1' })], [{ id: 'appetite_example_wide', marketName: 'Example Mutual', parentCompany: 'Example Mutual' }]);
    expect(plan.warnings.some((w) => /can't be changed on re-import/.test(w))).toBe(true);
  });
});

describe('directory import — warnings stay readable', () => {
  it('many unverified hard NOs collapse into one line; the duplicate prompt comes first', () => {
    const rules = Array.from({ length: 6 }, (_, i) => ({ ref: `r${i}`, category: 'commodity', operator: 'any_of', value: ['hazmat'], answer: 'no', strength: 'hard' }));
    const plan = planImportJson(JSON.stringify({ markets: [{ ref: 'm1', name: 'Example Mutual West', accessStatus: 'ready', rules }] }), [], [{ id: 'appetite_example_wide', marketName: 'Example Mutual', parentCompany: 'Example Mutual' }]);
    expect(plan.warnings[0]).toMatch(/may already exist under another name/);
    expect(plan.warnings.filter((w) => /hard NO without verified_at/.test(w))).toEqual([expect.stringMatching(/^6 rules \(Row \d+, Row \d+, Row \d+, …\)/)]);
  });
});
