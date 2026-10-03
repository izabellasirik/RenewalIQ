// Legacy build: same API, plus polyfills for JS features newer than current Safari / older Chromium.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { RawDocument, RawDocumentPage } from './types';
import { buildLines, lineTexts, type LayoutLine, type PdfTextPiece } from './pdfLayout';
import { ocrCanvases, prepareForOcr } from './ocr';

/** Scanned pages OCR'd per document (OCR is the fallback when the AI can't read them) — each takes a few seconds in the browser. */
export const MAX_SCANNED_PAGES = 25;
/** Render scale for OCR: a letter page at ~200 DPI. */
const OCR_RENDER_LONG_EDGE = 2200;
/** Below this mean confidence a scanned page's text isn't trusted. */
const UNREADABLE_CONFIDENCE = 35;
/** A page whose own text has fewer letters/digits than this (a stamped page number, a fax header) is a scan. */
const MIN_NATIVE_CHARS = 25;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsePdfOptions {
  /** OCR the scanned pages now (default true). False: only list them — the AI reads them first (readDocument.ts) and OCR runs only for pages it couldn't. */
  ocrScannedPages?: boolean;
}

/**
 * Extracts embedded text from a PDF, page by page, keeping where each piece of text sits (see
 * pdfLayout.ts) so tables — driver lists, vehicle schedules, loss runs — can be read by column.
 * A page with no usable embedded text (a scan — common for loss runs and MVRs) is listed in
 * `scannedPages`; with OCR on it is also rendered and OCR'd in the browser, with word positions.
 */
export async function parsePdf(file: File, options: ParsePdfOptions = {}): Promise<RawDocument> {
  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();

  const pages: RawDocumentPage[] = [];
  const layout: LayoutLine[] = [];
  const scannedPages: number[] = [];
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pieces: PdfTextPiece[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const [a, b, , d, x, y] = item.transform as number[];
        pieces.push({ str: item.str, x, y, width: item.width, height: item.height || Math.hypot(a, b) || Math.abs(d) || 10 });
      }
      const lines = buildLines(pieces, i);
      const text = lines.flatMap(lineTexts).join('\n');
      if (text.replace(/[^A-Za-z0-9]/g, '').length < MIN_NATIVE_CHARS) {
        scannedPages.push(i);
        pages.push({ pageNumber: i, text: '' });
        continue;
      }
      layout.push(...lines);
      pages.push({ pageNumber: i, text });
    }
    void pdf.cleanup();
  } catch (err) {
    warnings.push(`Could not read this PDF: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'pdf', text: '', pages: [], warnings };
  }

  let raw: RawDocument = { documentName: file.name, fileType: 'pdf', text: '', pages, layout, warnings, ...(scannedPages.length ? { scannedPages } : {}) };
  if (scannedPages.length > 0 && options.ocrScannedPages !== false) {
    raw = await ocrPdfPages(file, raw, scannedPages.slice(0, MAX_SCANNED_PAGES));
    if (scannedPages.length > MAX_SCANNED_PAGES) raw.warnings.push(`Only the first ${MAX_SCANNED_PAGES} scanned pages were read; ${scannedPages.length - MAX_SCANNED_PAGES} more were not.`);
  }
  raw.text = raw.pages!.map((p) => p.text).join('\n');
  if (raw.text.trim().length === 0 && !raw.warnings.length && !(scannedPages.length && options.ocrScannedPages === false)) {
    raw.warnings.push('No text could be read from this PDF.');
  }
  return raw;
}

/** OCRs the given scanned pages in the browser and adds their text and layout to `raw` (returns a new RawDocument). */
export async function ocrPdfPages(file: File, raw: RawDocument, pageNumbers: number[]): Promise<RawDocument> {
  const pages = [...(raw.pages ?? [])];
  const layout = [...(raw.layout ?? [])];
  const warnings = [...raw.warnings];
  let ocrConfidence: number | undefined;
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const scanned: { pageNumber: number; canvas: HTMLCanvasElement }[] = [];
    for (const n of pageNumbers) scanned.push({ pageNumber: n, canvas: await renderPage(await pdf.getPage(n)) });
    void pdf.cleanup();
    const results = await ocrCanvases(scanned.map((s) => prepareForOcr(s.canvas)));
    const readable = results.filter((r) => r.confidence >= UNREADABLE_CONFIDENCE);
    results.forEach((r, k) => {
      if (r.confidence < UNREADABLE_CONFIDENCE) return;
      const pageNumber = scanned[k].pageNumber;
      const lines = buildLines(r.pieces, pageNumber);
      layout.push(...lines);
      const idx = pages.findIndex((p) => p.pageNumber === pageNumber);
      const page = { pageNumber, text: lines.flatMap(lineTexts).join('\n') };
      if (idx >= 0) pages[idx] = page;
      else pages.push(page);
    });
    layout.sort((x, y) => x.page - y.page); // keep reading order (stable within a page)
    if (readable.length) ocrConfidence = readable.reduce((t, r) => t + r.confidence, 0) / readable.length;
    if (readable.length < results.length) warnings.push(`${results.length - readable.length} scanned page${results.length - readable.length === 1 ? ' was' : 's were'} too unclear to read — check them against the file.`);
    else if (ocrConfidence !== undefined && ocrConfidence < 60) warnings.push('This PDF is a scan and was only partly readable — double-check what was read against the file.');
  } catch (err) {
    warnings.push(`This PDF is a scan and could not be read (${err instanceof Error ? err.message : 'text recognition failed'}).`);
  }
  return {
    ...raw,
    pages,
    layout,
    warnings,
    text: pages.map((p) => p.text).join('\n'),
    ...(ocrConfidence !== undefined ? { ocrConfidence } : {}),
  };
}

/** Long edge of a page image sent to the AI reader — the same size photos are sent at. */
const VISION_PAGE_LONG_EDGE = 1568;

/**
 * Renders the given pages as JPEGs for the AI reader (see readDocument.ts). Pages that can't be
 * rendered are left out — the caller treats a missing page as unread.
 */
export async function renderPdfPagesForVision(file: File, pageNumbers: number[]): Promise<{ page: number; base64: string }[]> {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: { page: number; base64: string }[] = [];
  for (const n of pageNumbers) {
    try {
      const canvas = await renderPage(await pdf.getPage(n), VISION_PAGE_LONG_EDGE);
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      canvas.width = canvas.height = 0;
      if (base64) out.push({ page: n, base64 });
    } catch {
      // unreadable page: skipped
    }
  }
  void pdf.cleanup();
  return out;
}

/** Renders a PDF page to a canvas — by default at roughly 200 DPI for OCR. */
async function renderPage(page: pdfjsLib.PDFPageProxy, longEdge = OCR_RENDER_LONG_EDGE): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, longEdge / Math.max(base.width, base.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not render the scanned page.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}
