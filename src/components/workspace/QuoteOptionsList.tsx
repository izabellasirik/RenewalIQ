import { useRef, useState } from 'react';
import { CheckCircle2, Download, Eye, FileText, Loader2, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import { quoteOptionFiles, type MarketQuote, type QuoteAttachment, type QuoteOption } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { DocumentPreviewModal, type PreviewableFile } from '../upload/DocumentPreviewModal';
import { loadStoredFile, saveBlobAs } from '../../services/documents/fileAccess';
import { formatShortDate, normalizeDateKey, parseDateKey } from '../../services/workflow/dates';
import { Button } from '../ui';
import { inputClass } from './formStyles';
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
  const removeQuoteAttachment = useAccountsStore((s) => s.removeQuoteAttachment);
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateQuoteOption = useAccountsStore((s) => s.updateQuoteOption);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ label: '', premium: '', date: '' });
  const selected = quote.selectedOptionId === option.id;
  const files = quoteOptionFiles(option).map((a: QuoteAttachment) => ({ id: a.id, name: a.name, fileType: a.fileType, storagePath: a.storagePath }));

  async function download(file: (typeof files)[number]) {
    setDownloading(file.id);
    setError(null);
    const blob = await loadStoredFile(file);
    setDownloading(null);
    if (blob) saveBlobAs(blob, file.name);
    else setError("File isn't on this device or in your account.");
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-dashed border-[var(--color-ink-200)] px-3 py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft.premium.replace(/[$,\s]/g, ''));
            updateQuoteOption(accountId, quote.id, option.id, {
              label: draft.label,
              premium: draft.premium.trim() === '' ? null : n,
              // Midday local time on the chosen date, so it reads as that date in any time zone nearby.
              receivedAt: draft.date && draft.date !== normalizeDateKey(option.receivedAt) ? new Date(parseDateKey(draft.date)!.setHours(12)).toISOString() : undefined,
            });
            setEditing(false);
          }}
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          <input value={draft.premium} onChange={(e) => setDraft({ ...draft, premium: e.target.value })} className={inputClass} placeholder="Premium" inputMode="decimal" aria-label="Quote premium" autoFocus />
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={inputClass} placeholder="Name (optional)" aria-label="Quote name" />
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputClass} aria-label="Quote date" />
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </li>
    );
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
          {files.length > 1 && <span>· {files.length} files</span>}
        </p>
        {files.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5" data-testid="quote-files">
            {files.map((file) => (
              <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-[var(--color-ink-600)]">
                <FileText size={11} className="shrink-0" />
                <span className="truncate">{file.name}</span>
                <button onClick={() => onPreview(file)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer" aria-label={`View ${file.name}`}>
                  <Eye size={11} /> View
                </button>
                <button onClick={() => download(file)} disabled={downloading === file.id} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer disabled:opacity-50" aria-label={`Download ${file.name}`}>
                  {downloading === file.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Download
                </button>
                <button onClick={() => removeQuoteAttachment(accountId, quote.id, option.id, file.id)} className="rounded-md p-0.5 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer" aria-label={`Remove ${file.name}`}>
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) attachQuoteFile(accountId, quote.id, option.id, f);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
          <Paperclip size={12} /> {files.length ? 'Attach more' : 'Attach files'}
        </button>
        <button
          onClick={() => {
            setDraft({ label: option.label ?? '', premium: option.premium ? String(option.premium) : '', date: normalizeDateKey(option.receivedAt) ?? '' });
            setEditing(true);
          }}
          className="rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer"
          aria-label="Edit quote"
        >
          <Pencil size={13} />
        </button>
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
