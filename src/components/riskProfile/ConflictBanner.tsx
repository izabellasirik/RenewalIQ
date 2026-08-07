import { TriangleAlert } from 'lucide-react';

export function ConflictBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/50 px-4 py-3">
      <TriangleAlert size={17} className="shrink-0 text-[var(--color-warning-600)]" />
      <p className="text-sm text-[var(--color-warning-600)]">
        <span className="font-semibold">{count} field{count === 1 ? '' : 's'}</span> have conflicting values across documents. Expand a field below to compare sources and resolve.
      </p>
    </div>
  );
}
