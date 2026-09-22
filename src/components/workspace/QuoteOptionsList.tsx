import { useRef, useState } from 'react';
import { CheckCircle2, Download, Eye, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import type { MarketQuote, QuoteOption } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { DocumentPreviewModal, type PreviewableFile } from '../upload/DocumentPreviewModal';
import { loadStoredFile, saveBlobAs } from '../../services/documents/fileAccess';
import { formatShortDate } from '../../services/workflow/dates';
import { cn } from '../../utils/cn';

/**
 * Every quote a market returned — premium, name, date, and the quote file — so the broker can
 * find and download the exact quote for the price the client picked. The chosen one sets the
 * market's headline premium.
 */
export function QuoteOptionsList({ accountId, quote }: { accountId: string; quote: MarketQuote }) {
  const options = quote.options ?? [];
  const [preview, setPreview] = useState<PreviewableFile | null>(null);
  if (options.length === 0) return null;
  const newestFirst = [...options].reverse();

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
        Quotes from {quote.marketName} ({options.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {newestFirst.map((o) => (
          <OptionRow key={o.id} accountId={accountId} quote={quote} option={o} onPreview={setPreview} />
        ))}
      </ul>
      <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function OptionRow({ accountId, quote, option, onPreview }: { accountId: string; quote: MarketQuote; option: QuoteOption; onPreview: (f: PreviewableFile) => void }) {
  const selectQuoteOption = useAccountsStore((s) => s.selectQuoteOption);
  const deleteQuoteOption = useAccountsStore((s) => s.deleteQuoteOption);
  const attachQuoteFile = useAccountsStore((s) => s.attachQuoteFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = quote.selectedOptionId === option.id;
  const file = option.attachment ? { id: option.attachment.id, name: option.attachment.name, fileType: option.attachment.fileType, storagePath: option.attachment.storagePath } : null;

  async function download() {
    if (!file) return;
    setDownloading(true);
    setError(null);
    const blob = await loadStoredFile(file);
    setDownloading(false);
    if (blob) saveBlobAs(blob, file.name);
    else setError("File isn't on this device or in your account.");
  }

  return (
    <li className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between', selected ? 'border-[var(--color-success-500)]/40 bg-[var(--color-success-100)]/40' : 'border-[var(--color-ink-100)]')}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-[var(--color-ink-900)]">{option.premium ? `$${option.premium.toLocaleString('en-US')}` : 'No premium'}</span>
          {option.label && <span className="text-[var(--color-ink-700)]">{option.label}</span>}
          {selected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-success-600)]">
              <CheckCircle2 size={11} /> Selected
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-ink-500)]">
          Received {formatShortDate(option.receivedAt)}
          {file && (
            <span className="inline-flex min-w-0 items-center gap-1">
              · <FileText size={11} className="shrink-0" />
              <span className="truncate">{file.name}</span>
            </span>
          )}
        </p>
        {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {file ? (
          <>
            <button onClick={() => onPreview(file)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
              <Eye size={12} /> View
            </button>
            <button onClick={download} disabled={downloading} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer disabled:opacity-50">
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download
            </button>
          </>
        ) : (
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && attachQuoteFile(accountId, quote.id, option.id, e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
              <Paperclip size={12} /> Attach file
            </button>
          </>
        )}
        {!selected && (
          <button onClick={() => selectQuoteOption(accountId, quote.id, option.id)} className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-600)] hover:bg-[var(--color-ink-100)] cursor-pointer">
            Select
          </button>
        )}
        <button onClick={() => deleteQuoteOption(accountId, quote.id, option.id)} className="rounded-md p-1.5 text-[var(--color-ink-300)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer" aria-label="Remove quote">
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}
