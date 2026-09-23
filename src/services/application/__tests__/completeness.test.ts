import { describe, expect, it, vi } from 'vitest';

// A submission whose every field is present, except one field in `status` — completeness must not read 100%.
const state = vi.hoisted(() => ({ status: 'auto_filled' as string }));
vi.mock('../fieldMappingEngine', () => ({
  mapRiskProfileToApplication: () => ({
    sections: [
      {
        fields: [
          ...Array.from({ length: 60 }, (_, i) => ({ targetLabel: `Field ${i}`, required: i % 2 === 0, status: 'auto_filled' })),
          { targetLabel: 'Annual Revenue', required: true, status: state.status },
        ],
      },
    ],
  }),
}));
vi.mock('../../extraction/reconciliation', () => ({ buildSubmissionWarnings: () => [] }));

const { computeSubmissionCompleteness, isSubmissionComplete } = await import('../completeness');
const { createEmptyRiskProfile } = await import('../../extraction/emptyRiskProfile');

function run(status: string) {
  state.status = status;
  const profile = { ...createEmptyRiskProfile('a'), drivers: [{ id: 'd' }], vehicles: [{ id: 'v' }] } as never;
  return computeSubmissionCompleteness(profile, [{ id: 'doc', category: 'loss_run', status: 'processed' }] as never);
}

describe('submission completeness percent', () => {
  it('is 100% only when nothing is outstanding', () => {
    const c = run('auto_filled');
    expect(c.percent).toBe(100);
    expect(isSubmissionComplete(c)).toBe(true);
  });

  it.each(['needs_review', 'conflict'])('stays below 100%% while a field is %s', (status) => {
    const c = run(status);
    expect(c.percent).toBe(99);
    expect(isSubmissionComplete(c)).toBe(false);
  });
});
