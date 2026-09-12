import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CoverageLine, CoverageType } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import type { FieldResolution } from '../../services/extraction';
import { Button, ConfirmDialog } from '../ui';
import { FieldRow } from './FieldRow';
import { normalizeCurrencyText } from '../../utils/currency';

const ALL_COVERAGE_TYPES = Object.keys(COVERAGE_LABELS) as CoverageType[];

export function CoverageSection({
  coverage,
  onSave,
  onResolve,
  onAdd,
  onDelete,
}: {
  coverage: CoverageLine[];
  onSave: (coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
  onResolve: (coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', resolution: FieldResolution<string>) => void;
  onAdd: (coverageType: CoverageType) => void;
  onDelete: (coverageType: CoverageType) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<CoverageType | null>(null);
  const [addType, setAddType] = useState<CoverageType | ''>('');
  const availableToAdd = ALL_COVERAGE_TYPES.filter((t) => !coverage.some((c) => c.type === t));

  return (
    <div>
      {availableToAdd.length > 0 && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as CoverageType | '')}
            className="rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-xs text-[var(--color-ink-700)] outline-none"
          >
            <option value="">Choose a coverage…</option>
            {availableToAdd.map((t) => (
              <option key={t} value={t}>
                {COVERAGE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={13} />}
            disabled={!addType}
            onClick={() => {
              if (addType) onAdd(addType);
              setAddType('');
            }}
          >
            Add coverage
          </Button>
        </div>
      )}

      {coverage.length === 0 && <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-400)]">No coverages requested yet.</p>}

      {coverage.map((line) => (
        <div key={line.type} className="border-b border-[var(--color-ink-100)] py-3 last:border-0">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--color-ink-800)]">{COVERAGE_LABELS[line.type]}</p>
            <button
              onClick={() => setDeleteTarget(line.type)}
              className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer"
              aria-label={`Delete ${COVERAGE_LABELS[line.type]} coverage`}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <FieldRow
              label="Current Limit"
              valueType="text"
              field={line.currentLimit ?? { value: null, confidence: 'low', isMissing: true, isConflicting: false }}
              onSave={(value) => onSave(line.type, 'currentLimit', normalizeCurrencyText(value))}
              onResolve={(resolution) => onResolve(line.type, 'currentLimit', resolution.type === 'manual' ? { ...resolution, value: normalizeCurrencyText(resolution.value) } : resolution)}
            />
            <FieldRow
              label="Requested Limit"
              valueType="text"
              field={line.requestedLimit}
              onSave={(value) => onSave(line.type, 'requestedLimit', normalizeCurrencyText(value))}
              onResolve={(resolution) => onResolve(line.type, 'requestedLimit', resolution.type === 'manual' ? { ...resolution, value: normalizeCurrencyText(resolution.value) } : resolution)}
            />
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete this coverage?"
        description={`Remove ${deleteTarget ? COVERAGE_LABELS[deleteTarget] : 'this coverage'} from the submission. This cannot be undone.`}
        confirmLabel="Delete coverage"
      />
    </div>
  );
}
