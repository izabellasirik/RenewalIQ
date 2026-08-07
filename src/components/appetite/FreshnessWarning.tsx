import { Clock } from 'lucide-react';

export function FreshnessWarning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/50 px-3 py-2.5 text-xs text-[var(--color-warning-600)]">
      <Clock size={14} className="mt-0.5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
