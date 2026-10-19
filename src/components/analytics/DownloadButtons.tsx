import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadReport, REPORT_FORMAT_LABELS, type Report, type ReportFormat } from '../../services/reports/report';

/** "Download: CSV · Excel · PDF" — the report of exactly what's shown (the filtered list). */
export function DownloadButtons({ report, disabled, testId }: { report: () => Report; disabled?: boolean; testId: string }) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState('');
  const go = async (format: ReportFormat) => {
    setBusy(format);
    setError('');
    try {
      await downloadReport(report(), format);
    } catch {
      setError(`Couldn’t make the ${REPORT_FORMAT_LABELS[format]} file. Try again, or download another format.`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col items-start gap-1 lg:items-end">
      <div className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--color-ink-200)] bg-white text-sm" data-testid={testId}>
        <span className="flex items-center gap-1.5 border-r border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-3 py-1.5 font-medium text-[var(--color-ink-600)]">
          <Download size={14} aria-hidden /> Download
        </span>
        {(Object.keys(REPORT_FORMAT_LABELS) as ReportFormat[]).map((f, i) => (
          <button
            key={f}
            type="button"
            disabled={disabled || !!busy}
            onClick={() => void go(f)}
            className={`flex cursor-pointer items-center gap-1 px-3 py-1.5 font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-ink-50)] disabled:cursor-not-allowed disabled:opacity-50 ${i ? 'border-l border-[var(--color-ink-100)]' : ''}`}
            aria-label={`Download as ${REPORT_FORMAT_LABELS[f]}`}
          >
            {busy === f && <Loader2 size={12} className="animate-spin" aria-hidden />}
            {REPORT_FORMAT_LABELS[f]}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-[var(--color-danger-600)]" role="alert">{error}</p>}
    </div>
  );
}
