import { describe, expect, it } from 'vitest';
import type { IntakeSubmission } from '../../../types';
import { findLikelyDuplicateAccount } from '../duplicateDetection';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';

const submission = { id: 'is1', intakeLinkId: 'l1', namedInsured: 'ABC Trucking, LLC', dotNumber: '1234567', operatingStates: 'TX', coverageRequested: [] } as unknown as IntakeSubmission;

describe('duplicate warning before import', () => {
  const profileWithDot = (id: string, dot: string) => {
    const p = createEmptyRiskProfile(id);
    p.transportation.dotNumber = { value: dot, confidence: 'high', isMissing: false, isConflicting: false } as never;
    return p;
  };
  const acct = (id: string, name: string) => ({ id, namedInsured: name, state: 'TX', status: 'new', archived: false, createdAt: '', updatedAt: '' }) as never;

  it('matches the same name ignoring case, punctuation and LLC/Inc', () => {
    const m = findLikelyDuplicateAccount(submission, [acct('a1', 'abc trucking')], {});
    expect(m?.reason).toBe('same business name');
  });

  it('matches the same DOT number even under a different name', () => {
    const m = findLikelyDuplicateAccount(submission, [acct('a1', 'Totally Different Co')], { a1: profileWithDot('a1', '1234567') });
    expect(m?.reason).toBe('same DOT number, 1234567');
  });

  it('no warning for a different business', () => {
    expect(findLikelyDuplicateAccount(submission, [acct('a1', 'XYZ Freight')], { a1: profileWithDot('a1', '999') })).toBeNull();
  });
});
