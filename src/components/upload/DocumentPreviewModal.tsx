import { useEffect, useRef, useState } from 'react';
import { Download, FileQuestion, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { UploadedDocument } from '../../types';
import type { RawDocument } from '../../services/ingestion/types';
import { loadStoredFile, saveBlobAs } from '../../services/documents/fileAccess';
import type { OcrWordLine } from '../../services/ingestion/ocr';
import { renderOcrTextLayer } from './ocrTextLayer';
import { fileSha256 } from '../../services/ingestion/aiReadContext';
import { placeTranscript, savedTranscript, transcribePhoto, transcriptUnavailableReason, TRANSCRIPT_UNAVAILABLE_MESSAGES } from '../../services/ingestion/visionTranscript';
import { useAccountsStore } from '../../state/useAccountsStore';

type Content =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; blob: Blob }
  | { kind: 'html'; html: string }
  | { kind: 'tables'; tables: { name?: string; headers: string[]; rows: string[][] }[] }
  | { kind: 'text'; text: string };

const MAX_TABLE_ROWS = 500;

/** What the viewer needs — an uploaded document, or a quote attachment shaped like one. `loadBlob` fetches files that live elsewhere (e.g. a client's intake upload). */
export type PreviewableFile = Pick<UploadedDocument, 'id' | 'name' | 'fileType' | 'storagePath' | 'previewDataUrl'> & { accountId?: string; loadBlob?: () => Promise<Blob | null> };

async function render(doc: PreviewableFile, blob: Blob): Promise<Content> {
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

/** How many pages carry their own (selectable) text — a scanned page has none. */
export interface PdfTextInfo {
  pages: number;
  pagesWithText: number;
}

/**
 * Renders every PDF page to a canvas with pdf.js — works the same in every browser and never
 * triggers a download — with pdf.js's text layer on top, so the PDF's own text can be selected and
 * copied exactly where it sits on the page.
 */
/** Scanned pages read by AI per preview, at most — beyond this they keep the on-device reading. */
const MAX_AI_PAGES = 25;
/** Long edge a scanned page is rendered at for the AI reader (its sweet spot for detailed text). */
const AI_PAGE_LONG_EDGE = 1568;

function PdfPages({
  blob,
  cacheKey,
  aiContext,
  onTextInfo,
  onOcr,
  onAi,
}: {
  blob: Blob;
  cacheKey: string;
  /** Who the AI reading is for (document/account) — the server reuses a page it already read. */
  aiContext?: { documentId?: string; accountId?: string };
  onTextInfo?: (info: PdfTextInfo) => void;
  onOcr?: (state: OcrState) => void;
  /** The AI reading of the scanned pages, as it progresses. */
  onAi?: (reading: AiReading) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    // Each render draws into its own holder and only a live one is shown — a stale run (React
    // re-running this effect, or a new file) can never clear or mix into the pages on screen.
    const holder = document.createElement('div');
    (async () => {
      try {
        // The legacy build bundles polyfills (e.g. Map.prototype.getOrInsertComputed) that page
        // rendering needs and current Safari / older Chromium don't ship yet.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const loading = pdfjs.getDocument({ data: await blob.arrayBuffer() });
        task = loading;
        const pdf = await loading.promise;
        const container = ref.current;
        if (!container || cancelled) return;
        container.replaceChildren(holder);
        const width = Math.min(container.clientWidth || 800, 1000);
        let pagesWithText = 0;
        // Scanned pages (no text of their own): OCR'd after all pages are on screen, so their text is selectable too.
        const scanned: { pageDiv: HTMLDivElement; canvas: HTMLCanvasElement; width: number; height: number; number: number; page: Awaited<ReturnType<typeof pdf.getPage>>; ocr?: { lines: OcrWordLine[]; ocrWidth: number } }[] = [];
        for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const cssScale = width / base.width;
          const cssViewport = page.getViewport({ scale: cssScale });
          const viewport = page.getViewport({ scale: cssScale * (window.devicePixelRatio || 1) });
          const pageDiv = document.createElement('div');
          pageDiv.className = 'pdf-page mx-auto mb-3 rounded bg-white shadow';
          pageDiv.style.width = `${cssViewport.width}px`;
          pageDiv.style.height = `${cssViewport.height}px`;
          pageDiv.dataset.page = String(i);
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${cssViewport.width}px`;
          canvas.style.height = `${cssViewport.height}px`;
          canvas.className = 'block rounded';
          pageDiv.appendChild(canvas);
          holder.appendChild(pageDiv);
          await page.render({ canvas, viewport }).promise;
          // The page's own text, invisible but selectable, laid exactly over the drawing.
          const text = await page.getTextContent();
          if (text.items.some((it) => 'str' in it && it.str.trim())) {
            pagesWithText++;
            const layer = document.createElement('div');
            layer.className = 'textLayer';
            layer.style.setProperty('--total-scale-factor', String(cssScale));
            pageDiv.appendChild(layer);
            await new pdfjs.TextLayer({ textContentSource: text, container: layer, viewport: cssViewport }).render();
          } else {
            pageDiv.style.setProperty('--total-scale-factor', String(cssScale));
            scanned.push({ pageDiv, canvas, width: base.width, height: base.height, number: i, page });
          }
        }
        if (!cancelled) onTextInfo?.({ pages: pdf.numPages, pagesWithText });
        if (!cancelled && scanned.length) {
          // Scanned pages show only the AI reading. The on-device reading runs unseen, purely so each
          // AI line can be laid exactly over its printed words (see placeTranscript).
          onOcr?.('ai-reading');
          const scannedNumbers = scanned.map((sp) => sp.number);
          onAi?.({ status: 'pending', scanned: scannedNumbers, pages: {} });
          const { openOcrSession, prepareForOcr } = await import('../../services/ingestion/ocr');
          const uid = useAccountsStore.getState().currentUserId;
          const aiPages: Record<number, string> = {};
          const session = await openOcrSession().catch(() => null);
          try {
            for (const sp of scanned.slice(0, MAX_AI_PAGES)) {
              if (cancelled) break;
              const key = `${cacheKey}:p${sp.number}`;
              const prepared = prepareForOcr(sp.canvas);
              const layout = session ? session.wordLines(prepared).then((lines) => ({ lines, ocrWidth: prepared.width })) : Promise.resolve(null);
              let lines = savedTranscript(key);
              if (!lines) {
                // Rendered fresh at the reader's preferred size (the on-screen canvas is smaller).
                const base = sp.page.getViewport({ scale: 1 });
                const vp = sp.page.getViewport({ scale: AI_PAGE_LONG_EDGE / Math.max(base.width, base.height) });
                const c = document.createElement('canvas');
                c.width = Math.round(vp.width);
                c.height = Math.round(vp.height);
                await sp.page.render({ canvas: c, viewport: vp }).promise;
                const pageBlob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
                lines = pageBlob ? await transcribePhoto(key, pageBlob, uid, { ...aiContext, sourceKind: 'scanned_pdf_page', page: sp.number, sourceHash: await fileSha256(blob) }) : null;
              }
              const ocr = await within(layout, 8000);
              if (cancelled || !lines) continue;
              const placed = placeTranscript(lines, { width: sp.width, height: sp.height }, ocr ?? undefined);
              sp.pageDiv.querySelectorAll('.textLayer').forEach((n) => n.remove());
              await renderOcrTextLayer(sp.pageDiv, placed, { width: sp.width, height: sp.height }, sp.width);
              aiPages[sp.number] = lines.map((l) => l.text).join('\n');
              onAi?.({ status: 'pending', scanned: scannedNumbers, pages: { ...aiPages } });
            }
          } finally {
            await session?.close();
          }
          if (cancelled) return;
          const any = Object.keys(aiPages).length > 0;
          onAi?.({ status: any ? 'done' : 'failed', scanned: scannedNumbers, pages: { ...aiPages } });
          onOcr?.(any ? 'ready-ai' : 'ai-failed');
        }
      } catch (err) {
        if (cancelled) return;
        // Pages already on screen stay; only the selectable-text step failed.
        if (holder.childElementCount) onOcr?.('error');
        else setError(err instanceof Error ? err.message : 'Could not render this PDF.');
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, cacheKey]);

  if (error) return <p className="p-6 text-center text-sm text-[var(--color-danger-600)]">{error}</p>;
  return <div ref={ref} className="min-h-40" data-testid="pdf-pages" />;
}

export type OcrState = 'reading' | 'ready' | 'ai-reading' | 'ready-ai' | 'ai-failed' | 'none' | 'error';

/** The AI reading of a photo or of a PDF's scanned pages, shared by the document view and the Extracted text panel. */
export interface AiReading {
  status: 'pending' | 'done' | 'failed';
  /** A photo's text, line by line. */
  imageText?: string;
  /** Scanned PDF pages read so far (page number → text). */
  pages?: Record<number, string>;
  /** Which PDF pages are scanned (their text comes only from the AI reading). */
  scanned?: number[];
}

/** Waits for a promise at most `ms`, then gives up (null) — the AI reading never waits long on the layout helper. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** OCR word boxes for a photo, cached per document for this session (reading takes a few seconds). */
const imageWordsCache = new Map<string, Promise<{ page: { width: number; height: number }; ocrWidth: number; lines: OcrWordLine[] }>>();

function readImageWords(key: string, blob: Blob) {
  let job = imageWordsCache.get(key);
  if (!job) {
    job = (async () => {
      const { openOcrSession, prepareForOcr } = await import('../../services/ingestion/ocr');
      // The same orientation the <img> shows (EXIF applied).
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const page = { width: bitmap.width, height: bitmap.height };
      const canvas = prepareForOcr(bitmap);
      bitmap.close();
      const session = await openOcrSession();
      try {
        return { page, ocrWidth: canvas.width, lines: await session.wordLines(canvas) };
      } finally {
        await session.close();
      }
    })();
    imageWordsCache.set(key, job);
    job.catch(() => imageWordsCache.delete(key));
  }
  return job;
}

async function imageSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** A photo with its text laid invisibly over it (AI reading when available, else on-device OCR), so the text can be selected right on the image. */
function SelectableImage({ url, name, blob, cacheKey, aiContext, onOcr, onAi }: { url: string; name: string; blob: Blob | null; cacheKey: string; aiContext?: { documentId?: string; accountId?: string }; onOcr: (s: OcrState) => void; onAi: (r: AiReading) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const page = useRef<{ width: number; height: number } | null>(null);

  // The layer is laid out in image pixels; this keeps it matched to the image's displayed size.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => page.current && el.style.setProperty('--total-scale-factor', String(el.clientWidth / page.current.width));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    onOcr('ai-reading');
    onAi({ status: 'pending' });
    // Only the AI reading is shown. The on-device reading runs alongside, unseen, purely so each AI
    // line can be laid exactly over its printed words (see placeTranscript).
    const ai = fileSha256(blob).then((sourceHash) => transcribePhoto(cacheKey, blob, useAccountsStore.getState().currentUserId, { ...aiContext, sourceKind: 'photo', ...(sourceHash ? { sourceHash } : {}) }));
    const layout = readImageWords(cacheKey, blob);
    (async () => {
      const lines = await ai;
      if (cancelled) return;
      if (!lines) {
        onAi({ status: 'failed' });
        onOcr('ai-failed');
        return;
      }
      const ocr = await within(layout, 6000);
      const el = wrap.current;
      if (cancelled || !el) return;
      const pageSize = ocr?.page ?? (await imageSize(blob));
      page.current = pageSize;
      el.style.setProperty('--total-scale-factor', String(el.clientWidth / pageSize.width));
      el.querySelectorAll('.textLayer').forEach((n) => n.remove());
      const n = await renderOcrTextLayer(el, placeTranscript(lines, pageSize, ocr ? { lines: ocr.lines, ocrWidth: ocr.ocrWidth } : undefined), pageSize, pageSize.width);
      if (cancelled) return;
      onAi({ status: 'done', imageText: lines.map((l) => l.text).join('\n') });
      onOcr(n ? 'ready-ai' : 'none');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, cacheKey]);

  return (
    <div className="p-4">
      <div ref={wrap} className="pdf-page mx-auto w-fit max-w-full" data-testid="selectable-image">
        <img src={url} alt={name} className="block max-w-full select-none" draggable={false} />
      </div>
    </div>
  );
}

/** Text read for viewing only, cached per document for this session. */
const readTextCache = new Map<string, Promise<RawDocument>>();

/**
 * "Extracted text": what the local reader (PDF text + OCR, no AI) reads from the file, shown so the
 * broker can select and copy it. For viewing only — it is never applied to the Risk Profile, never
 * passes through extraction, and is labelled as an OCR read that may contain mistakes.
 */
function ExtractedTextPanel({ doc, blob, ai }: { doc: PreviewableFile; blob: Blob; ai: AiReading | null }) {
  // A PDF's own text, for its pages that have some; scanned pages and photos show only the AI reading.
  const [state, setState] = useState<{ kind: 'reading' } | { kind: 'done'; raw: RawDocument } | { kind: 'error'; message: string }>({ kind: 'reading' });
  const isPdf = doc.fileType === 'pdf';

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    setState({ kind: 'reading' });
    const key = `${doc.id}:${blob.size}`;
    let job = readTextCache.get(key);
    if (!job) {
      const file = new File([blob], doc.name, { type: blob.type });
      job = (async () => (await import('../../services/ingestion/parsePdf')).parsePdf(file))();
      readTextCache.set(key, job);
      job.catch(() => readTextCache.delete(key));
    }
    job.then(
      (raw) => !cancelled && setState({ kind: 'done', raw }),
      (err) => !cancelled && setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read text from this file.' })
    );
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.name, isPdf, blob]);

  const pending = !ai || ai.status === 'pending';
  const failed = ai?.status === 'failed';
  let pages: { pageNumber: number; text: string }[] = [];
  let text = '';
  if (!isPdf) {
    text = ai?.imageText?.trim() ?? '';
  } else {
    const scanned = new Set(ai?.scanned ?? []);
    const byNumber = new Map<number, string>();
    if (state.kind === 'done') for (const p of state.raw.pages ?? []) if (!scanned.has(p.pageNumber) && p.text.trim()) byNumber.set(p.pageNumber, p.text);
    for (const [n, t] of Object.entries(ai?.pages ?? {})) byNumber.set(Number(n), t);
    pages = [...byNumber.entries()].sort((x, y) => x[0] - y[0]).map(([pageNumber, t]) => ({ pageNumber, text: t }));
    text = pages.map((p) => p.text).join('\n\n');
  }
  const reason = transcriptUnavailableReason();

  return (
    <section className="flex min-h-0 flex-col bg-white" aria-label="Extracted text" data-testid="extracted-text-panel">
      <div className="border-b border-[var(--color-ink-100)] px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-600)]">
          Extracted text
          <span className="rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[var(--color-warning-600)]" data-testid="text-source">
            AI reading · not verified
          </span>
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-500)]">
          Read by AI from the original — it can contain mistakes. Check it against the document. Copying it doesn’t add anything to the Risk Profile.
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 scrollbar-thin">
        {pending && (
          <p className="mb-3 flex items-center gap-2 text-sm text-[var(--color-ink-500)]" data-testid="ai-reading-pending">
            <Loader2 size={14} className="animate-spin" /> Reading the text with AI… (a few seconds)
          </p>
        )}
        {failed && (
          <p className="mb-3 text-sm text-[var(--color-warning-600)]" data-testid="ai-reading-failed">
            {reason ? TRANSCRIPT_UNAVAILABLE_MESSAGES[reason] : 'The AI reading didn’t work this time.'} Use “Try again” above the document.
          </p>
        )}
        {state.kind === 'error' && isPdf && <p className="text-sm text-[var(--color-danger-600)]">{state.message}</p>}
        {!pending && !failed && !text && (
          <p className="text-sm text-[var(--color-ink-500)]" data-testid="no-extracted-text">
            No text could be read from this document. Use the original on the left.
          </p>
        )}
        {text && (
          <div className="select-text whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-ink-800)]" data-testid="extracted-text">
            {pages.length > 1
              ? pages.map((p) => (
                  <div key={p.pageNumber} className="mb-4">
                    <p className="mb-1 select-none font-sans text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Page {p.pageNumber}</p>
                    {p.text}
                  </div>
                ))
              : text}
          </div>
        )}
      </div>
    </section>
  );
}

export function DocumentPreviewModal({ doc, onClose }: { doc: PreviewableFile | null; onClose: () => void }) {
  const [content, setContent] = useState<Content>({ kind: 'loading' });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sheet, setSheet] = useState(0);
  const [pdfText, setPdfText] = useState<PdfTextInfo | null>(null);
  const [ocr, setOcr] = useState<OcrState | null>(null);
  const [ai, setAi] = useState<AiReading | null>(null);
  /** Bumped by "Try again" to read the document once more. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setContent({ kind: 'loading' });
    setBlob(null);
    setSheet(0);
    setPdfText(null);
    setOcr(null);
    setAi(null);
    setAttempt(0);
    (async () => {
      const b = doc.loadBlob ? await doc.loadBlob() : await loadStoredFile(doc);
      if (cancelled) return;
      if (!b) {
        // Photos always have a small preview copy even when the original isn't available.
        if (doc.previewDataUrl) {
          setContent({ kind: 'image', url: doc.previewDataUrl });
          // The small preview copy can still be read for the Extracted text panel.
          const copy = await fetch(doc.previewDataUrl).then((r) => r.blob()).catch(() => null);
          if (!cancelled && copy) setBlob(copy);
          return;
        }
        return setContent({
          kind: 'error',
          message: doc.storagePath
            ? "Couldn't load this file from your account — check that you're signed in, then try again."
            : "The original file isn't available on this device. Files uploaded before previews were added weren't kept, and this one isn't in your cloud account — re-upload it to preview.",
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
    saveBlobAs(blob, doc.name);
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

              {(() => {
                // Images, and PDFs with pages that carry no text of their own (scans), get the
                // Extracted text panel; a PDF's own text is selectable right on the page.
                const showText = !!blob && ((content.kind === 'image' && doc.fileType === 'image') || (content.kind === 'pdf' && !!pdfText && pdfText.pagesWithText < pdfText.pages));
                const original = (
                  <div className="flex-1 overflow-auto bg-[var(--color-ink-50)] scrollbar-thin" data-testid="original-document">
                    {showText && <p className="sticky top-0 z-10 border-b border-[var(--color-ink-100)] bg-white/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-600)]">Original document</p>}
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
                {ocr && (
                  <p className="flex items-center gap-1.5 border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)] px-4 py-1.5 text-xs text-[var(--color-ink-600)]" data-testid="ocr-select-status">
                    {ocr === 'reading' && (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Making the text on this document selectable…
                      </>
                    )}
                    {ocr === 'ai-reading' && (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Reading the text with AI…
                      </>
                    )}
                    {ocr === 'ready-ai' && 'Drag across the text on the document to select it, then copy (Ctrl/⌘ + C). Read by AI — check it against the original.'}
                    {ocr === 'ai-failed' && (
                      <span className="flex flex-wrap items-center gap-2" data-testid="ai-unavailable">
                        <span className="font-medium text-[var(--color-warning-600)]">
                          {(transcriptUnavailableReason() ? TRANSCRIPT_UNAVAILABLE_MESSAGES[transcriptUnavailableReason()!] : 'The AI reading didn’t work this time.')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setOcr(null);
                            setAi(null);
                            setAttempt((n) => n + 1);
                          }}
                          className="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-0.5 font-medium text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)] cursor-pointer"
                        >
                          Try again
                        </button>
                      </span>
                    )}
                    {ocr === 'none' && 'No text could be read on this document to select.'}
                    {ocr === 'error' && 'Couldn’t make the text on this document selectable.'}
                  </p>
                )}
                {content.kind === 'image' && <SelectableImage key={attempt} url={content.url} name={doc.name} blob={blob} cacheKey={`${doc.id}:${blob?.size ?? 0}`} aiContext={{ documentId: doc.id, accountId: doc.accountId }} onOcr={setOcr} onAi={setAi} />}
                {content.kind === 'pdf' && (
                  <div className="p-3 sm:p-4">
                    <PdfPages key={attempt} blob={content.blob} cacheKey={`${doc.id}:${content.blob.size}`} aiContext={{ documentId: doc.id, accountId: doc.accountId }} onTextInfo={setPdfText} onOcr={setOcr} onAi={setAi} />
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
                );
                // Same tree whether or not the panel shows, so the document isn't re-rendered when it appears.
                return (
                  <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                    <div className={`flex min-h-0 flex-1 flex-col ${showText ? 'lg:border-r lg:border-[var(--color-ink-100)]' : ''}`}>{original}</div>
                    {showText && (
                      <div className="flex max-h-[45%] min-h-0 flex-col border-t border-[var(--color-ink-100)] lg:max-h-none lg:w-[380px] lg:border-t-0">
                        <ExtractedTextPanel doc={doc} blob={blob!} ai={ai} />
                      </div>
                    )}
                  </div>
                );
              })()}
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
