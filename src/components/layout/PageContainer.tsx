import type { ReactNode } from 'react';

export function PageContainer({
  title,
  description,
  actions,
  children,
}: {
  /** Omit to skip the top-of-page header entirely — for a page that renders its own title/heading somewhere else in its layout (e.g. Market Finder puts it in a results column instead of above everything). */
  title?: string;
  /** A line under the title — text, or a small element such as the account's assigned agent. */
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {title && <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink-900)]">{title}</h1>}
            {description && <div className="mt-1 text-sm text-[var(--color-ink-500)]">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
