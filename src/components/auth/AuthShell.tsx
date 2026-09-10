import type { ReactNode } from 'react';

/** Shared centered-card layout for /login and /signup — deliberately outside AppShell (no Sidebar/TopBar/workspace chrome), since a visitor here isn't in a submission workspace yet. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink-50)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-brand-800)] text-base font-bold text-white">R</div>
          <p className="text-sm font-semibold tracking-tight text-[var(--color-ink-900)]">Renewal IQ</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export const authInputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
