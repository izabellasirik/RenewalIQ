import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import type { AccountNote, FieldValue } from '../../../types';
import { mergeById, mergeNewerFields, noteChangedAt } from '../mergeCloud';

const at = (value: unknown, when: string): FieldValue<unknown> => ({ value, confidence: 'manual', isMissing: false, isConflicting: false, lastUpdatedAt: when });

describe('merging a newer cloud copy before saving', () => {
  it('each field keeps whichever copy changed most recently (formats differ: Z vs +00:00)', () => {
    const local = createEmptyRiskProfile('a');
    const cloud = createEmptyRiskProfile('a');
    // Someone else set DOT and renewal after this device loaded the account…
    cloud.transportation.dotNumber = at('3344556', '2026-09-26T12:00:00.000+00:00') as never;
    cloud.business.effectiveDate = at('2026-11-15', '2026-09-26T12:00:00.000+00:00') as never;
    // …while this device changed the named insured, and has an older DOT.
    local.business.namedInsured = at('ABC Trucking', '2026-09-26T13:00:00.000Z') as never;
    local.transportation.dotNumber = at('111', '2026-09-26T09:00:00.000Z') as never;
    const merged = mergeNewerFields(local, cloud);
    expect(merged.transportation.dotNumber.value).toBe('3344556');
    expect(merged.business.effectiveDate.value).toBe('2026-11-15');
    expect(merged.business.namedInsured.value).toBe('ABC Trucking');
  });

  it("notes from both sides are kept; an edited note's newest version wins", () => {
    const n = (id: string, text: string, createdAt: string, updatedAt?: string): AccountNote => ({ id, text, createdAt, updatedAt, authorName: 'x' });
    const local = [n('1', 'mine', '2026-09-26T10:00:00Z'), n('2', 'shared (old)', '2026-09-26T09:00:00Z')];
    const cloud = [n('2', 'shared (edited)', '2026-09-26T09:00:00Z', '2026-09-26T11:00:00+00:00'), n('3', 'theirs', '2026-09-26T10:30:00+00:00')];
    const merged = mergeById(local, cloud, noteChangedAt);
    expect(merged.map((x) => x.text).sort()).toEqual(['mine', 'shared (edited)', 'theirs']);
  });
});
