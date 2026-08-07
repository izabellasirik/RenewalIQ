import { cn } from '../../utils/cn';

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-ink-100)]', className)}>
      <div
        className="h-full rounded-full bg-[var(--color-accent-500)] transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
