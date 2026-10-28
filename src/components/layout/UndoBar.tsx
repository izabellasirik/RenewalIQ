import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { undoRemoval, usePendingRemovals } from '../../state/pendingRemovals';

/** "Policy … deleted · Undo (15s)" — one line per deletion still in its Undo window. */
export function UndoBar() {
  const items = usePendingRemovals();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 sm:bottom-6 flex flex-col items-center gap-2 px-4" aria-live="polite" data-testid="undo-bar">
      {items.map((it) => (
        <div key={it.key} className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-[var(--color-ink-900)] px-4 py-2.5 text-sm text-white shadow-lg">
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          <button type="button" onClick={() => undoRemoval(it.key)} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-semibold text-[var(--color-brand-200,#c7d7fe)] hover:bg-white/10">
            <Undo2 size={14} aria-hidden /> Undo
          </button>
          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-white/60">{Math.max(0, Math.ceil((it.until - now) / 1000))}s</span>
        </div>
      ))}
    </div>
  );
}
