import type { OcrWordLine } from '../../services/ingestion/ocr';

/**
 * Selectable text over a photo or a scanned PDF page: the words OCR found, invisible, laid exactly
 * where they are on the image — the same pdf.js text layer a text PDF gets, so selecting and copying
 * work the same way (drag across words, Ctrl/Cmd+C). For viewing only: nothing here is extracted or
 * applied to the account.
 *
 * Coordinates: `page` is the image/page in its own units (an image's pixels, or PDF points); OCR ran
 * on a canvas `ocrWidth` pixels wide showing the same page, so its boxes are scaled by page/ocr.
 */
export async function renderOcrTextLayer(
  container: HTMLElement,
  lines: OcrWordLine[],
  page: { width: number; height: number },
  ocrWidth: number
): Promise<number> {
  const k = page.width / ocrWidth;
  const items: unknown[] = [];
  let words = 0;
  for (const line of lines) {
    line.words.forEach((w, i) => {
      const next = line.words[i + 1];
      const x = w.x0 * k;
      const h = Math.max(1, (w.y1 - w.y0) * k);
      // Up to the next word, with a trailing space, so a copied line keeps its spaces.
      const right = (next ? next.x0 : w.x1) * k;
      items.push({
        str: next ? `${w.text} ` : w.text,
        dir: 'ltr',
        width: Math.max(1, right - x),
        height: h,
        transform: [h, 0, 0, h, x, page.height - w.y1 * k],
        fontName: 'ocr',
        hasEOL: !next,
      });
      words++;
    });
  }
  if (!words) return 0;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  layer.dataset.ocr = 'true';
  container.appendChild(layer);
  await new pdfjs.TextLayer({
    textContentSource: { items, styles: { ocr: { fontFamily: 'sans-serif', ascent: 1, descent: 0, vertical: false } }, lang: 'en' } as never,
    container: layer,
    // Page units in, percentages out; the display scale comes from --total-scale-factor on the page.
    viewport: { scale: 1, rotation: 0, rawDims: { pageWidth: page.width, pageHeight: page.height, pageX: 0, pageY: 0 } } as never,
  }).render();
  return words;
}
