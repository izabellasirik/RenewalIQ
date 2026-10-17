import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/** A centered dialog for short forms (request an item, mark received). Scrolls internally on small screens. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-[var(--color-ink-950)]/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <motion.div
              className={`pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'}`}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--color-ink-100)] px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--color-ink-900)]">{title}</h2>
                  {subtitle && <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">{subtitle}</p>}
                </div>
                <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
              {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-ink-100)] px-5 py-3">{footer}</div>}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
