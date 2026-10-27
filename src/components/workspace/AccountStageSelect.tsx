import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { AccountStage } from '../../types';
import { MANUAL_ACCOUNT_STAGES } from '../../types';
import { useCancelledPolicies } from '../../hooks/usePolicyCancellations';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { deriveAccountStage } from '../../services/workflow/accountStage';
import { renewalLabelOn } from '../../services/workflow/renewals';
import { todayKey } from '../../services/workflow/dates';
import { StageBadge } from './StageBadge';
import { RenewalBadge } from '../renewals/RenewalLabel';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from './formStyles';
import { cn } from '../../utils/cn';

/**
 * The account's pipeline status. "Automatic" follows the checklist and quotes; picking a status
 * pins it until the agent switches back to automatic. Each status shows in its color — the same
 * colors as on the Accounts list. Above the statuses, "Renewal" is an on / off switch shown beside
 * the status: it turns on by itself from the renewal's start-working date. Picking Bound asks for
 * the bound date, which the Accounts list shows next to the status.
 */
export function AccountStageSelect({ accountId, className }: { accountId: string; className?: string }) {
  const { account, items, quotes, effectiveDate } = useAccountWorkflow(accountId);
  const cancelled = useCancelledPolicies()(accountId);
  const setAccountStage = useAccountsStore((s) => s.setAccountStage);
  const setRenewalLabel = useAccountsStore((s) => s.setRenewalLabel);
  const [open, setOpen] = useState(false);
  const [askBound, setAskBound] = useState(false);
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
  const derived = deriveAccountStage(items, quotes, cancelled);
  const current = account.stage ?? derived;
  const renewal = renewalLabelOn(account, effectiveDate, quotes, todayKey());

  function choose(stage: AccountStage | null) {
    setOpen(false);
    if (stage === 'bound') return setAskBound(true);
    setAccountStage(accountId, stage);
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
        // The colored status pill is the control — no extra box around it.
        className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 outline-none hover:bg-[var(--color-ink-100)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/20 cursor-pointer"
      >
        {renewal.on && <RenewalBadge />}
        <StageBadge stage={current} />
        {!account.stage && <span className="text-xs text-[var(--color-ink-400)]">Automatic</span>}
        <ChevronDown size={14} className="text-[var(--color-ink-400)]" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Client status" className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white py-1 [box-shadow:var(--shadow-popover)]">
          <li role="option" aria-selected={!account.stage}>
            <button type="button" onClick={() => choose(null)} className={optionClass}>
              <span className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-ink-500)]">Automatic —</span>
                <StageBadge stage={derived} />
              </span>
              {!account.stage && <Check size={14} className="text-[var(--color-brand-700)]" />}
            </button>
          </li>
          <li className="my-1 border-t border-[var(--color-ink-100)]" aria-hidden />
          <li className="px-3 py-1.5" data-testid="renewal-switch-row">
            <div className="flex items-center justify-between gap-3">
              <RenewalBadge />
              <RenewalSwitch on={renewal.on} onChange={(on) => setRenewalLabel(accountId, on)} />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[var(--color-ink-500)]">
              {renewal.manual ? 'Set by hand. ' : ''}Turns on by itself from the renewal’s start-working date.
              {renewal.manual && (
                <>
                  {' '}
                  <button type="button" className="font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer" onClick={() => setRenewalLabel(accountId, null)}>
                    Back to automatic
                  </button>
                </>
              )}
            </p>
          </li>
          <li className="my-1 border-t border-[var(--color-ink-100)]" aria-hidden />
          {MANUAL_ACCOUNT_STAGES.map((s) => (
            <li key={s} role="option" aria-selected={account.stage === s}>
              <button type="button" onClick={() => choose(s)} className={optionClass}>
                <StageBadge stage={s} />
                {account.stage === s && <Check size={14} className="text-[var(--color-brand-700)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {askBound && (
        <BoundDateDialog
          initial={account.stage === 'bound' ? (account.boundDate ?? '') : ''}
          onCancel={() => setAskBound(false)}
          onSave={(date) => {
            setAccountStage(accountId, 'bound', date);
            setAskBound(false);
          }}
        />
      )}
    </div>
  );
}

/** An on / off switch. */
export function RenewalSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Renewal"
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/30',
        on ? 'bg-[#6a3fb5]' : 'bg-[var(--color-ink-200)]'
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      <span className="sr-only">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

function BoundDateDialog({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (date: string) => void }) {
  const [date, setDate] = useState(initial);
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) return setError('Choose the bound date.');
    onSave(date);
  }
  return (
    <Modal
      open
      onClose={onCancel}
      title="Mark Bound"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form="account-bound-form">
            Save
          </Button>
        </>
      }
    >
      <form id="account-bound-form" onSubmit={submit} noValidate className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor="account-bound-date">
          Bound date
        </label>
        <input id="account-bound-date" type="date" className={inputClass} value={date} onChange={(e) => (setDate(e.target.value), setError(''))} autoFocus />
        {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
      </form>
    </Modal>
  );
}
