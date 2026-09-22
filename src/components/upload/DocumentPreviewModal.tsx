import { useEffect, useRef, useState } from 'react';
import { Download, FileQuestion, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { UploadedDocument } from '../../types';
import { getLocalFile } from '../../services/documents/localFileStore';
import { downloadDocumentFile } from '../../services/supabase/submissionsRepo';

type Content =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; blob: Blob }
  | { kind: 'html'; html: string }
  | { kind: 'tables'; tables: { name?: string; headers: string[]; rows: string[][] }[] }
  | { kind: 'text'; text: string };

const MAX_TABLE_ROWS = 500;

/** The original bytes: this browser's copy first, then the broker's cloud account. */
async function loadBlob(doc: UploadedDocument): Promise<Blob | null> {
  const local = await getLocalFile(doc.id);
  if (local) return local.blob;
  if (doc.storagePath) {
    const res = await downloadDocumentFile(doc.storagePath);
    if (res.ok) return res.data;
  }
  return null;
}

async function render(doc: UploadedDocument, blob: Blob): Promise<Content> {
  const file = new File([blob], doc.name, { type: blob.type });
  switch (doc.fileType) {
    case 'image':
      return { kind: 'image', url: URL.createObjectURL(blob) };
    case 'pdf':
      return { kind: 'pdf', blob };
    case 'docx': {
      if (!doc.name.toLowerCase().endsWith('.docx')) break;
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      return { kind: 'html', html: value };
    }
    case 'xlsx': {
      if (doc.name.toLowerCase().endsWith('.xls')) break; // legacy binary .xls isn't readable by exceljs
      const { parseSpreadsheet } = await import('../../services/ingestion/parseSpreadsheet');
      const raw = await parseSpreadsheet(file);
      if (!raw.tables?.length) return { kind: 'error', message: raw.warnings[0] ?? 'This spreadsheet has no data to show.' };
      return { kind: 'tables', tables: raw.tables.map((t) => ({ name: t.sheetName, headers: t.headers, rows: t.rows })) };
    }
    case 'csv': {
      const { parseCsv } = await import('../../services/ingestion/parseCsv');
      const raw = await parseCsv(file);
      if (!raw.tables?.length) return { kind: 'text', text: raw.text };
      return { kind: 'tables', tables: raw.tables.map((t) => ({ headers: t.headers, rows: t.rows })) };
    }
    case 'txt':
      return { kind: 'text', text: await blob.text() };
  }
  return { kind: 'error', message: "This file type can't be previewed in RenewalIQ. Download it to open it." };
}

/** Renders every PDF page to a canvas with pdf.js — works the same in every browser and never triggers a download. */
function PdfPages({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The legacy build bundles polyfills (e.g. Map.prototype.getOrInsertComputed) that page
        // rendering needs and current Safari / older Chromium don't ship yet.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const container = ref.current;
        if (!container) return;
        container.innerHTML = '';
        const width = Math.min(container.clientWidth || 800, 1000);
        for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.className = 'mx-auto mb-3 block rounded bg-white shadow';
          container.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render this PDF.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) return <p className="p-6 text-center text-sm text-[var(--color-danger-600)]">{error}</p>;
  return <div ref={ref} className="min-h-40" />;
}

export function DocumentPreviewModal({ doc, onClose }: { doc: UploadedDocument | null; onClose: () => void }) {
  const [content, setContent] = useState<Content>({ kind: 'loading' });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setContent({ kind: 'loading' });
    setBlob(null);
    setSheet(0);
    (async () => {
      const b = await loadBlob(doc);
      if (cancelled) return;
      if (!b) {
        // Photos always have a small preview copy even when the original isn't available.
        if (doc.previewDataUrl) return setContent({ kind: 'image', url: doc.previewDataUrl });
        return setContent({
          kind: 'error',
          message: "The original file isn't available on this device. Files uploaded before previews were added weren't kept — re-upload it to preview.",
        });
      }
      setBlob(b);
      try {
        const c = await render(doc, b);
        if (c.kind === 'image' && c.url.startsWith('blob:')) objectUrl = c.url;
        if (!cancelled) setContent(c);
      } catch (err) {
        if (!cancelled) setContent({ kind: 'error', message: err instanceof Error ? err.message : 'Could not preview this file.' });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  function download() {
    if (!blob || !doc) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <AnimatePresence>
      {doc && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-[var(--color-ink-950)]/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
            <motion.div
              className="pointer-events-auto flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              role="dialog"
              aria-modal="true"
              aria-label={`Preview ${doc.name}`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-100)] px-4 py-3">
                <p className="min-w-0 truncate text-sm font-medium text-[var(--color-ink-800)]">{doc.name}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {blob && (
                    <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-600)] hover:bg-[var(--color-ink-100)] cursor-pointer">
                      <Download size={14} /> Download
                    </button>
                  )}
                  <button onClick={onClose} className="rounded-full p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Close preview">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {content.kind === 'tables' && content.tables.length > 1 && (
                <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-ink-100)] px-3 pt-2">
                  {content.tables.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => setSheet(i)}
                      className={`shrink-0 rounded-t-md px-3 py-1.5 text-xs font-medium cursor-pointer ${i === sheet ? 'bg-[var(--color-ink-100)] text-[var(--color-ink-900)]' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]'}`}
                    >
                      {t.name || `Sheet ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-auto bg-[var(--color-ink-50)] scrollbar-thin">
                {content.kind === 'loading' && (
                  <div className="flex h-full min-h-60 items-center justify-center gap-2 text-sm text-[var(--color-ink-500)]">
                    <Loader2 size={16} className="animate-spin" /> Loading preview…
                  </div>
                )}
                {content.kind === 'error' && (
                  <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 px-6 text-center">
                    <FileQuestion size={26} className="text-[var(--color-ink-400)]" />
                    <p className="max-w-md text-sm text-[var(--color-ink-600)]">{content.message}</p>
                  </div>
                )}
                {content.kind === 'image' && <img src={content.url} alt={doc.name} className="mx-auto block max-w-full p-4" />}
                {content.kind === 'pdf' && (
                  <div className="p-3 sm:p-4">
                    <PdfPages blob={content.blob} />
                  </div>
                )}
                {content.kind === 'html' && (
                  // Sandboxed with no permissions: the converted document can't run script or navigate.
                  <iframe
                    title={doc.name}
                    sandbox=""
                    className="h-full min-h-[70vh] w-full bg-white"
                    srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:14px/1.55 -apple-system,system-ui,sans-serif;color:#111a2c;max-width:820px;margin:24px auto;padding:0 20px}table{border-collapse:collapse}td,th{border:1px solid #ccd3e3;padding:4px 8px;vertical-align:top}img{max-width:100%}</style>${content.html}`}
                  />
                )}
                {content.kind === 'text' && <pre className="whitespace-pre-wrap break-words bg-white p-5 font-mono text-xs text-[var(--color-ink-800)]">{content.text}</pre>}
                {content.kind === 'tables' && <TableView table={content.tables[Math.min(sheet, content.tables.length - 1)]} />}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function TableView({ table }: { table: { headers: string[]; rows: string[][] } }) {
  const rows = table.rows.slice(0, MAX_TABLE_ROWS);
  return (
    <div className="bg-white">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-[var(--color-ink-100)]">
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} className="whitespace-nowrap border border-[var(--color-ink-200)] px-2 py-1.5 text-left font-semibold text-[var(--color-ink-800)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-white even:bg-[var(--color-ink-50)]">
              {table.headers.map((_, ci) => (
                <td key={ci} className="whitespace-nowrap border border-[var(--color-ink-100)] px-2 py-1 text-[var(--color-ink-700)]">
                  {r[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > MAX_TABLE_ROWS && <p className="p-3 text-xs text-[var(--color-ink-500)]">Showing the first {MAX_TABLE_ROWS} of {table.rows.length} rows — download for the full file.</p>}
    </div>
  );
}
