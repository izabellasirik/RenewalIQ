import { describe, expect, it } from 'vitest';
import { driverExperience, monthsSince } from '../driverExperience';
import { formatDuration } from '../duration';
import { fromDraft } from '../../components/riskProfile/DriversTable';
import { EMPTY_DURATION_DRAFT } from '../durationDraft';

const draft = (patch: Record<string, unknown>) => ({
  name: 'John Smith', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', issueDate: '', expirationDate: '', hireDate: '', mvrReportDate: '', yearsExperience: EMPTY_DURATION_DRAFT, violations: '',
  ...patch,
});

describe('driving experience from the license issue date', () => {
  it('counts whole months', () => {
    expect(formatDuration({ months: monthsSince('2025-03-27', '2026-09-27')! })).toBe('1 year 6 months');
    expect(formatDuration({ months: monthsSince('2026-01-15', '2026-09-27')! })).toBe('8 months');
    expect(formatDuration({ months: monthsSince('2010-07-01', '2026-09-27')! })).toBe('16 years 2 months');
    expect(monthsSince('2026-01-28', '2026-02-27')).toBe(0); // not a full month yet
  });

  it('stays current when it came from the issue date; a manual figure is kept as entered', () => {
    expect(formatDuration(driverExperience({ issueDate: '2025-03-27', experienceFromIssueDate: true, yearsExperience: { months: 3 } }, '2026-09-27'))).toBe('1 year 6 months');
    expect(formatDuration(driverExperience({ issueDate: '2025-03-27', experienceFromIssueDate: false, yearsExperience: { months: 60 } }, '2026-09-27'))).toBe('5 years');
  });

  it('saving: issue date alone → calculated; a different typed figure → a correction the broker owns', () => {
    const auto = fromDraft(draft({ issueDate: '2020-01-01', hireDate: '2024-05-01' }), false);
    expect(auto.experienceFromIssueDate).toBe(true);
    expect(auto.hireDate).toBe('2024-05-01');
    const corrected = fromDraft(draft({ issueDate: '2020-01-01', yearsExperience: { years: '3', months: '0', orMore: false } }), true);
    expect(corrected.experienceFromIssueDate).toBe(false);
    expect(corrected.yearsExperience).toEqual({ months: 36 });
  });
});
