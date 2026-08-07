import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  onSelect: () => void;
}

export function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer"
        aria-label="More actions"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white py-1 [box-shadow:var(--shadow-popover)]">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                item.tone === 'danger' ? 'text-[var(--color-danger-600)] hover:bg-[var(--color-danger-100)]' : 'text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
