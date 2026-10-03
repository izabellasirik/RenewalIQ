import { describe, expect, it } from 'vitest';
import { classifyDuplicates, localDuplicateCandidates, type DuplicateCandidate } from '../duplicateDetection';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';

const cand = (over: Partial<DuplicateCandidate>): DuplicateCandidate => ({ accountId: 'a1', namedInsured: 'ABC Trucking LLC', canOpen: true, ...over });

describe('possible existing account before importing a client submission', () => {
  it('exact USDOT match is a likely duplicate, whatever the name or formatting', () => {
    const m = classifyDuplicates({ name: 'Totally Different Co', dotNumber: 'USDOT 1234567' }, [cand({ namedInsured: 'ABC Trucking', dotNumber: '1234567' })]);
    expect(m).toHaveLength(1);
    expect(m[0].strength).toBe('exact_dot');
    expect(m[0].reason).toBe('same USDOT number, 1234567');
  });

  it('same name + same address (no USDOT on the submission) is a likely duplicate', () => {
    const m = classifyDuplicates(
      { name: 'ABC Trucking, L.L.C.', address: '120 Main Street, Suite 4, Dallas TX 75201' },
      [cand({ namedInsured: 'abc trucking', address: '120 Main St, Dallas, TX, 75201' })]
    );
    expect(m).toHaveLength(1);
    expect(m[0].strength).toBe('name_and_identifier');
    expect(m[0].reason).toContain('address');
  });

  it('same name + same email or phone is a likely duplicate (also when only the server can compare them)', () => {
    expect(classifyDuplicates({ name: 'ABC Trucking', email: 'OPS@abc.com' }, [cand({ emails: ['ops@abc.com'] })])[0]?.reason).toBe('same company name and email');
    expect(classifyDuplicates({ name: 'ABC Trucking', phone: '+1 (555) 010-2000' }, [cand({ phones: ['555.010.2000'] })])[0]?.reason).toBe('same company name and phone');
    expect(classifyDuplicates({ name: 'ABC Trucking', email: 'ops@abc.com' }, [cand({ emailMatch: true, canOpen: false })])).toHaveLength(1);
  });

  it('same name but a different company (different USDOT) is not a match — even with the same phone', () => {
    expect(classifyDuplicates({ name: 'ABC Trucking', dotNumber: '1111111', phone: '5550102000' }, [cand({ dotNumber: '2222222', phones: ['5550102000'] })])).toEqual([]);
  });

  it('same name alone, nothing else in common, is not flagged', () => {
    expect(classifyDuplicates({ name: 'ABC Trucking', email: 'a@one.com' }, [cand({ emails: ['b@two.com'], address: '9 Elm St' })])).toEqual([]);
    expect(classifyDuplicates({ name: 'ABC Trucking' }, [cand({})])).toEqual([]);
  });

  it('different business: no match', () => {
    expect(classifyDuplicates({ name: 'XYZ Freight', dotNumber: '1234567' }, [cand({ dotNumber: '999' })])).toEqual([]);
  });

  it('USDOT matches are listed before name matches', () => {
    const m = classifyDuplicates({ name: 'ABC Trucking', dotNumber: '1234567', email: 'ops@abc.com' }, [
      cand({ accountId: 'byName', emails: ['ops@abc.com'] }),
      cand({ accountId: 'byDot', namedInsured: 'Other', dotNumber: '1234567' }),
    ]);
    expect(m.map((x) => x.candidate.accountId)).toEqual(['byDot', 'byName']);
  });

  it('fallback reads USDOT, address and contacts from the accounts on this device', () => {
    const p = createEmptyRiskProfile('a1');
    p.transportation.dotNumber = { value: '1234567', confidence: 'high', isMissing: false, isConflicting: false } as never;
    const [c] = localDuplicateCandidates([{ id: 'a1', namedInsured: 'ABC', contacts: [{ id: 'c', name: 'Pat', email: 'pat@abc.com' }] } as never], { a1: p });
    expect(c).toMatchObject({ accountId: 'a1', dotNumber: '1234567', emails: ['pat@abc.com'], canOpen: true });
  });
});
