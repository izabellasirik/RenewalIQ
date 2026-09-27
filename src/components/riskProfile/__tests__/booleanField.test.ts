import { describe, expect, it } from 'vitest';
import { isValidDraft, parseDraft } from '../FieldRow';
import { isFieldShown, RISK_PROFILE_GROUPS } from '../../../pages/riskProfileFieldConfig';
import { createEmptyRiskProfile } from '../../../services/extraction/emptyRiskProfile';

// Regression: "+ Add" on Dashcams started from a blank draft; the Yes/No picker showed "Yes" but the
// blank value was what got saved — and blank parsed as No.
describe('Yes/No fields', () => {
  it('a blank Yes/No draft cannot be saved (it never silently becomes No)', () => {
    expect(isValidDraft('boolean', '')).toBe(false);
    expect(isValidDraft('boolean', 'Yes')).toBe(true);
    expect(parseDraft('boolean', 'Yes')).toBe(true);
    expect(parseDraft('boolean', 'No')).toBe(false);
  });

  it('provider/company fields show only once the Yes/No is Yes', () => {
    const fields = RISK_PROFILE_GROUPS.flatMap((g) => g.fields);
    const dashcamProvider = fields.find((f) => f.key === 'dashcamProvider')!;
    const telematicsProvider = fields.find((f) => f.key === 'telematicsProvider')!;
    const p = createEmptyRiskProfile('a');
    expect(isFieldShown(dashcamProvider, p)).toBe(false);
    p.transportation.dashcams = { ...p.transportation.dashcams, value: true, isMissing: false };
    expect(isFieldShown(dashcamProvider, p)).toBe(true);
    expect(isFieldShown(telematicsProvider, p)).toBe(false);
  });

  it('States of Operation and Minimum Driver Age are no longer on the Risk Profile', () => {
    const keys = RISK_PROFILE_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
    expect(keys).not.toContain('statesOfOperation');
    expect(keys).not.toContain('minDriverAge');
  });
});
