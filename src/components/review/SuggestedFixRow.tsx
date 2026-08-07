import { Sparkles, TriangleAlert } from 'lucide-react';
import type { FieldStatEntry } from '../../hooks/useRiskProfileStats';
import { Button, ConfidenceBadge } from '../ui';
import { displayReadValue } from '../riskProfile/FieldRow';

export function SuggestedFixRow({ entry, onResolve }: { entry: FieldStatEntry; onResolve: (value: unknown) => void }) {
  const { field, groupTitle, value } = entry;
  const alternates = value.alternateValues ?? [];

  return (
    <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)]">
            <TriangleAlert size={14} className="text-[var(--color-warning-600)]" />
            {field.label}
          </p>
          <p className="text-xs text-[var(--color-ink-500)]">{groupTitle}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-[var(--color-ink-100)] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-ink-900)]">{displayReadValue(value.value)}</span>
            <ConfidenceBadge confidence={value.confidence} />
          </div>
          {value.source && <p className="mt-1 text-xs text-[var(--color-ink-400)]">from {value.source.documentName}</p>}
        </div>
        {alternates.map((alt, i) => (
          <div key={i} className="rounded-md border border-[var(--color-ink-100)] bg-white p-3">
            <span className="text-sm text-[var(--color-ink-700)]">{displayReadValue(alt.value)}</span>
            <p className="mt-1 text-xs text-[var(--color-ink-400)]">from {alt.source.documentName}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-warning-100)] pt-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-600)]">
          <Sparkles size={13} className="text-[var(--color-accent-500)]" />
          Suggested: use {displayReadValue(value.value)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => onResolve(value.value)}>
            Accept suggestion
          </Button>
          {alternates.map((alt, i) => (
            <Button key={i} size="sm" variant="secondary" onClick={() => onResolve(alt.value)}>
              Use {displayReadValue(alt.value)} instead
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
