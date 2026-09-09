import { createWorker } from 'tesseract.js';
import type { RawDocument } from './types';

/**
 * How image ingestion actually reads text: on-device OCR (Tesseract.js — WebAssembly, runs
 * entirely in the broker's browser) rather than a multimodal AI vision API. There is currently no
 * AI/vision provider wired into this app anywhere (no API key, no server to hold one securely —
 * see PRODUCT_ROADMAP.md), and building one would require exactly that: a secret key plus a
 * server-side function, since a Vite frontend can never hold a secret safely. OCR needs neither —
 * no key, no backend, ships today. The OCR'd text is then run through the exact same
 * extractInsuranceFields() deterministic pattern-matching used for PDF/DOCX/TXT text, so every
 * downstream behavior (provenance, confidence, reconciliation, conflict review) is identical for
 * an image as for any other document — see fieldExtraction/extractInsuranceFields.ts's
 * `isImageSource` handling for the one place image provenance is treated differently (confidence
 * is capped, and extractionMethod is 'image_ocr' instead of 'ai_extraction').
 *
 * Runtime note: Tesseract.js fetches its worker script, WASM core, and English language data
 * (a few MB total) from public CDNs (jsdelivr / tessdata) the first time an image is processed in
 * a given browser session — free, keyless, cached after first use, no account or billing involved.
 * This is a real network dependency worth knowing about, but it is not a secret/credential this
 * app needs to be configured with.
 */

/** Long edge, in pixels, of the image actually fed to OCR — enough to read normal document/label text without making recognition unreasonably slow on a large phone photo. */
const OCR_MAX_DIMENSION = 2200;
/** Long edge of the smaller copy kept for on-screen preview — deliberately small so it survives being stored as a data URL in the persisted UploadedDocument (and, by extension, localStorage). */
const PREVIEW_MAX_DIMENSION = 1000;
const PREVIEW_QUALITY = 0.72;

/** Tesseract's own 0-100 mean-confidence score for the whole page. Below this, we don't trust anything it read — the document is treated as unreadable rather than risking a field extracted from noise. */
const UNREADABLE_CONFIDENCE = 35;
/** Below this (but at/above UNREADABLE_CONFIDENCE), text is used but flagged — this is the band where individual characters are plausibly wrong even though *something* real was read. */
const LOW_CONFIDENCE_WARNING = 55;
const MIN_READABLE_CHARS = 6;

const UNREADABLE_MESSAGE = "We couldn't reliably read this image. Try uploading a clearer photo or review the fields manually.";

/**
 * Decodes with EXIF orientation applied — the single most common phone-photo problem (a document
 * shot in portrait that the camera tagged as rotated). `imageOrientation: 'from-image'` is the
 * standards-based way to get pixels that are actually right-side-up; browsers old enough to lack
 * it still decode the image, just without the correction, so this never blocks a valid upload.
 */
async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function drawToCanvas(bitmap: ImageBitmap, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the image for reading.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function parseImage(file: File): Promise<RawDocument> {
  const warnings: string[] = [];

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeOriented(file);
  } catch (err) {
    warnings.push(`Could not open this image (unrecognized or corrupt file): ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'image', text: '', warnings };
  }

  let imagePreviewDataUrl: string | undefined;
  let ocrCanvas: HTMLCanvasElement;
  try {
    imagePreviewDataUrl = drawToCanvas(bitmap, PREVIEW_MAX_DIMENSION).toDataURL('image/jpeg', PREVIEW_QUALITY);
    ocrCanvas = drawToCanvas(bitmap, OCR_MAX_DIMENSION);
  } finally {
    bitmap.close();
  }

  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(ocrCanvas);
    const confidence = data.confidence;
    const text = data.text ?? '';

    if (confidence < UNREADABLE_CONFIDENCE || text.trim().length < MIN_READABLE_CHARS) {
      warnings.push(UNREADABLE_MESSAGE);
      return { documentName: file.name, fileType: 'image', text: '', warnings, imagePreviewDataUrl, ocrConfidence: confidence };
    }

    if (confidence < LOW_CONFIDENCE_WARNING) {
      warnings.push('This image was only partially readable — some fields may be missing, and anything extracted is worth double-checking against the photo.');
    }

    return { documentName: file.name, fileType: 'image', text, warnings, imagePreviewDataUrl, ocrConfidence: confidence };
  } catch (err) {
    warnings.push(`${UNREADABLE_MESSAGE} (${err instanceof Error ? err.message : 'OCR engine error'})`);
    return { documentName: file.name, fileType: 'image', text: '', warnings, imagePreviewDataUrl };
  } finally {
    await worker.terminate();
  }
}
