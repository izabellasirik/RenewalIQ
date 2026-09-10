import { createWorker } from 'tesseract.js';
import type { RawDocument } from './types';
import { decodeOriented, drawToCanvas } from './imageUtils';

/**
 * On-device OCR (Tesseract.js — WebAssembly, runs entirely in the broker's browser). This is no
 * longer the primary way an image's content is understood — see visionExtraction.ts, which sends
 * the image itself to a vision-capable model via a Supabase Edge Function for layout-aware
 * structured extraction. This module remains as the fallback/supplement for when vision isn't
 * available (Supabase not configured, broker not signed in, or the vision call fails) and as a
 * second, independent read that the vision result can be reconciled against — see
 * services/extraction/reconcileImageExtraction.ts. The OCR'd text still runs through the same
 * extractInsuranceFields() deterministic pattern-matching used for PDF/DOCX/TXT text, tagged
 * extractionMethod: 'image_ocr' (confidence capped at 'medium' — see capConfidence in
 * extractInsuranceFields.ts) to keep it distinct from a vision-model read ('vision_extraction',
 * which can legitimately reach 'high').
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
