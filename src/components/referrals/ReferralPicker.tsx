import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { reloadReferralSources, useReferralSources } from '../../hooks/useReferralSources';
import { NO_REFERRAL, requestReferralSource } from '../../services/supabase/partnersRepo';
import { useAccountsStore } from '../../state/useAccountsStore';
import { cn } from '../../utils/cn';

const OTHER = '__other__';

/**
 * Where the client came from: No referral, a partner from the agency's list, or "Other" to type a new partner's
 * name (0083). An agent's new partner waits for an admin's approval (admins are notified) and can be picked right
 * away; an admin's is added straight away. `accountId`: the account it's for, when it exists already.
 */
export function ReferralPicker({
  id,
  value,
  onChange,
  accountId = null,
  placeholder,
  className,
  inputClassName,
  invalid,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string, label: string) => void;
  accountId?: string | null;
  /** The empty first choice, e.g. "Where did the client come from?" or "Not set" (none: no empty choice). */
  placeholder?: string;
  className: string;
  /** For the name box under "Other" (default: className). */
  inputClassName?: string;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const sources = useReferralSources();
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const shown = sources.filter((s) => s.active || s.id === value);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Type the partner’s name.');
    setBusy(true);
    setError('');
    const r = await requestReferralSource(trimmed, accountId);
    if (!r.ok) {
      setBusy(false);
      return setError(r.message);
    }
    await reloadReferralSources();
    setBusy(false);
    setTyping(false);
    setName('');
    onChange(r.data, trimmed);
  }

  if (typing) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="referral-other">
        <input
          id={id}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
            if (e.key === 'Escape') setTyping(false);
          }}
          maxLength={80}
          placeholder="Referral partner’s name"
          aria-label="New referral partner’s name"
          className={cn(inputClassName ?? className, 'w-full min-w-0')}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-[var(--color-brand-800)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} Add
          </button>
          <button type="button" onClick={() => setTyping(false)} className="shrink-0 cursor-pointer px-1 text-sm font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]">
            Cancel
          </button>
        </div>
        <p className="text-xs text-[var(--color-ink-500)]">{isAdmin ? 'It’s added to Partnerships; set its agreed amount there.' : 'Your admin will be asked to approve it and set the agreed amount.'}</p>
        {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === OTHER) {
          setError('');
          return setTyping(true);
        }
        if (!v) return;
        onChange(v, v === NO_REFERRAL ? 'No referral' : (sources.find((s) => s.id === v)?.name ?? ''));
      }}
      className={cn(className, invalid && 'border-[var(--color-danger-500)]')}
      aria-label={ariaLabel}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      <option value={NO_REFERRAL}>No referral</option>
      {shown.map((s) => (
        <option key={s.id} value={s.id}>
          {s.status === 'pending' ? `${s.name} (awaiting approval)` : s.name}
        </option>
      ))}
      <option value={OTHER}>Other: type the name…</option>
    </select>
  );
}
