import { useContext, useEffect, useRef, useState } from 'react';
import { Flag, FlaskConical } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Badge } from '../ui';
import { smallInputClass } from '../workspace/formStyles';
import { TRANSACTION_TYPES, fmtMoney, monthLabel, type Producer, type TransactionType } from '../../services/commissions/calc';
import type { AssumptionId } from '../../services/commissions/assumptions';
import { AssumptionContext } from './commissionsUi';

/** Marks a figure or label that depends on a rule the agency hasn't confirmed. */
export function AssumptionFlag({ id, className }: { id: AssumptionId; className?: string }) {
  const open = useContext(AssumptionContext);
  return (
    <button
      type="button"
      onClick={() => open(id)}
      data-assumption={id}
      title={`Assumption ${id} — not confirmed by your agency yet`}
      aria-label={`Assumption ${id}, not confirmed yet — show details`}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md border border-[var(--color-warning-500)]/40 bg-[var(--color-warning-100)] px-1 py-px align-middle text-[10px] font-semibold leading-4 text-[var(--color-warning-600)] hover:border-[var(--color-warning-500)] print:border-0 print:bg-transparent',
        className
      )}
    >
      <Flag size={9} aria-hidden />
      {id}
    </button>
  );
}

/** A money figure; negatives (chargebacks) in red. */
export function Money({ cents, className, strong }: { cents: number; className?: string; strong?: boolean }) {
  return <span className={cn('whitespace-nowrap tabular-nums', cents < 0 && 'text-[var(--color-danger-600)]', strong && 'font-semibold', className)}>{fmtMoney(cents)}</span>;
}

export function TypeBadge({ type }: { type: TransactionType }) {
  const t = TRANSACTION_TYPES[type];
  return (
    <Badge tone={t.sign < 0 ? 'danger' : type === 'endorsement_add' ? 'info' : 'neutral'} className="whitespace-nowrap" title={t.label}>
      {t.short}
    </Badge>
  );
}

/** The fictional-data marker shown on every Commissions screen. */
export function SampleDataBanner({ onReset }: { onReset: () => void }) {
  return (
    <div data-testid="sample-banner" className="flex flex-col gap-2 rounded-xl border border-[var(--color-warning-500)]/35 bg-[var(--color-warning-100)] px-4 py-2.5 text-sm text-[var(--color-ink-800)] sm:flex-row sm:items-center sm:justify-between print:border-[var(--color-ink-300)] print:bg-white">
      <p className="flex gap-2.5">
        <FlaskConical size={17} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" aria-hidden />
        <span>
          <strong>Sample data — not real commissions.</strong> Fictional producers, accounts and example rates. Nothing is saved to RenewalIQ. <AssumptionFlag id="A1" className="pointer-events-none mx-0.5" /> marks a rule not yet confirmed.
        </span>
      </p>
      <button type="button" onClick={onReset} className="shrink-0 self-start rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer sm:self-center print:hidden">
        Reset sample data
      </button>
    </div>
  );
}

const selectClass = 'rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

export function MonthSelect({ months, value, onChange, id = 'commission-month' }: { months: string[]; value: string; onChange: (m: string) => void; id?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-ink-600)]" htmlFor={id}>
      <span className="font-medium">Month</span>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProducerSelect({ producers, value, onChange, allLabel, id }: { producers: Producer[]; value: string; onChange: (id: string) => void; allLabel?: string; id: string }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel ?? 'Choose a producer…'}</option>
      {producers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/**
 * A number that's edited in place: commits on blur or Enter, reverts on Escape, and shows the stored
 * value again if the parent rejects it.
 */
export function InlineNumber({ value, onCommit, label, width = 'w-24', suffix }: { value: string; onCommit: (raw: string) => boolean; label: string; width?: string; suffix?: string }) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return setBad(false);
    const accepted = onCommit(draft);
    setBad(!accepted);
    if (!accepted) setDraft(value);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={ref}
        aria-label={label}
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ref.current?.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setBad(false);
          }
        }}
        className={cn(smallInputClass, 'py-1.5 text-right text-sm tabular-nums', width, bad && 'border-[var(--color-danger-500)]')}
      />
      {suffix && <span className="text-xs text-[var(--color-ink-400)]">{suffix}</span>}
    </span>
  );
}

/** A one-line confirmation under the page header (no global toast system in RenewalIQ). */
export function StatusLine({ message, tone }: { message: string | null; tone: 'success' | 'danger' }) {
  if (!message) return null;
  return (
    <p role="status" className={cn('rounded-lg px-3 py-2 text-sm', tone === 'success' ? 'bg-[var(--color-success-100)] text-[var(--color-success-600)]' : 'bg-[var(--color-danger-100)] text-[var(--color-danger-600)]')}>
      {message}
    </p>
  );
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="mb-3 list-disc rounded-lg bg-[var(--color-danger-100)] py-2 pl-7 pr-3 text-sm text-[var(--color-danger-600)]">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}
