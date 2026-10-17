import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { onTimeSavedAsk, recordTimeSaved, TIME_SAVED_OPTIONS, WORKFLOW_LABELS, type TimeSavedAsk } from '../../services/productAnalytics/timeSaved';

/** The small, optional "how long would this normally take?" card — one tap, or dismiss. */
export function TimeSavedPrompt() {
  const [ask, setAsk] = useState<TimeSavedAsk | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    onTimeSavedAsk((a) => {
      setThanks(false);
      setAsk(a);
    });
    return () => onTimeSavedAsk(null);
  }, []);

  if (!ask) return null;

  function answer(value: Parameters<typeof recordTimeSaved>[1]) {
    if (!ask) return;
    recordTimeSaved(ask, value);
    if (value === 'skipped') return setAsk(null);
    setThanks(true);
    setTimeout(() => setAsk(null), 1800);
  }

  return (
    <div className="fixed bottom-20 right-4 z-40 w-[320px] rounded-xl border border-[var(--color-ink-100)] bg-white p-4 shadow-xl" role="dialog" aria-label="Quick question" data-testid="time-saved-prompt">
      <button onClick={() => answer('skipped')} className="absolute right-2 top-2 rounded p-1 text-[var(--color-ink-400)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Skip">
        <X size={14} />
      </button>
      {thanks ? (
        <p className="text-sm text-[var(--color-ink-700)]">Thanks — that helps us improve Renewal IQ.</p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 pr-5 text-sm font-semibold text-[var(--color-ink-900)]">
            <Clock size={14} className="text-[var(--color-brand-700)]" /> Quick question (optional)
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-600)]">
            {WORKFLOW_LABELS[ask.workflow]} — approximately how long would this normally have taken without Renewal IQ?
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TIME_SAVED_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => answer(o.value)}
                className="rounded-full border border-[var(--color-ink-200)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-700)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] cursor-pointer"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
