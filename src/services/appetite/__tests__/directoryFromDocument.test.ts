import { describe, expect, it } from 'vitest';
import { directoryRows, maskDirectorySecrets } from '../directoryFromDocument';
import { planImport } from '../directoryImport';
import { directoryFrom, validateDirectoryRequest } from '../../../../supabase/functions/extract-document-vision/directory';

describe('market list from a PDF / Word file', () => {
  it('removes passwords, logins, codes, emails and phone numbers before sending', () => {
    const out = maskDirectorySecrets('Sample Whale  info@sample.example PASS Secret#1\nGeico G CODE 10789\nTEL 941-263-4294; (804) 253-2571 ext. 18\nKATY 804)   253-2571KATY');
    expect(out).not.toMatch(/Secret|10789|941|804|@/);
    expect(out).toContain('Sample Whale');
    const layout = maskDirectorySecrets('Sample MGA  login https://x.example/u  Sample@MGA.  MTC, APD  Sample77$  Pay 10%\nGeico G CODE 123 i456) ok');
    expect(layout).not.toMatch(/Sample77|@|i456|123/);
    expect(layout).toMatch(/MTC, APD.*Pay 10%/);
  });
  it('keeps only clean markets from the AI answer (no emails, valid links only)', () => {
    const m = directoryFrom({ markets: [
      { name: 'Sample Mutual', market_type: 'direct', available_through: ['Sample MGA', 'x@y.example'], coverages: 'AL', min_cdl_years: 2, notes: 'Call bob@x.example', website: 'javascript:alert(1)' },
      { name: 'a@b.example', market_type: 'mga', available_through: [], coverages: '', notes: '' },
    ] })!;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ available_through: ['Sample MGA'], website: null, notes: 'Call [removed]' });
    expect(directoryFrom({ markets: [] })).toBeNull();
    expect(validateDirectoryRequest({ directoryText: '' }).ok).toBe(false);
  });
  it('becomes import rows the preview accepts, with soft rules for the minimums', () => {
    const rows = directoryRows(directoryFrom({ markets: [
      { name: 'Sample Mutual', market_type: 'direct', available_through: ['Sample MGA'], coverages: 'Auto Liability', min_cdl_years: 2, min_years_in_business: 3, min_units: 5, max_units: 20, notes: 'No hazmat.' },
      { name: 'Sample MGA', market_type: 'mga', available_through: [], coverages: '', notes: '' },
    ] })!, '2026-11-03');
    const plan = planImport(rows, []);
    expect(plan.errors).toEqual([]);
    expect(plan.markets.map((x) => x.name)).toEqual(['Sample Mutual', 'Sample MGA']);
    expect(plan.markets[0].rules.map((r) => `${r.category} ${r.operator} ${String(r.value)} ${r.strength}`)).toEqual(['driver_experience lt 2 soft', 'years_in_business lt 3 soft', 'fleet_size lt 5 soft', 'fleet_size gt 20 soft']);
  });
});
