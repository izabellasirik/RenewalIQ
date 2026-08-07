import { Bell } from 'lucide-react';

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-[var(--color-ink-100)] bg-white px-8">
      <button className="rounded-full p-2 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] hover:text-[var(--color-ink-600)]" aria-label="Notifications">
        <Bell size={17} />
      </button>
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink-100)] text-xs font-semibold text-[var(--color-ink-600)]">
          BR
        </div>
        <div className="leading-tight">
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Broker</p>
          <p className="text-[11px] text-[var(--color-ink-400)]">Commercial Lines</p>
        </div>
      </div>
    </header>
  );
}
