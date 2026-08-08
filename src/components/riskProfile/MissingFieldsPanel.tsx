import { CircleHelp } from 'lucide-react';

export interface MissingFieldChip {
  label: string;
  section: 'business' | 'transportation';
  key: string;
}

export function MissingFieldsPanel({ fields, onFieldClick }: { fields: MissingFieldChip[]; onFieldClick?: (section: 'business' | 'transportation', key: string) => void }) {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3">
      <CircleHelp size={17} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-ink-700)]">
          {fields.length} field{fields.length === 1 ? '' : 's'} still missing
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <button
              key={`${f.section}.${f.key}`}
              onClick={() => onFieldClick?.(f.section, f.key)}
              className="rounded-full bg-[var(--color-ink-100)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-600)] hover:bg-[var(--color-ink-200)] cursor-pointer"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
