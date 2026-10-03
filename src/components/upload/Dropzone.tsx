import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link2, UploadCloud } from 'lucide-react';
import { cn } from '../../utils/cn';
import { linkAsFile } from '../../services/ingestion/documentLinks';

const LINK = /^https?:\/\/\S+$/i;

/** `allowLinkPaste={false}` hides the "paste a link" box (dropping a link still works). */
export function Dropzone({ onFiles, allowLinkPaste = true }: { onFiles: (files: File[]) => void; allowLinkPaste?: boolean }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) return onFiles(files);
    // A link dragged from a browser or email arrives as text, not a file — it used to be ignored.
    const dropped = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split(/\r?\n/).map((l) => l.trim()).find((l) => LINK.test(l));
    if (dropped) onFiles([linkAsFile(dropped)]);
  }

  function addLink(e: FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!LINK.test(url)) return;
    onFiles([linkAsFile(url)]);
    setLink('');
  }

  return (
    <div className="flex flex-col gap-2">
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
        isDragging
          ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]/5'
          : 'border-[var(--color-ink-200)] bg-white hover:border-[var(--color-ink-300)] hover:bg-[var(--color-ink-50)]'
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-800)]/8 text-[var(--color-brand-700)]">
        <UploadCloud size={22} />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-ink-800)]">
          Upload submission documents, spreadsheets, PDFs, or photos, or{' '}
          <span className="text-[var(--color-brand-700)] underline underline-offset-2">browse</span>
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-500)]">PDF, DOCX, XLSX/XLS, CSV, TXT, JPG, PNG, WEBP — questionnaires, loss runs, vehicle &amp; driver schedules, or photos of any of those</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png,.webp,.url,.webloc"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
      {/* The document is only a link? Renewal IQ opens it if it can, or says clearly that it can't. */}
      {allowLinkPaste && (
      <form onSubmit={addLink} className="flex items-center gap-2">
        <Link2 size={14} className="shrink-0 text-[var(--color-ink-400)]" />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Or paste a link to a document (https://…)"
          aria-label="Document link"
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)]"
        />
        <button type="submit" disabled={!LINK.test(link.trim())} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
          Add link
        </button>
      </form>
      )}
    </div>
  );
}
