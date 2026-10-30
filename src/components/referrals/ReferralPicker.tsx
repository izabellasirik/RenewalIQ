import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReferralSources } from '../../hooks/useReferralSources';
import { NO_REFERRAL, OTHER_REFERRAL, type OtherReferral } from '../../services/supabase/partnersRepo';
import { centsInput, formatCents, parseMoneyCents } from '../../services/workflow/policies';
import { cn } from '../../utils/cn';

const TYPE_OTHER = '__type_other__';

/**
 * Where the client came from: No referral, a partner from the agency's list, or "Other" — the partner's name and the
 * amount they get, typed for this client only (0083; agents don't add partners to the list). The amount comes off the
 * client's first broker fee. An agent's Other goes to Admin Review with a bell to the admins.
 * `other`: the client's current Other partner. `saveOther`: saves it right away (an existing account); without it the
 * caller saves it with the rest (New Submission, the policy window).
 */
export function ReferralPicker({
  id,
  value,
  other = null,
  onChange,
  saveOther,
  placeholder,
  className,
  inputClassName,
  invalid,
  ariaLabel,
  feeLabels,
}: {
  id?: string;
  value: string;
  other?: OtherReferral | null;
  onChange: (value: string, label: string, other?: OtherReferral) => void;
  saveOther?: (other: OtherReferral) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** The empty first choice, e.g. "Where did the client come from?" or "Not set" (none: no empty choice). */
  placeholder?: string;
  className: string;
  /** For the boxes under "Other" (default: className). */
  inputClassName?: string;
  invalid?: boolean;
  ariaLabel?: string;
  /** The policy window (0085): each choice with its amount, and "No referral fee — $0". */
  feeLabels?: boolean;
}) {
  const sources = useReferralSources();
  const shown = sources.filter((s) => s.active || s.id === value);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = cn(inputClassName ?? className, 'w-full min-w-0');

  function startTyping() {
    setName(other?.name ?? '');
    setAmount(other ? centsInput(other.partnerFeeCents) : '');
    setError('');
    setTyping(true);
  }

  async function save() {
    const trimmed = name.trim();
    const cents = parseMoneyCents(amount);
    if (!trimmed) return setError('Type the partner’s name.');
    if (cents === null || Number.isNaN(cents) || cents < 0) return setError('Enter the partner’s amount in dollars, e.g. 50.00 (0 if none).');
    const next = { name: trimmed, partnerFeeCents: cents };
    if (saveOther) {
      setBusy(true);
      const r = await saveOther(next);
      setBusy(false);
      if (!r.ok) return setError(r.message);
    }
    setTyping(false);
    onChange(OTHER_REFERRAL, `Other: ${trimmed}`, next);
  }

  if (typing) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="referral-other">
        <input
          id={id}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setTyping(false)}
          maxLength={80}
          placeholder="Referral partner’s name"
          aria-label="Referral partner’s name"
          className={box}
        />
        <span className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-[var(--color-ink-400)]">$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
              if (e.key === 'Escape') setTyping(false);
            }}
            placeholder="Partner’s amount, e.g. 50.00"
            aria-label="Partner’s amount in dollars"
            className={cn(box, 'pl-6 tabular-nums')}
          />
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-[var(--color-brand-800)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} Save
          </button>
          <button type="button" onClick={() => setTyping(false)} className="shrink-0 cursor-pointer px-1 text-sm font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]">
            Cancel
          </button>
        </div>
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
        if (v === TYPE_OTHER) return startTyping();
        if (!v || v === OTHER_REFERRAL) return;
        onChange(v, v === NO_REFERRAL ? 'No referral' : (sources.find((s) => s.id === v)?.name ?? ''));
      }}
      className={cn(className, invalid && 'border-[var(--color-danger-500)]')}
      aria-label={ariaLabel}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      <option value={NO_REFERRAL}>{feeLabels ? 'No referral fee — $0' : 'No referral'}</option>
      {shown.map((s) => (
        <option key={s.id} value={s.id}>
          {feeLabels && s.partnerFeeCents != null ? `${s.name} — ${formatCents(s.partnerFeeCents)}` : s.name}
        </option>
      ))}
      {value === OTHER_REFERRAL && other && <option value={OTHER_REFERRAL}>{feeLabels ? `Other: ${other.name} — ${formatCents(other.partnerFeeCents)}` : `Other: ${other.name} (${formatCents(other.partnerFeeCents)})`}</option>}
      <option value={TYPE_OTHER}>{value === OTHER_REFERRAL ? 'Change the Other partner…' : 'Other: type the partner…'}</option>
    </select>
  );
}
