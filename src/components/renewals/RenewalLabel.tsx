import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { renewalLabelOn } from '../../services/workflow/renewals';
import { todayKey } from '../../services/workflow/dates';
import { cn } from '../../utils/cn';

export function RenewalBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-[#efe7fb] px-2.5 py-1 text-xs font-medium leading-none text-[#6a3fb5]', className)} data-testid="renewal-label">
      <RefreshCw size={11} aria-hidden /> Renewal
    </span>
  );
}

/**
 * The "Renewal" label beside the account's status, with its switch: Automatic (on from the renewal's
 * start-working date until bound), On, or Off. The status itself (Quoted, Collecting info…) is
 * unaffected — the two show side by side.
 */
export function RenewalLabelSelect({ accountId }: { accountId: string }) {
  const { account, quotes, effectiveDate } = useAccountWorkflow(accountId);
  const setRenewalLabel = useAccountsStore((s) => s.setRenewalLabel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!account) return null;
  const today = todayKey();
  const label = renewalLabelOn(account, effectiveDate, quotes, today);
  const auto = renewalLabelOn({ ...account, renewalLabel: undefined }, effectiveDate, quotes, today).on;
  const choose = (v: boolean | null) => {
    setRenewalLabel(accountId, v);
    setOpen(false);
  };
  const option = 'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-ink-50)] cursor-pointer';

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Renewal label"
        className="inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 outline-none hover:bg-[var(--color-ink-100)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/20 cursor-pointer"
      >
        {label.on ? <RenewalBadge /> : <span className="rounded-full border border-dashed border-[var(--color-ink-200)] px-2.5 py-1 text-xs text-[var(--color-ink-400)]">No renewal label</span>}
        {!label.manual && <span className="text-xs text-[var(--color-ink-400)]">Automatic</span>}
        <ChevronDown size={14} className="text-[var(--color-ink-400)]" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Renewal label" className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white py-1 [box-shadow:var(--shadow-popover)]">
          <li role="option" aria-selected={!label.manual}>
            <button type="button" className={option} onClick={() => choose(null)}>
              <span>
                Automatic <span className="text-xs text-[var(--color-ink-500)]">— {auto ? 'on now' : 'off now'} (on from the start-working date until bound)</span>
              </span>
              {!label.manual && <Check size={14} className="text-[var(--color-brand-700)]" />}
            </button>
          </li>
          <li role="option" aria-selected={label.manual && label.on}>
            <button type="button" className={option} onClick={() => choose(true)}>
              On
              {label.manual && label.on && <Check size={14} className="text-[var(--color-brand-700)]" />}
            </button>
          </li>
          <li role="option" aria-selected={label.manual && !label.on}>
            <button type="button" className={option} onClick={() => choose(false)}>
              Off
              {label.manual && !label.on && <Check size={14} className="text-[var(--color-brand-700)]" />}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
