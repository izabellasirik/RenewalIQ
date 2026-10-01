import type { LossRun, MappedLossRunSummary, RiskProfile } from '../../types';
import { formatCurrency, formatDateMDY } from './formatters';

/**
 * When an account has loss run reports but no itemized claims, the application still says what the
 * reports show: "No losses recorded" (only when no report states a claim or an incurred amount) and,
 * for each report, the details it actually has — insurance company, policy number, report date,
 * coverage period, claim count and totals. Nothing is filled in that wasn't entered or read off a
 * report. With itemized claims, or no reports at all, there is no summary.
 */
export function buildLossRunSummary(profile: RiskProfile, lossRuns: LossRun[] | undefined): MappedLossRunSummary | undefined {
  if ((profile.lossHistory ?? []).length > 0 || !lossRuns?.length) return undefined;
  const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
  const reports = lossRuns.map((r) => {
    const fields: { label: string; value: string }[] = [];
    const add = (label: string, value: string) => {
      if (value.trim()) fields.push({ label, value });
    };
    add('Insurance Company', r.carrier ?? '');
    add('Policy Number', r.policyNumber ?? '');
    add('Report Date', has(r.reportDate) ? formatDateMDY(r.reportDate) : '');
    const start = has(r.coverageStart) ? formatDateMDY(r.coverageStart) : '';
    const end = has(r.coverageEnd) ? formatDateMDY(r.coverageEnd) : '';
    add('Coverage Period', start && end ? `${start} – ${end}` : start ? `From ${start}` : end ? `To ${end}` : '');
    if (has(r.claimCount)) add('Claims Reported', String(r.claimCount));
    if (has(r.totalIncurred)) add('Total Incurred', formatCurrency(r.totalIncurred));
    if (has(r.totalPaid)) add('Total Paid', formatCurrency(r.totalPaid));
    if (has(r.totalReserve)) add('Total Reserve', formatCurrency(r.totalReserve));
    return { fields };
  });
  const statesALoss = lossRuns.some((r) => (r.claimCount ?? 0) > 0 || (r.totalIncurred ?? 0) > 0 || (r.totalPaid ?? 0) > 0 || (r.totalReserve ?? 0) > 0);
  return { noLossesRecorded: !statesALoss, reports: reports.filter((r) => r.fields.length > 0) };
}
