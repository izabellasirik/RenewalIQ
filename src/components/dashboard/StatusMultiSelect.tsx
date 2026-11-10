import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface StatusOption {
  value: string;
  label: string;
  count?: number;
}

/** A filter where several statuses can be picked at once; none picked = all. */
export function StatusMultiSelect({ options, selected, onChange, allLabel, className }: { options: (StatusOption | 'divider')[]; selected: string[]; onChange: (next: string[]) => void; allLabel: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const real = options.filter((o): o is StatusOption => o !== 'divider');
  const picked = real.filter((o) => selected.includes(o.value));
  const label = picked.length === 0 ? allLabel : picked.length <= 2 ? picked.map((o) => o.label).join(', ') : `${picked.length} statuses`;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Filter by status" onClick={() => setOpen((o) => !o)} className={cn(className, 'flex items-center gap-2 text-left')} data-testid="status-filter">
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--color-ink-500)]" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-[var(--color-ink-200)] bg-white py-1 text-sm shadow-lg">
          {options.map((o, i) =>
            o === 'divider' ? (
              <div key={`d${i}`} className="my-1 border-t border-[var(--color-ink-100)]" />
            ) : (
              <button key={o.value} type="button" role="option" aria-selected={selected.includes(o.value)} onClick={() => toggle(o.value)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-ink-50)]">
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', selected.includes(o.value) ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white' : 'border-[var(--color-ink-300)]')}>
                  {selected.includes(o.value) && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="flex-1 text-[var(--color-ink-800)]">{o.label}</span>
                {o.count !== undefined && <span className="text-xs text-[var(--color-ink-400)]">{o.count}</span>}
              </button>
            )
          )}
          <div className="mt-1 flex justify-between border-t border-[var(--color-ink-100)] px-3 pt-1.5 pb-1">
            <button type="button" className="cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline disabled:opacity-40" disabled={selected.length === 0} onClick={() => onChange([])}>
              Clear
            </button>
            <button type="button" className="cursor-pointer text-xs font-medium text-[var(--color-ink-600)] hover:underline" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
