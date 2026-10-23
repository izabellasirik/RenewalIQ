import { describe, expect, it } from 'vitest';
import {
  accountNameKey,
  describeReasons,
  duplicateReasons,
  findLocalDuplicates,
  nameSimilarity,
  normalizeAccountName,
  runDuplicateCheck,
  unseenMatches,
  type AccountDuplicate,
  type LocalCandidate,
} from '../duplicateCheck';

// Fictional businesses only.
const c = (over: Partial<LocalCandidate>): LocalCandidate => ({ accountId: 'a1', namedInsured: 'Blue Ridge Logistics LLC', ...over });
const why = (name: string, cand: Partial<LocalCandidate>, extra: { dot?: string; mc?: string } = {}, canOpen = true) =>
  duplicateReasons({ name, dotNumber: extra.dot, mcNumber: extra.mc }, c(cand), canOpen).reasons;

describe('true matches', () => {
  it('same USDOT or MC, whatever the name and formatting', () => {
    expect(why('Totally Different', { dotNumber: '0123456' }, { dot: 'USDOT 123456' })).toEqual(['same_dot']);
    expect(why('Totally Different', { mcNumber: 'MC-045678' }, { mc: '45678' })).toEqual(['same_mc']);
  });
  it('legal suffixes, punctuation, "&" and a leading "The" are ignored', () => {
    expect(normalizeAccountName('The Blue Ridge Logistics, L.L.C.')).toBe('blue ridge logistics');
    expect(normalizeAccountName('Smith & Sons Hauling Inc.')).toBe(normalizeAccountName('Smith and Sons Hauling Corporation'));
    for (const n of ['Blue Ridge Logistics', 'BLUE RIDGE LOGISTICS, INC', 'Blue Ridge Logistics LP', 'Blue Ridge Logistics PLLC']) expect(why(n, {})).toEqual(['same_name']);
  });
  it('the same words reordered', () => {
    expect(accountNameKey('Logistics Blue Ridge')).toBe(accountNameKey('Blue Ridge Logistics LLC'));
    expect(why('Ridge Blue Logistics', {})).toEqual(['reordered_name']);
  });
  it('a very similar name (typo) on an account the user can open', () => {
    const r = duplicateReasons({ name: 'Blue Ridge Logistic' }, c({}));
    expect(r.reasons).toEqual(['similar_name']);
    expect(r.similarity).toBeGreaterThanOrEqual(0.85);
  });
});

describe('false positives', () => {
  it('different USDOT numbers are different businesses, even with the same name', () => {
    expect(why('Blue Ridge Logistics', { dotNumber: '111111' }, { dot: '222222' })).toEqual([]);
    expect(why('Blue Ridge Logistics', { mcNumber: '111' }, { mc: '222' })).toEqual([]);
  });
  it('names that only share an industry word are not matches', () => {
    expect(nameSimilarity(accountNameKey('ABC Trucking'), accountNameKey('XYZ Trucking'))).toBeLessThan(0.85);
    expect(why('ABC Trucking', { namedInsured: 'XYZ Trucking LLC' })).toEqual([]);
    expect(why('Red Ridge Logistics', {})).toEqual([]);
  });
  it('very short names are not compared, and short names are never fuzzy-matched', () => {
    expect(why('AB', { namedInsured: 'AB LLC' })).toEqual([]);
    expect(why('Acme', { namedInsured: 'Acmé' })).toEqual([]);
  });
});

describe('accounts the user cannot open (same rules as the database)', () => {
  it('a similar name is never a match; strong matches still are; no similarity is given', () => {
    expect(duplicateReasons({ name: 'Blue Ridge Logistic' }, c({}), false)).toEqual({ reasons: [], similarity: null });
    expect(why('Blue Ridge Logistics', {}, {}, false)).toEqual(['same_name']);
    expect(why('X', { dotNumber: '5' }, { dot: '5' }, false)).toEqual(['same_dot']);
  });
});

describe('the check before saving', () => {
  const server: AccountDuplicate = { accountId: null, namedInsured: 'Blue Ridge Logistics LLC', assignedUserId: 'u2', assignedName: 'Dana', canOpen: false, archived: false, reasons: ['same_name'] };
  const local = [c({ accountId: 'mine', namedInsured: 'Blue Ridge Logistics' })];
  it('a failed check is a failure, never "no duplicates"', async () => {
    expect(await runDuplicateCheck({ name: 'Blue Ridge Logistics' }, { remote: async () => ({ ok: false, message: 'offline' }), local })).toEqual({ ok: false, message: 'offline' });
    expect(await runDuplicateCheck({ name: 'Blue Ridge Logistics' }, { remote: async () => { throw new Error('network'); }, local })).toEqual({ ok: false, message: 'network' });
  });
  it('without the database check (0072 missing), only this device was compared — and it says so', async () => {
    const r = await runDuplicateCheck({ name: 'Blue Ridge Logistics' }, { remote: async () => ({ ok: true, data: null }), local });
    expect(r.ok && r.result.complete).toBe(false);
    expect(r.ok && r.result.matches.map((m) => m.accountId)).toEqual(['mine']);
  });
  it('the database answer plus unsaved accounts on this device; an inaccessible account keeps no id', async () => {
    const r = await runDuplicateCheck({ name: 'Blue Ridge Logistics' }, { remote: async () => ({ ok: true, data: [server] }), local });
    expect(r.ok && r.result).toEqual({ complete: true, matches: [server, expect.objectContaining({ accountId: 'mine', canOpen: true })] });
  });
  it('confirming re-checks and asks again only for something new', () => {
    const extra = { ...server, namedInsured: 'Ridge Blue Logistics', assignedUserId: 'u3' };
    expect(unseenMatches([server], [server])).toEqual([]);
    expect(unseenMatches([server], [server, extra])).toEqual([extra]);
  });
  it('reasons are plain language and quote only what the user typed', () => {
    const lines = describeReasons({ ...server, reasons: ['same_dot', 'reordered_name'] }, { name: 'x', dotNumber: 'USDOT 0098765' });
    expect(lines).toEqual(['Same USDOT number (98765)', 'Same company name with the words in a different order']);
  });
  it('strong matches come first, at most five', () => {
    const many = Array.from({ length: 8 }, (_, i) => c({ accountId: `s${i}`, namedInsured: 'Blue Ridge Logistic' }));
    const r = findLocalDuplicates({ name: 'Blue Ridge Logistics', dotNumber: '77' }, [...many, c({ accountId: 'dot', namedInsured: 'Other', dotNumber: '77' })]);
    expect(r).toHaveLength(5);
    expect(r[0].accountId).toBe('dot');
  });
});
