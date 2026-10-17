import type { Account, DriverEntry, LossRun, MissingItem, MarketQuote } from '../../types';
import { daysBetween, formatShortDate, normalizeDateKey, todayKey } from './dates';
import { effectiveAccountStage } from './accountStage';

/**
 * How current a report has to be for submission / renewal review. One policy object, passed to every
 * check — today a constant; later an agency setting can supply it without touching the checks.
 */
export type FreshReportKind = 'mvr' | 'loss_run';
export interface FreshnessPolicy {
  maxAgeDays: Record<FreshReportKind, number>;
}
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = { maxAgeDays: { mvr: 14, loss_run: 14 } };

export interface ReportAge {
  reportDate: string;
  ageDays: number;
  outdated: boolean;
  maxAgeDays: number;
}

/** How old a report is against the policy; null when there's no usable report date. */
export function reportAge(kind: FreshReportKind, reportDate: string | undefined, today = todayKey(), policy = DEFAULT_FRESHNESS_POLICY): ReportAge | null {
  const key = normalizeDateKey(reportDate);
  if (!key) return null;
  const ageDays = Math.max(0, daysBetween(key, today));
  const maxAgeDays = policy.maxAgeDays[kind];
  return { reportDate: key, ageDays, outdated: ageDays > maxAgeDays, maxAgeDays };
}

export interface OutdatedReport {
  kind: FreshReportKind;
  /** LossRun.id or DriverEntry.id */
  sourceId: string;
  /** "Progressive" / "John Smith" */
  subject: string;
  age: ReportAge;
}

/** Freshness only matters while the account is being worked for submission/renewal. */
export function freshnessApplies(account: Account, items: MissingItem[], quotes: MarketQuote[]): boolean {
  if (account.archived) return false;
  const { stage } = effectiveAccountStage(account, items, quotes);
  return stage !== 'bound' && stage !== 'lost';
}

export function outdatedReports(lossRuns: LossRun[], drivers: DriverEntry[], today = todayKey(), policy = DEFAULT_FRESHNESS_POLICY): OutdatedReport[] {
  const out: OutdatedReport[] = [];
  for (const run of lossRuns) {
    const age = reportAge('loss_run', run.reportDate, today, policy);
    if (age?.outdated) out.push({ kind: 'loss_run', sourceId: run.id, subject: run.carrier, age });
  }
  for (const d of drivers) {
    const age = reportAge('mvr', d.mvrReportDate, today, policy);
    if (age?.outdated) out.push({ kind: 'mvr', sourceId: d.id, subject: d.name || 'driver', age });
  }
  return out;
}

/** The checklist item that asks for a current copy — its templateKey ties it to the report it replaces. */
export function freshnessTemplateKey(r: Pick<OutdatedReport, 'kind' | 'sourceId'>): string {
  return `refresh:${r.kind}:${r.sourceId}`;
}
export function freshnessItemLabel(r: OutdatedReport): string {
  return r.kind === 'loss_run' ? `Updated loss run — ${r.subject}` : `Updated MVR — ${r.subject}`;
}
export function freshnessInstructions(r: OutdatedReport): string {
  return `the one we have is dated ${formatShortDate(r.age.reportDate)} (${r.age.ageDays} days old) — we need one run within the last ${r.age.maxAgeDays} days`;
}
