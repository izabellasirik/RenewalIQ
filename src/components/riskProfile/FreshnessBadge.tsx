import { reportAge, type FreshReportKind } from '../../services/workflow/freshness';
import { cn } from '../../utils/cn';

/** "Current" / "Outdated — 26 days old" for an MVR or loss-run report date (policy in services/workflow/freshness.ts). */
export function FreshnessBadge({ kind, reportDate }: { kind: FreshReportKind; reportDate?: string }) {
  const age = reportAge(kind, reportDate);
  if (!age) return null;
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        age.outdated ? 'bg-[var(--color-danger-100)] text-[var(--color-danger-600)]' : 'bg-[var(--color-success-100)] text-[var(--color-success-600)]'
      )}
      title={`Needs to be within ${age.maxAgeDays} days for submission / renewal review`}
    >
      {age.outdated ? `Outdated — ${age.ageDays} days old` : 'Current'}
    </span>
  );
}
