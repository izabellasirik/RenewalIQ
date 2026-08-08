import type { ReactNode } from 'react';

export interface InsightStatItem {
  label: string;
  value: string;
  caption?: string;
}

/** Compact row of derived-insight stat tiles, sat above an itemized table (Fleet/Drivers/Loss History). */
export function InsightStrip({ stats, footer }: { stats: InsightStatItem[]; footer?: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-[7rem]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{s.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-ink-900)]">{s.value}</p>
            {s.caption && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{s.caption}</p>}
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-[var(--color-ink-200)] pt-2 text-xs text-[var(--color-ink-500)]">{footer}</div>}
    </div>
  );
}
