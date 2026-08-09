import type { Account, ActivityEvent, MatchResult, RiskProfile, UploadedDocument, Verdict } from '../../types';
import { computeRiskProfileStats } from '../../hooks/useRiskProfileStats';
import { computeWorkflowSteps, deriveSubmissionStatusLabel } from '../../components/layout/WorkflowSteps';

const CONFIDENCE_WEIGHT: Record<string, number> = { high: 100, medium: 66, low: 33 };

export interface RankedItem {
  label: string;
  count: number;
}

export interface AnalyticsSnapshot {
  totalSubmissions: number;
  archivedSubmissions: number;
  submissionsByStatus: RankedItem[];
  totalDocuments: number;
  totalFieldsExtracted: number;
  verdictBreakdown: Record<Verdict, number>;
  totalMatchesRun: number;
  topMarkets: RankedItem[];
  missingFieldsRanked: RankedItem[];
  averageConfidence: number | null;
  /** 1 − corrections/totalFieldsExtracted. Derived from how often a broker had to correct an extracted value —
   *  a proxy signal, not a ground-truth benchmark (there's no independently-verified "correct" value to compare against). */
  extractionAccuracy: number | null;
  correctionsCount: number;
}

export function computeAnalytics(
  accounts: Account[],
  documents: Record<string, UploadedDocument[]>,
  riskProfiles: Record<string, RiskProfile>,
  matchResults: Record<string, MatchResult[]>,
  activityLog: Record<string, ActivityEvent[]>
): AnalyticsSnapshot {
  const active = accounts.filter((a) => !a.archived);

  const statusCounts = new Map<string, number>();
  for (const account of active) {
    const steps = computeWorkflowSteps(account.id, documents[account.id] ?? [], riskProfiles[account.id], matchResults[account.id] ?? []);
    const { label } = deriveSubmissionStatusLabel(steps);
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
  }

  let totalDocuments = 0;
  let totalFieldsExtracted = 0;
  for (const accountId of Object.keys(documents)) {
    for (const doc of documents[accountId]) {
      totalDocuments++;
      totalFieldsExtracted += doc.fieldsExtracted ?? 0;
    }
  }

  const verdictBreakdown: Record<Verdict, number> = { likely_match: 0, possible_match: 0, needs_more_information: 0, not_eligible: 0 };
  const marketStrongCounts = new Map<string, number>();
  let totalMatchesRun = 0;
  for (const accountId of Object.keys(matchResults)) {
    for (const result of matchResults[accountId]) {
      totalMatchesRun++;
      verdictBreakdown[result.verdict]++;
      if (result.verdict === 'likely_match') {
        marketStrongCounts.set(result.marketName, (marketStrongCounts.get(result.marketName) ?? 0) + 1);
      }
    }
  }

  const missingCounts = new Map<string, number>();
  const confidenceWeights: number[] = [];
  for (const accountId of Object.keys(riskProfiles)) {
    const stats = computeRiskProfileStats(riskProfiles[accountId]);
    for (const entry of stats.missing) {
      missingCounts.set(entry.field.label, (missingCounts.get(entry.field.label) ?? 0) + 1);
    }
    for (const entry of [...stats.completed, ...stats.conflicting]) {
      const weight = CONFIDENCE_WEIGHT[entry.value.confidence];
      if (weight !== undefined) confidenceWeights.push(weight);
    }
  }

  let correctionsCount = 0;
  for (const accountId of Object.keys(activityLog)) {
    correctionsCount += activityLog[accountId].filter((e) => e.type === 'field_corrected').length;
  }

  return {
    totalSubmissions: active.length,
    archivedSubmissions: accounts.length - active.length,
    submissionsByStatus: [...statusCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    totalDocuments,
    totalFieldsExtracted,
    verdictBreakdown,
    totalMatchesRun,
    topMarkets: [...marketStrongCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    missingFieldsRanked: [...missingCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    averageConfidence: confidenceWeights.length ? Math.round(confidenceWeights.reduce((a, b) => a + b, 0) / confidenceWeights.length) : null,
    extractionAccuracy: totalFieldsExtracted > 0 ? Math.max(0, Math.round((1 - correctionsCount / totalFieldsExtracted) * 100)) : null,
    correctionsCount,
  };
}
