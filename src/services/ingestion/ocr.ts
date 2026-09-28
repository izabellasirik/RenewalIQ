import { createWorker, type Worker } from 'tesseract.js';
import type { PdfTextPiece } from './pdfLayout';

/**
 * On-device OCR shared by photos (parseImage.ts) and scanned PDF pages (parsePdf.ts): prepares the
 * image the way OCR reads best, and returns the words with their positions so the same layout
 * reader that handles PDF tables (pdfLayout.ts) can read a scanned or photographed table by column.
 *
 * Tesseract.js downloads its worker, WASM core and English data from a public CDN on first use. Set
 * VITE_TESSERACT_PATH to serve them yourself instead (a folder with worker.min.js, core/ and lang/).
 */

/** Text looks best to Tesseract at roughly 25–35 px tall; small photos (license shots) are enlarged up to this long edge. */
const MIN_LONG_EDGE = 1800;
const MAX_LONG_EDGE = 2600;

export interface OcrPage {
  text: string;
  /** Tesseract's mean confidence, 0–100. */
  confidence: number;
  /** Every recognized word with its box, as layout pieces (y grows upwards, like PDF). */
  pieces: PdfTextPiece[];
}

function workerOptions(): Parameters<typeof createWorker>[2] {
  const base = (import.meta.env.VITE_TESSERACT_PATH as string | undefined)?.replace(/\/$/, '');
  return base ? { workerPath: `${base}/worker.min.js`, corePath: `${base}/core`, langPath: `${base}/lang` } : {};
}

/**
 * Grayscale + contrast stretch (ignoring the darkest/brightest 1%), and resizing into the size range
 * OCR reads best. Glare, a gray background or a small phone photo otherwise cost whole fields.
 */
export function prepareForOcr(source: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const long = Math.max(source.width, source.height);
  const scale = long < MIN_LONG_EDGE ? Math.min(3, MIN_LONG_EDGE / long) : Math.min(1, MAX_LONG_EDGE / long);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not prepare the image for reading.');
  ctx.imageSmoothingQuality = 'high';
  // White behind a transparent screenshot — transparent pixels would otherwise read as black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    const total = d.length / 4;
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
    for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
    if (hi - lo > 30) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    // A tainted/unsupported canvas: OCR the image as drawn.
  }
  return canvas;
}

interface TessWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TessLine {
  words?: TessWord[];
  baseline?: { x0: number; y0: number; x1: number; y1: number };
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The page's tilt (dy per dx) from Tesseract's line baselines — the median over lines long enough
 * to measure. A scan tilted by half a degree already moves the end of a row a full line height,
 * which would split one printed row into two.
 */
export function pageSlope(lines: { baseline?: { x0: number; y0: number; x1: number; y1: number } }[]): number {
  const slopes = lines
    .map((l) => l.baseline)
    .filter((b): b is NonNullable<typeof b> => !!b && b.x1 - b.x0 > 150)
    .map((b) => (b.y1 - b.y0) / (b.x1 - b.x0))
    .filter((m) => Math.abs(m) < 0.1)
    .sort((x, y) => x - y);
  return slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
}

/** OCRs canvases in order with one engine. */
export async function ocrCanvases(canvases: HTMLCanvasElement[]): Promise<OcrPage[]> {
  let worker: Worker | null = null;
  try {
    worker = await createWorker('eng', undefined, workerOptions());
    const pages: OcrPage[] = [];
    for (const canvas of canvases) {
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      const lines: TessLine[] = [];
      for (const block of data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) lines.push(line as TessLine);
      const slope = pageSlope(lines);
      const pieces = lines.flatMap((l) => {
        // A word sits on its line's baseline (its box bottom moves with letters like g and y),
        // straightened by the page's tilt so one printed row stays one line.
        const b = l.baseline;
        const baselineAt = (x: number) => (b && b.x1 !== b.x0 ? b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0) : l.bbox.y1);
        return (l.words ?? [])
          .filter((w) => w.text.trim())
          .map((w) => ({ str: w.text, x: w.bbox.x0, y: canvas.height - (baselineAt(w.bbox.x0) - slope * w.bbox.x0), width: w.bbox.x1 - w.bbox.x0, height: Math.max(1, w.bbox.y1 - w.bbox.y0) }));
      });
      pages.push({ text: data.text ?? '', confidence: data.confidence, pieces });
    }
    return pages;
  } finally {
    await worker?.terminate();
  }
}
