import { describe, expect, it } from 'vitest';
import { computeWorkflowSteps } from '../WorkflowSteps';
import { createEmptyRiskProfile } from '../../../services/extraction/emptyRiskProfile';
import type { CoverageLine, MatchResult, UploadedDocument } from '../../../types';

const doc = { id: 'd1', accountId: 'a', name: 'loss_runs.pdf', category: 'loss_run', status: 'processed' } as unknown as UploadedDocument;
const matches = [{ appetiteRecordId: 'm1', verdict: 'possible_match' }] as unknown as MatchResult[];
const status = (steps: ReturnType<typeof computeWorkflowSteps>, key: string) => steps.find((s) => s.key === key)!.status;
const filled = (value: string) => ({ value, confidence: 'high', isMissing: false, isConflicting: false }) as never;

describe('workflow checkmarks', () => {
  it('a document existing does not make Submission Assistant or Carrier Appetite "done"', () => {
    const steps = computeWorkflowSteps('a', [doc], createEmptyRiskProfile('a'), matches);
    expect(status(steps, 'submission-assistant')).toBe('in_progress');
    expect(status(steps, 'carrier-appetite')).toBe('in_progress');
  });

  it('not started before any document', () => {
    const steps = computeWorkflowSteps('a', [], createEmptyRiskProfile('a'), []);
    expect(status(steps, 'submission-assistant')).toBe('not_started');
    expect(status(steps, 'carrier-appetite')).toBe('not_started');
  });

  it("keeps this branch's Limits & Coverage rule: green only when every line has both limits", () => {
    const profile = createEmptyRiskProfile('a');
    const line = { type: 'auto_liability', currentLimit: filled('$1M'), requestedLimit: filled('$1M') } as unknown as CoverageLine;
    expect(status(computeWorkflowSteps('a', [doc], { ...profile, coverage: [line] }, matches), 'limits-coverage')).toBe('done');
    const noCurrent = { ...line, currentLimit: { ...line.currentLimit, isMissing: true, value: null } } as unknown as CoverageLine;
    expect(status(computeWorkflowSteps('a', [doc], { ...profile, coverage: [noCurrent] }, matches), 'limits-coverage')).toBe('in_progress');
  });
});

describe("coverage the client never asked for isn't a gap", () => {
  it('What\'s Missing lists no limit for a coverage type with no line, and never a Current Limit', async () => {
    const { computeSubmissionCompleteness } = await import('../../../services/application/completeness');
    const profile = createEmptyRiskProfile('a');
    const none = computeSubmissionCompleteness(profile, [doc]);
    const labels = (c: typeof none) => [...c.missingRequiredFields, ...c.missingRecommendedFields].map((i) => i.label);
    expect(labels(none).filter((l) => /Limit/.test(l))).toEqual([]);

    const line = { type: 'auto_liability', currentLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false }, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false } } as unknown as CoverageLine;
    const requested = computeSubmissionCompleteness({ ...profile, coverage: [line] }, [doc]);
    // Requested but blank → flagged for review; the Current Limit is informational only.
    expect(requested.needsReview.map((i) => i.label)).toContain('Auto Liability (Requested Limit)');
    const everything = [...labels(requested), ...requested.needsReview.map((i) => i.label)];
    expect(everything.some((l) => /Current Limit/.test(l))).toBe(false);
  });
});
