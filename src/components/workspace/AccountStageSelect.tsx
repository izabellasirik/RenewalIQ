import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { AccountStage } from '../../types';
import { ACCOUNT_STAGE_LABELS, ACCOUNT_STAGE_ORDER } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { deriveAccountStage } from '../../services/workflow/accountStage';
import { Badge } from '../ui';
import { ACCOUNT_STAGE_TONE } from './accountStageStyle';
import { cn } from '../../utils/cn';

/**
 * The account's pipeline status. "Automatic" follows the checklist and quotes; picking a status
 * pins it until the broker switches back to automatic. Each status shows in its color — the same
 * colors as on the Accounts list.
 */
export function AccountStageSelect({ accountId, className }: { accountId: string; className?: string }) {
  const { account, items, quotes } = useAccountWorkflow(accountId);
  const setAccountStage = useAccountsStore((s) => s.setAccountStage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!account) return null;
  const derived = deriveAccountStage(items, quotes);
  const current = account.stage ?? derived;

  function choose(stage: AccountStage | null) {
    setAccountStage(accountId, stage);
    setOpen(false);
  }

  const optionClass = 'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-[var(--color-ink-50)] cursor-pointer';

  return (
    <div ref={ref} className={cn('relative inline-flex items-center gap-2 text-sm text-[var(--color-ink-600)]', className)}>
      <span className="font-medium">Status</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Client status"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-200)] bg-white py-1 pl-1.5 pr-2 outline-none hover:border-[var(--color-ink-300)] focus-visible:border-[var(--color-brand-500)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/15 cursor-pointer"
      >
        <Badge tone={ACCOUNT_STAGE_TONE[current]} dot>
          {ACCOUNT_STAGE_LABELS[current]}
        </Badge>
        {!account.stage && <span className="text-xs text-[var(--color-ink-400)]">Automatic</span>}
        <ChevronDown size={14} className="text-[var(--color-ink-400)]" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Client status" className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white py-1 [box-shadow:var(--shadow-popover)]">
          <li role="option" aria-selected={!account.stage}>
            <button type="button" onClick={() => choose(null)} className={optionClass}>
              <span className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-ink-500)]">Automatic —</span>
                <Badge tone={ACCOUNT_STAGE_TONE[derived]} dot>
                  {ACCOUNT_STAGE_LABELS[derived]}
                </Badge>
              </span>
              {!account.stage && <Check size={14} className="text-[var(--color-brand-700)]" />}
            </button>
          </li>
          <li className="my-1 border-t border-[var(--color-ink-100)]" aria-hidden />
          {ACCOUNT_STAGE_ORDER.map((s) => (
            <li key={s} role="option" aria-selected={account.stage === s}>
              <button type="button" onClick={() => choose(s)} className={optionClass}>
                <Badge tone={ACCOUNT_STAGE_TONE[s]} dot>
                  {ACCOUNT_STAGE_LABELS[s]}
                </Badge>
                {account.stage === s && <Check size={14} className="text-[var(--color-brand-700)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
