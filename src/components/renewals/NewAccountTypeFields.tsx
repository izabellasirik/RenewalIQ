import type { AccountBusinessType } from '../../types';
import { RenewalDateFields } from './RenewalDateFields';
import type { NewAccountTypeValue } from './renewalForm';
import { cn } from '../../utils/cn';

const OPTIONS: { key: AccountBusinessType; label: string; hint: string }[] = [
  { key: 'new_venture', label: 'New venture', hint: 'A new business or first policy' },
  { key: 'renewal', label: 'Renewal', hint: 'Renewing coverage the client has now' },
];

/** New Submission: new venture or renewal (required), and for a renewal its date and when to start. */
export function NewAccountTypeFields({ value, onChange, showErrors }: { value: NewAccountTypeValue; onChange: (v: NewAccountTypeValue) => void; showErrors?: boolean }) {
  return (
    <div className="flex flex-col gap-3" data-testid="account-type">
      <div>
        <p className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]" id="account-type-label">
          New venture or renewal? <span className="text-[var(--color-danger-600)]">*</span>
        </p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="account-type-label">
          {OPTIONS.map((o) => {
            const on = value.businessType === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...value, businessType: o.key })}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left cursor-pointer',
                  on ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-800)]/5 ring-2 ring-[var(--color-brand-500)]/15' : 'border-[var(--color-ink-200)] hover:border-[var(--color-ink-300)]',
                  showErrors && !value.businessType && 'border-[var(--color-danger-500)]'
                )}
              >
                <span className="block text-sm font-medium text-[var(--color-ink-900)]">{o.label}</span>
                <span className="block text-xs text-[var(--color-ink-500)]">{o.hint}</span>
              </button>
            );
          })}
        </div>
        {showErrors && !value.businessType && (
          <p className="mt-1 text-xs text-[var(--color-danger-600)]" role="alert" data-testid="type-required">
            Choose New venture or Renewal.
          </p>
        )}
      </div>
      {value.businessType === 'renewal' && <RenewalDateFields idPrefix="new-renewal" value={value} onChange={(d) => onChange({ ...value, ...d })} showErrors={showErrors} />}
    </div>
  );
}
