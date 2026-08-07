import { cn } from '../../utils/cn';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({ items, active, onChange }: { items: TabItem[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-[var(--color-ink-100)]">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer',
              isActive ? 'text-[var(--color-brand-800)]' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]'
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  isActive ? 'bg-[var(--color-accent-100)] text-[var(--color-accent-600)]' : 'bg-[var(--color-ink-100)] text-[var(--color-ink-500)]'
                )}
              >
                {item.count}
              </span>
            )}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--color-brand-700)]" />}
          </button>
        );
      })}
    </div>
  );
}
