// Legacy build: same API, plus polyfills for JS features newer than current Safari / older Chromium.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { RawDocument, RawDocumentPage } from './types';
import { buildLines, lineTexts, type LayoutLine, type PdfTextPiece } from './pdfLayout';
import { ocrCanvases, prepareForOcr } from './ocr';

/** Scanned pages OCR'd per document — each takes a few seconds in the browser. */
const MAX_OCR_PAGES = 15;
/** Render scale for OCR: a letter page at ~200 DPI. */
const OCR_RENDER_LONG_EDGE = 2200;
/** Below this mean confidence a scanned page's text isn't trusted. */
const UNREADABLE_CONFIDENCE = 35;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Extracts embedded text from a PDF, page by page, keeping where each piece of text sits (see
 * pdfLayout.ts) so tables — driver lists, vehicle schedules, loss runs — can be read by column.
 * A scanned page (no embedded text — common for loss runs and MVRs) is rendered and OCR'd in the
 * browser, with word positions, so the same table reading applies.
 */
export async function parsePdf(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();

  const pages: RawDocumentPage[] = [];
  const layout: LayoutLine[] = [];
  let ocrConfidence: number | undefined;
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const scanned: { pageNumber: number; canvas: HTMLCanvasElement }[] = [];
    let skippedScans = 0;
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
      if (lines.length === 0) {
        if (scanned.length < MAX_OCR_PAGES) scanned.push({ pageNumber: i, canvas: await renderPage(page) });
        else skippedScans++;
        pages.push({ pageNumber: i, text: '' });
        continue;
      }
      layout.push(...lines);
      pages.push({ pageNumber: i, text: lines.flatMap(lineTexts).join('\n') });
    }

    if (scanned.length > 0) {
      try {
        const results = await ocrCanvases(scanned.map((s) => prepareForOcr(s.canvas)));
        const readable = results.filter((r) => r.confidence >= UNREADABLE_CONFIDENCE);
        results.forEach((r, k) => {
          if (r.confidence < UNREADABLE_CONFIDENCE) return;
          const pageNumber = scanned[k].pageNumber;
          const lines = buildLines(r.pieces, pageNumber);
          layout.push(...lines);
          pages[pageNumber - 1] = { pageNumber, text: lines.flatMap(lineTexts).join('\n') };
        });
        layout.sort((x, y) => x.page - y.page); // keep reading order (stable within a page)
        if (readable.length) ocrConfidence = readable.reduce((t, r) => t + r.confidence, 0) / readable.length;
        if (readable.length < results.length) warnings.push(`${results.length - readable.length} scanned page${results.length - readable.length === 1 ? ' was' : 's were'} too unclear to read — check them against the file.`);
        else if (ocrConfidence !== undefined && ocrConfidence < 60) warnings.push('This PDF is a scan and was only partly readable — double-check what was read against the file.');
      } catch (err) {
        warnings.push(`This PDF is a scan and could not be read (${err instanceof Error ? err.message : 'text recognition failed'}).`);
      }
      if (skippedScans > 0) warnings.push(`Only the first ${MAX_OCR_PAGES} scanned pages were read; ${skippedScans} more were not.`);
    }
  } catch (err) {
    warnings.push(`Could not read this PDF: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'pdf', text: '', pages: [], warnings };
  }

  const text = pages.map((p) => p.text).join('\n');
  if (text.trim().length === 0 && !warnings.length) {
    warnings.push('No text could be read from this PDF.');
  }

  return { documentName: file.name, fileType: 'pdf', text, pages, layout, warnings, ...(ocrConfidence !== undefined ? { ocrConfidence } : {}) };
}

/** Renders a PDF page to a canvas at roughly 200 DPI for OCR. */
async function renderPage(page: pdfjsLib.PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, OCR_RENDER_LONG_EDGE / Math.max(base.width, base.height)) });
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
