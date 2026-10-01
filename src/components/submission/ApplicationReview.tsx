import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleHelp, Download, EyeOff, FileText, ListChecks, Loader2, Printer, TriangleAlert } from 'lucide-react';
import type { MappedApplication } from '../../types';
import { buildApplicationPrintPlan, printedCellValue, type PlannedField } from '../../services/application/printPlan';
import { Button, Card, CardBody, CardHeader, ProgressBar } from '../ui';

const NOT_PRINTED: Record<NonNullable<PlannedField['omittedReason']>, string> = {
  missing: 'Not provided',
  conflict: 'Not printed — documents disagree; resolve it in the Risk Profile',
  placeholder: 'Not printed',
};

/**
 * "Review Application": the downloaded application, read-only, before it is downloaded. Built from
 * the same MappedApplication and the same print plan (services/application/printPlan.ts) the PDF
 * generator uses, so every value shown as printed is exactly what the PDF contains. Fields that
 * won't print are listed too, clearly marked, so nothing is a surprise; Needs Review values (which
 * DO print) are highlighted.
 */
export function ApplicationReview({
  application,
  accountName,
  title,
  completenessPercent,
  missingCount,
  needsReviewCount,
  conflictCount,
  downloading,
  onBack,
  onDownload,
}: {
  application: MappedApplication;
  /** Passed to the PDF generator exactly as the download does. */
  accountName: string;
  title: string;
  completenessPercent: number;
  missingCount: number;
  needsReviewCount: number;
  conflictCount: number;
  downloading: boolean;
  onBack: () => void;
  onDownload: () => void;
}) {
  const plan = buildApplicationPrintPlan(application);
  const printsAnything = plan.sections.some((s) => s.printed.length > 0) || plan.tables.some((t) => t.prints);
  const [view, setView] = useState<'pdf' | 'fields'>('pdf');
  const pdf = useApplicationPdf(application, accountName);
  const frameRef = useRef<HTMLIFrameElement>(null);

  function printPdf() {
    if (!pdf.url) return;
    try {
      const w = frameRef.current?.contentWindow;
      if (!w) throw new Error('no frame');
      w.focus();
      w.print();
    } catch {
      window.open(pdf.url, '_blank', 'noopener');
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="application-review">
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
              Back to Submission Assistant
            </Button>
            <h2 className="min-w-0 truncate text-base font-semibold text-[var(--color-ink-900)]" data-testid="review-title">
              {title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={<Printer size={15} />} onClick={printPdf} disabled={!pdf.url} data-testid="review-print">
              Print
            </Button>
            <Button icon={downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} onClick={onDownload} disabled={downloading} data-testid="review-download">
              Download Application
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <span className="font-semibold text-[var(--color-ink-900)]">{completenessPercent}% Complete</span>
          <div className="w-40">
            <ProgressBar value={completenessPercent} />
          </div>
          {missingCount > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-warning-600)]">
              <TriangleAlert size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{missingCount}</span> missing
            </span>
          )}
          {needsReviewCount > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-warning-600)]">
              <CircleHelp size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{needsReviewCount}</span> need review
            </span>
          )}
          {conflictCount > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-danger-600)]">
              <TriangleAlert size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{conflictCount}</span> conflict{conflictCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--color-ink-50)] p-1 text-sm w-fit" role="tablist">
          {(
            [
              ['pdf', 'PDF preview', <FileText key="i" size={14} />],
              ['fields', 'Field check', <ListChecks key="i" size={14} />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              data-testid={`review-tab-${key}`}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium cursor-pointer ${view === key ? 'bg-white text-[var(--color-ink-900)] shadow-sm' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]'}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-ink-500)]">
          The PDF preview is the exact file Print and Download produce — check it before printing. Field check lists every field: values marked <span className="font-medium text-[var(--color-warning-600)]">Needs review</span> will be printed as shown; fields marked{' '}
          <span className="italic">Not provided</span> are left off the PDF.
        </p>
      </div>

      {view === 'pdf' && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)]" data-testid="review-pdf">
          {pdf.url ? (
            <iframe ref={frameRef} src={pdf.url} title={`${title} — PDF preview`} className="h-[80vh] w-full bg-white" data-testid="review-pdf-frame" />
          ) : pdf.error ? (
            <p className="px-4 py-6 text-sm text-[var(--color-danger-700)]">{pdf.error}</p>
          ) : (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--color-ink-500)]">
              <Loader2 size={15} className="animate-spin" /> Preparing the PDF…
            </p>
          )}
        </div>
      )}

      {view === 'fields' && <>
      {!printsAnything && (
        <p className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/40 px-4 py-3 text-sm text-[var(--color-ink-800)]">
          Nothing has been documented yet — the downloaded application would contain only its title.
        </p>
      )}

      {plan.sections.map((section) => (
        <Card key={section.title} data-testid="review-section">
          <CardHeader className="pb-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{section.title}</h3>
              {section.printed.length === 0 && (
                <span className="flex items-center gap-1 text-xs text-[var(--color-ink-400)]">
                  <EyeOff size={12} /> Not on the application — nothing documented
                </span>
              )}
            </div>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-x-6 gap-y-3 pt-2 sm:grid-cols-2">
            {section.fields.map(({ field, prints, omittedReason }, i) => {
              const review = prints && field.status === 'needs_review';
              return (
                <div
                  key={`${field.targetFieldId}-${i}`}
                  className={`min-w-0 rounded-md px-2 py-1.5 ${review ? 'bg-[var(--color-warning-100)]/60 ring-1 ring-[var(--color-warning-100)]' : ''}`}
                  data-testid="review-field"
                  data-prints={prints ? 'yes' : 'no'}
                  data-status={field.status}
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{field.targetLabel}</p>
                  {prints ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-ink-900)]">{field.value}</p>
                  ) : (
                    <p className={`text-sm italic ${omittedReason === 'conflict' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-400)]'}`}>{NOT_PRINTED[omittedReason ?? 'missing']}</p>
                  )}
                  {review && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-[var(--color-warning-600)]" data-testid="needs-review-flag">
                      <CircleHelp size={12} /> Needs review{field.reviewReason ? ` — ${field.reviewReason}` : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ))}

      {plan.tables.map((table) => (
        <Card key={table.title} data-testid="review-table">
          <CardHeader className="pb-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">
                {table.title}
                {table.prints && <span className="ml-2 text-xs font-normal text-[var(--color-ink-500)]">{table.rows.length} listed</span>}
              </h3>
              {!table.prints && (
                <span className="flex items-center gap-1 text-xs text-[var(--color-ink-400)]">
                  <EyeOff size={12} /> Not on the application
                </span>
              )}
            </div>
          </CardHeader>
          <CardBody className="pt-2">
            {table.prints ? (
              <>
                {table.note && <p className="mb-2 text-sm font-semibold text-[var(--color-ink-900)]" data-testid="review-table-note">{table.note}</p>}
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c.key} className="border-b border-[var(--color-ink-100)] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={row.id} className="border-b border-[var(--color-ink-50)] last:border-0">
                          {table.columns.map((c) => {
                            const v = printedCellValue(row, c.key);
                            return (
                              <td key={c.key} className="px-2 py-1.5 align-top text-[var(--color-ink-900)]">
                                {v || <span className="italic text-[var(--color-ink-400)]">Not provided</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.omittedColumns.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                    Not documented for any row, so left off: {table.omittedColumns.map((c) => c.label).join(', ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm italic text-[var(--color-ink-400)]">Not documented — this section is left off the application.</p>
            )}
          </CardBody>
        </Card>
      ))}
      </>}
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
