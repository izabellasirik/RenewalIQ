import { part, type DurationDraft } from '../../utils/durationDraft';

/** Years + Months boxes with an optional "or more" (+) toggle. Stored as months by the caller. */
export function DurationInput({
  value,
  onChange,
  inputClassName,
  compact,
  autoFocus,
  label,
}: {
  value: DurationDraft;
  onChange: (next: DurationDraft) => void;
  inputClassName: string;
  compact?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const monthsBad = part(value.months) === null || (part(value.months) ?? 0) > 11;
  const yearsBad = part(value.years) === null;
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1' : 'flex flex-wrap items-center gap-2'}>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)]">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={value.years}
          onChange={(e) => onChange({ ...value, years: e.target.value })}
          className={`${inputClassName.replace('w-full', '')} ${compact ? 'w-12' : 'w-16'} ${yearsBad ? 'border-[var(--color-danger-600)]' : ''}`}
          placeholder="0"
          aria-label={label ? `${label} — years` : 'Years'}
          autoFocus={autoFocus}
        />
        {compact ? 'y' : 'years'}
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)]">
        <input
          type="number"
          min={0}
          max={11}
          inputMode="numeric"
          value={value.months}
          onChange={(e) => onChange({ ...value, months: e.target.value })}
          className={`${inputClassName.replace('w-full', '')} ${compact ? 'w-12' : 'w-16'} ${monthsBad ? 'border-[var(--color-danger-600)]' : ''}`}
          placeholder="0"
          aria-label={label ? `${label} — months` : 'Months'}
        />
        {compact ? 'm' : 'months'}
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)]" title="Or more — e.g. 16+ years">
        <input type="checkbox" checked={value.orMore} onChange={(e) => onChange({ ...value, orMore: e.target.checked })} aria-label={label ? `${label} — or more` : 'Or more'} />
        {compact ? '+' : 'or more (+)'}
      </label>
    </div>
  );
}
