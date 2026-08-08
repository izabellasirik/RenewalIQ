import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RawDocument, RawDocumentPage } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/** Extracts embedded text from a text-based PDF, page by page. Does not OCR scanned/image PDFs. */
export async function parsePdf(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();

  const pages: RawDocumentPage[] = [];
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        pageText += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push({ pageNumber: i, text: pageText });
    }
  } catch (err) {
    warnings.push(`Could not read this PDF: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'pdf', text: '', pages: [], warnings };
  }

  const text = pages.map((p) => p.text).join('\n');
  if (text.trim().length === 0) {
    warnings.push('No extractable text found in this PDF — it may be a scanned image. OCR is not supported yet, so this document was not used for extraction.');
  }

  return { documentName: file.name, fileType: 'pdf', text, pages, warnings };
}
