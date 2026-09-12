import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MatchResult, RiskProfile, UploadedDocument } from '../../types';
import { isCoverageComplete } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { computeRiskProfileStats } from '../../hooks/useRiskProfileStats';
import { computeSubmissionCompleteness, isSubmissionComplete } from '../../services/application/completeness';
import { EMPTY_DOCUMENTS, EMPTY_MATCH_RESULTS } from '../../utils/emptyArrays';
import { cn } from '../../utils/cn';

export type StepStatus = 'not_started' | 'in_progress' | 'done';

export interface WorkflowStep {
  key: string;
  label: string;
  path: string;
  status: StepStatus;
}

/**
 * Pure computation — safe to call per-account in a loop (e.g. cross-account analytics), unlike the
 * hook below.
 *
 * Every step's `status` reflects the actual, current state of the canonical Risk Profile/coverage
 * data — never merely "the broker has visited this page" or "an automatic background process has
 * run at least once." See each step's own comment for its exact completion rule; `computeRiskProfileStats`
 * and `computeSubmissionCompleteness`/`isSubmissionComplete` are the same functions the Risk Profile
 * page and Submission Assistant's "What's Missing?" panel already use, so a step here can never read
 * "done" while that same underlying data reads "incomplete" elsewhere.
 */
export function computeWorkflowSteps(
  accountId: string,
  documents: UploadedDocument[],
  profile: RiskProfile | undefined,
  matchResults: MatchResult[]
): WorkflowStep[] {
  const stats = computeRiskProfileStats(profile);
  const hasDocs = documents.length > 0;
  const anyProcessing = documents.some((d) => d.status === 'processing');

  // Documents: done once every uploaded file has finished being processed (successfully or not) —
  // not merely "at least one file exists," and not affected by anything on a later step.
  const documentsStatus: StepStatus = !hasDocs ? 'not_started' : anyProcessing ? 'in_progress' : 'done';

  // Risk Profile: done when every tracked business/transportation field is filled with no
  // unresolved conflict — the same per-field data the Risk Profile page's own progress display
  // reads (computeRiskProfileStats), not a separate page-level flag.
  const profileStatus: StepStatus = !hasDocs
    ? 'not_started'
    : stats.missing.length > 0 || stats.conflicting.length > 0
      ? 'in_progress'
      : 'done';

  // Limits & Coverage: done only when every coverage line THIS submission actually has (never a
  // default/placeholder set — see isCoverageComplete's own comment) has its Requested Limit filled
  // in with no unresolved conflict. Current Limit never gates this — a new-business/no-current-
  // coverage account legitimately has none. Zero coverage lines at all reads as still in progress
  // (there's nothing to review yet), never as done just because there's nothing to flag.
  const coverage = profile?.coverage ?? [];
  const coverageStatus: StepStatus = !hasDocs ? 'not_started' : coverage.length === 0 ? 'in_progress' : isCoverageComplete(coverage) ? 'done' : 'in_progress';

  // Submission Assistant: done exactly when the same completeness computation that page's own
  // "What's Missing?" panel shows (computeSubmissionCompleteness/isSubmissionComplete) reports
  // nothing outstanding — required fields, recommended fields, recommended documents, needs-review
  // items, and conflicts alike. Never derived from whether any document merely exists.
  const submissionAssistantStatus: StepStatus = !hasDocs || !profile ? 'not_started' : isSubmissionComplete(computeSubmissionCompleteness(profile, documents)) ? 'done' : 'in_progress';

  // Carrier Appetite: market matching itself is an automatic background recompute that runs after
  // nearly every edit (see runMatching in useAccountsStore) and always returns one result per known
  // market, regardless of how complete the submission is — so "matchResults is non-empty" is never
  // a genuine completion signal on its own. Matching results are only actually meaningful to review
  // once the submission itself is complete (the same bar Submission Assistant just cleared above);
  // before that, this reads as in-progress rather than done, however many results already exist.
  const appetiteStatus: StepStatus = matchResults.length === 0 ? (hasDocs ? 'in_progress' : 'not_started') : submissionAssistantStatus === 'done' ? 'done' : 'in_progress';

  return [
    { key: 'upload', label: 'Documents', path: `/accounts/${accountId}/upload`, status: documentsStatus },
    { key: 'risk-profile', label: 'Risk Profile', path: `/accounts/${accountId}/risk-profile`, status: profileStatus },
    { key: 'limits-coverage', label: 'Limits & Coverage', path: `/accounts/${accountId}/limits-coverage`, status: coverageStatus },
    { key: 'submission-assistant', label: 'Submission Assistant', path: `/accounts/${accountId}/submission-assistant`, status: submissionAssistantStatus },
    { key: 'carrier-appetite', label: 'Carrier Appetite', path: `/accounts/${accountId}/carrier-appetite`, status: appetiteStatus },
  ];
}

export function useWorkflowStatus(accountId: string | undefined): WorkflowStep[] {
  const documents = useAccountsStore((s) => (accountId ? s.documents[accountId] : undefined)) ?? EMPTY_DOCUMENTS;
  const profile = useAccountsStore((s) => (accountId ? s.riskProfiles[accountId] : undefined));
  const matchResults = useAccountsStore((s) => (accountId ? s.matchResults[accountId] : undefined)) ?? EMPTY_MATCH_RESULTS;

  if (!accountId) return [];
  return computeWorkflowSteps(accountId, documents, profile, matchResults);
}

/** Single-glance submission status for the Dashboard, derived from the same live workflow data as the stepper — no separately-maintained status field to drift out of sync. */
export function deriveSubmissionStatusLabel(steps: WorkflowStep[]): { label: string; tone: 'neutral' | 'warning' | 'success' } {
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s.status]));

  if (!byKey.upload || byKey.upload === 'not_started') return { label: 'New', tone: 'neutral' };
  if (byKey.upload === 'in_progress') return { label: 'Extracting Documents', tone: 'warning' };
  if (byKey['risk-profile'] === 'in_progress') return { label: 'In Review', tone: 'warning' };
  if (byKey['carrier-appetite'] === 'done') return { label: 'Ready for Market', tone: 'success' };
  return { label: 'Documents Uploaded', tone: 'neutral' };
}

export function StepStatusDot({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-success-500)] text-white">
        <Check size={9} strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'in_progress') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning-500)]" />;
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-ink-200)]" />;
}

export function WorkflowStepsBar({ steps, activeKey }: { steps: WorkflowStep[]; activeKey: string }) {
  if (steps.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs">
      {steps.map((step, i) => {
        const isActive = step.key === activeKey;
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[var(--color-ink-200)]">/</span>}
            <Link
              to={step.path}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors',
                isActive ? 'bg-[var(--color-ink-100)] text-[var(--color-ink-900)]' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]'
              )}
            >
              <StepStatusDot status={step.status} />
              {step.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
