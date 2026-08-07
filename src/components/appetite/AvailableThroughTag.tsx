import { Link2 } from 'lucide-react';

export function AvailableThroughTag({ carrierName }: { carrierName: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-info-600)]">
      <Link2 size={11} />
      Available through {carrierName}
    </span>
  );
}
