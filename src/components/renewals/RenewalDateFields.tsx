import { addDays, daysBetween, formatShortDate } from '../../services/workflow/dates';
import { DEFAULT_LEAD_DAYS, checkRenewalInput } from '../../services/workflow/renewals';
import type { RenewalDates } from './renewalForm';
import { inputClass, labelClass } from '../workspace/formStyles';
import { cn } from '../../utils/cn';

/**
 * Renewal date (required) and "Start working on" (defaults to 45 days before; the broker can pick
 * another day). Used when creating an account, on the account's Renewal card and after binding.
 */
export function RenewalDateFields({ value, onChange, idPrefix, showErrors }: { value: RenewalDates; onChange: (v: RenewalDates) => void; idPrefix: string; showErrors?: boolean }) {
  const defaultStart = value.renewalDate ? addDays(value.renewalDate, -DEFAULT_LEAD_DAYS) : '';
  const start = value.startDate || defaultStart;
  const lead = value.renewalDate && start ? daysBetween(start, value.renewalDate) : null;
  const errors = showErrors ? checkRenewalInput(value) : [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-date`}>
          Renewal date <span className="text-[var(--color-danger-600)]">*</span>
        </label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          required
          value={value.renewalDate}
          onChange={(e) => onChange({ ...value, renewalDate: e.target.value })}
          className={cn(inputClass, showErrors && !value.renewalDate && 'border-[var(--color-danger-500)]')}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-start`}>
          Start working on
        </label>
        <input id={`${idPrefix}-start`} type="date" value={start} disabled={!value.renewalDate} onChange={(e) => onChange({ ...value, startDate: e.target.value === defaultStart ? '' : e.target.value })} className={inputClass} />
        <p className="mt-1 text-xs text-[var(--color-ink-500)]" data-testid={`${idPrefix}-start-hint`}>
          {!value.renewalDate
            ? `Default: ${DEFAULT_LEAD_DAYS} days before the renewal date.`
            : lead === null || lead < 0
              ? 'Pick a day on or before the renewal date.'
              : `${lead} day${lead === 1 ? '' : 's'} before${value.startDate ? '' : ' (default)'} — the reminder appears on Today’s Plate ${formatShortDate(start)}.`}
        </p>
      </div>
      {errors.length > 0 && (
        <p className="text-xs text-[var(--color-danger-600)] sm:col-span-2" role="alert">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}
