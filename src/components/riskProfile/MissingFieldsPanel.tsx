import { CircleHelp } from 'lucide-react';

export function MissingFieldsPanel({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3">
      <CircleHelp size={17} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
      <div>
        <p className="text-sm font-medium text-[var(--color-ink-700)]">
          {fields.length} field{fields.length === 1 ? '' : 's'} still missing
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{fields.join(' · ')}</p>
      </div>
    </div>
  );
}
