import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-6 py-14 text-center">
      {icon && <div className="text-[var(--color-ink-400)]">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--color-ink-800)]">{title}</p>
        {description && <p className="max-w-sm text-sm text-[var(--color-ink-500)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
