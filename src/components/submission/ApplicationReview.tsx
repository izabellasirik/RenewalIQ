import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { MappedApplication } from '../../types';
import { Button } from '../ui';

/**
 * "Download Application": the exact PDF the download produces, shown first so the broker can check it
 * before printing — just the preview and the Download Application button.
 */
export function ApplicationReview({
  application,
  accountName,
  title,
  downloading,
  onDownload,
}: {
  application: MappedApplication;
  /** Passed to the PDF generator exactly as the download does. */
  accountName: string;
  title: string;
  downloading: boolean;
  onDownload: () => void;
}) {
  const pdf = useApplicationPdf(application, accountName);

  return (
    <div className="flex flex-col gap-3" data-testid="application-review">
      <div className="flex justify-end">
        <Button icon={downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} onClick={onDownload} disabled={downloading} data-testid="review-download">
          Download Application
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)]" data-testid="review-pdf">
        {pdf.url ? (
          <iframe src={pdf.url} title={`${title} — PDF preview`} className="h-[85vh] w-full bg-white" data-testid="review-pdf-frame" />
        ) : pdf.error ? (
          <p className="px-4 py-6 text-sm text-[var(--color-danger-700)]">{pdf.error}</p>
        ) : (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--color-ink-500)]">
            <Loader2 size={15} className="animate-spin" /> Preparing the PDF…
          </p>
        )}
      </div>
    </div>
  );
}

/** The very PDF "Download Application" produces, as an object URL for the preview. */
function useApplicationPdf(application: MappedApplication, accountName: string) {
  const key = useMemo(() => JSON.stringify(application), [application]);
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState({ url: null, error: null });
    (async () => {
      try {
        const { generateApplicationPdf } = await import('../../services/application/exportApplication');
        const bytes = await generateApplicationPdf(application, accountName);
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        setState({ url, error: null });
      } catch (err) {
        if (!cancelled) setState({ url: null, error: err instanceof Error ? err.message : 'The PDF preview could not be prepared.' });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, accountName]);
  return state;
}
