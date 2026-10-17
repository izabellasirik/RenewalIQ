import { describe, expect, it } from 'vitest';
import { isValidDraft, parseDraft } from '../FieldRow';

// Regression: "+ Add" on Dashcams started from a blank draft; the Yes/No picker showed "Yes" but the
// blank value was what got saved — and blank parsed as No.
describe('Yes/No fields', () => {
  it('a blank Yes/No draft cannot be saved (it never silently becomes No)', () => {
    expect(isValidDraft('boolean', '')).toBe(false);
    expect(isValidDraft('boolean', 'Yes')).toBe(true);
    expect(isValidDraft('boolean', 'No')).toBe(true);
    expect(parseDraft('boolean', 'Yes')).toBe(true);
    expect(parseDraft('boolean', 'No')).toBe(false);
  });
});
