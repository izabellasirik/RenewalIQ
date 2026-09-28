// Legacy build: same API, plus polyfills for JS features newer than current Safari / older Chromium.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { RawDocument, RawDocumentPage } from './types';
import { buildLines, lineTexts, type LayoutLine, type PdfTextPiece } from './pdfLayout';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Extracts embedded text from a text-based PDF, page by page, keeping where each piece of text sits
 * (see pdfLayout.ts) so tables — driver lists, vehicle schedules, loss runs — can be read by column.
 * Does not OCR scanned/image PDFs.
 */
export async function parsePdf(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();

  const pages: RawDocumentPage[] = [];
  const layout: LayoutLine[] = [];
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
      layout.push(...lines);
      pages.push({ pageNumber: i, text: lines.flatMap(lineTexts).join('\n') });
    }
  } catch (err) {
    warnings.push(`Could not read this PDF: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'pdf', text: '', pages: [], warnings };
  }

  const text = pages.map((p) => p.text).join('\n');
  if (text.trim().length === 0) {
    warnings.push('No extractable text found in this PDF — it may be a scanned image. OCR is not supported yet, so this document was not used for extraction.');
  }

  return { documentName: file.name, fileType: 'pdf', text, pages, layout, warnings };
}
