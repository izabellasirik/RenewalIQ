import { RefreshCw } from 'lucide-react';

/** Shown when a newer RenewalIQ is out; it also loads by itself at the next page change. */
export function UpdateBar() {
  return (
    <div className="flex items-center justify-center gap-3 bg-[var(--color-brand-800)] px-4 py-1.5 text-sm text-white" role="status" data-testid="update-bar">
      <span>RenewalIQ was updated</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25"
      >
        <RefreshCw size={13} aria-hidden /> Refresh
      </button>
    </div>
  );
}
