import type { LossRun, MappedLossRunSummary, RiskProfile } from '../../types';
import { formatCurrency, formatDateMDY } from './formatters';
import { cleanCarrierName } from '../../utils/carrierName';

const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/** What a report says about losses — "No losses" only when it says so, never assumed from silence. */
function lossesCell(r: LossRun): string {
  const incurred = has(r.totalIncurred) ? `${formatCurrency(r.totalIncurred)} incurred` : '';
  if (r.claimCount === 0 && !(r.totalIncurred && r.totalIncurred > 0)) return 'No losses';
  if (has(r.claimCount)) return [`${r.claimCount} claim${r.claimCount === 1 ? '' : 's'}`, incurred].filter(Boolean).join(', ');
  if (incurred) return incurred;
  return 'Not stated on report';
}

/**
 * When an account has loss run reports but no itemized claims, the application's Loss History is a
 * table of the reports: insurance company, policy number, report date, coverage period, and what each
 * report says about losses ("No losses", "2 claims, $5,000 incurred", or "Not stated on report").
 * Columns no report fills are left off. With itemized claims, or no reports at all, there is no summary.
 */
export function buildLossRunSummary(profile: RiskProfile, lossRuns: LossRun[] | undefined): MappedLossRunSummary | undefined {
  if ((profile.lossHistory ?? []).length > 0 || !lossRuns?.length) return undefined;
  const all = [
    { key: 'carrier', label: 'Insurance Company' },
    { key: 'policyNumber', label: 'Policy Number' },
    { key: 'reportDate', label: 'Report Date' },
    { key: 'period', label: 'Coverage Period' },
    { key: 'losses', label: 'Losses' },
  ];
  const rows = lossRuns.map((r) => {
    const start = has(r.coverageStart) ? formatDateMDY(r.coverageStart) : '';
    const end = has(r.coverageEnd) ? formatDateMDY(r.coverageEnd) : '';
    const carrier = cleanCarrierName(r.carrier);
    return {
      id: r.id,
      cells: {
        carrier: carrier === 'Carrier not listed' ? '' : carrier,
        policyNumber: r.policyNumber?.trim() ?? '',
        reportDate: has(r.reportDate) ? formatDateMDY(r.reportDate) : '',
        period: start && end ? `${start} – ${end}` : start ? `From ${start}` : end ? `To ${end}` : '',
        losses: lossesCell(r),
      } as Record<string, string>,
    };
  });
  const columns = all.filter((c) => c.key === 'losses' || rows.some((r) => r.cells[c.key]));
  return { allReportNoLosses: rows.every((r) => r.cells.losses === 'No losses'), columns, rows };
}
