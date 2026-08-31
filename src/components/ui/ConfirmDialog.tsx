import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';

/**
 * A centered confirmation modal for destructive/high-consequence actions — distinct from Drawer
 * (a side panel for forms/detail views). Confirming never happens on backdrop click, only the
 * explicit confirm button, so an accidental click outside the dialog can't trigger the action.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirming = false,
  variant = 'danger',
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  variant?: 'danger' | 'default';
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-[var(--color-ink-950)]/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
            role="alertdialog"
            aria-modal="true"
          >
            <div className="flex items-start gap-3">
              {variant === 'danger' && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-danger-100)]">
                  <TriangleAlert size={18} className="text-[var(--color-danger-600)]" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-ink-900)]">{title}</p>
                <p className="mt-1.5 text-sm text-[var(--color-ink-600)]">{description}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={confirming}>
                {cancelLabel}
              </Button>
              <Button variant={variant === 'danger' ? 'danger' : 'primary'} size="sm" onClick={onConfirm} disabled={confirming}>
                {confirming ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
