import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../../components/branding/Logo';

/**
 * Public pages (home, privacy, terms): readable without signing in. Facts the owner still has to supply
 * are marked TO CONFIRM rather than invented — see PUBLIC_FACTS.
 */
export const PUBLIC_FACTS = {
  /** The legal entity that operates RenewalIQ. */
  operator: 'RenewalIQ',
  /** Where users write about privacy and data deletion. */
  contactEmail: 'TO CONFIRM — privacy contact email',
  /** When these pages last changed. */
  updated: 'October 23, 2026',
};

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-50)]">
      <header className="border-b border-[var(--color-ink-100)] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="RenewalIQ home">
            <BrandLogo size={28} />
          </Link>
          <Link to="/login" className="text-sm font-medium text-[var(--color-brand-700)] hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 text-[15px] leading-relaxed text-[var(--color-ink-800)] [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </main>
      <footer className="mx-auto flex max-w-3xl gap-4 px-4 pb-10 text-sm text-[var(--color-ink-500)]">
        <Link to="/privacy" className="hover:underline">
          Privacy Policy
        </Link>
        <Link to="/terms" className="hover:underline">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
