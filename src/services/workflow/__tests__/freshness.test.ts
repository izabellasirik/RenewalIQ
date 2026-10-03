import { describe, expect, it } from 'vitest';
import { DEFAULT_FRESHNESS_POLICY, outdatedReports, reportAge } from '../freshness';

describe('MVR / loss-run freshness', () => {
  it('14 days by default, measured from the report date', () => {
    expect(reportAge('loss_run', '2026-09-13', '2026-09-27')).toMatchObject({ ageDays: 14, outdated: false });
    expect(reportAge('loss_run', '2026-09-12', '2026-09-27')).toMatchObject({ ageDays: 15, outdated: true });
    expect(reportAge('mvr', undefined, '2026-09-27')).toBeNull();
  });

  it('the threshold comes from the policy passed in (configurable later)', () => {
    const policy = { maxAgeDays: { ...DEFAULT_FRESHNESS_POLICY.maxAgeDays, mvr: 30 } };
    expect(reportAge('mvr', '2026-09-01', '2026-09-27', policy)!.outdated).toBe(false);
    expect(reportAge('mvr', '2026-09-01', '2026-09-27')!.outdated).toBe(true);
  });

  it('lists the outdated reports', () => {
    const out = outdatedReports(
      [{ id: 'r1', carrier: 'Progressive', reportDate: '2026-08-01', createdAt: '', updatedAt: '' }, { id: 'r2', carrier: 'Canal', reportDate: '2026-09-25', createdAt: '', updatedAt: '' }],
      [{ id: 'd1', name: 'John Smith', mvrReportDate: '2026-09-01' }, { id: 'd2', name: 'No date' }],
      '2026-09-27'
    );
    expect(out.map((o) => `${o.kind}:${o.subject}`)).toEqual(['loss_run:Progressive', 'mvr:John Smith']);
  });
});
