import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * A simple centered lightbox for viewing the uploaded photo that produced an extracted value —
 * so a broker reviewing a field can always go look at the actual source image, not just its name.
 * Deliberately closes on a backdrop click (unlike ConfirmDialog) since viewing an image has no
 * destructive action to protect against accidentally triggering.
 */
export function ImagePreviewModal({ open, onClose, src, name }: { open: boolean; onClose: () => void; src: string; name: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-[var(--color-ink-950)]/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-100)] px-4 py-3">
              <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{name}</p>
              <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[var(--color-ink-50)] p-4">
              <img src={src} alt={name} className="mx-auto max-w-full rounded-lg" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
