import { useEffect, useState } from 'react';

/**
 * A native date input that only commits plausible dates. Browsers fire onChange while a year is
 * being typed ("0002-09-25", "0020-…"), which would otherwise log a follow-up for the year 2 in
 * the activity history. Commits on a complete year ≥ 2000, or on clear.
 */
export function DateInput({
  value,
  onCommit,
  className,
  autoFocus,
  onBlur,
  'aria-label': ariaLabel,
}: {
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  return (
    <input
      type="date"
      value={draft}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      className={className}
      onBlur={onBlur}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next === '') {
          if (value) onCommit(undefined);
          return;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(next) && Number(next.slice(0, 4)) >= 2000 && next !== value) onCommit(next);
      }}
    />
  );
}
