import { decodeOriented, drawToCanvas } from './imageUtils';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import type { OcrWordLine } from './ocr';

/**
 * "Select text on the photo", read by the AI vision reader (the same Edge Function that already
 * reads uploaded photos for extraction, in its `transcribe` mode). Licenses and ID cards — patterned,
 * glossy, phone-photographed — are far beyond what on-device OCR reads reliably; this is for the
 * document preview only: viewing, selecting and copying. Nothing here is extracted or applied.
 */

/** One printed line, its box as fractions (0–1) of the image's width and height. */
export interface TranscriptLine {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
}

const MAX_DIMENSION = 1568;
const MAX_LINES = 400;

/** The model's answer is untrusted: only well-formed lines with a plausible box are kept. */
export function validateTranscript(raw: unknown): TranscriptLine[] | null {
  const lines = (raw as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return null;
  const out: TranscriptLine[] = [];
  for (const l of lines.slice(0, MAX_LINES)) {
    const text = typeof (l as { text?: unknown })?.text === 'string' ? (l as { text: string }).text.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const box = (l as { box?: unknown })?.box;
    if (!text || !Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const [a, b, c, d] = (box as number[]).map((n) => Math.min(1000, Math.max(0, n)) / 1000);
    const x0 = Math.min(a, c), x1 = Math.max(a, c), y0 = Math.min(b, d), y1 = Math.max(b, d);
    if (x1 - x0 < 0.003 || y1 - y0 < 0.003) continue;
    out.push({ text, box: { x0, y0, x1, y1 } });
  }
  return out.length ? out : null;
}

/**
 * Where each transcribed line goes on the image (in image pixels). The AI's boxes are approximate;
 * when on-device OCR found words on the same row inside the AI box, the line takes their exact
 * extent instead, so the selection highlight sits on the printed text.
 */
export function placeTranscript(lines: TranscriptLine[], page: { width: number; height: number }, ocr?: { lines: OcrWordLine[]; ocrWidth: number }): OcrWordLine[] {
  const k = ocr ? page.width / ocr.ocrWidth : 1;
  const ocrWords = ocr ? ocr.lines.flatMap((l) => l.words.map((w) => ({ x0: w.x0 * k, y0: w.y0 * k, x1: w.x1 * k, y1: w.y1 * k }))) : [];
  const used = new Set<number>();
  return lines.map((l) => {
    const box = { x0: l.box.x0 * page.width, y0: l.box.y0 * page.height, x1: l.box.x1 * page.width, y1: l.box.y1 * page.height };
    const h = box.y1 - box.y0;
    const near = ocrWords
      .map((w, i) => ({ w, i }))
      .filter(({ w, i }) => {
        if (used.has(i)) return false;
        const cy = (w.y0 + w.y1) / 2;
        const cx = (w.x0 + w.x1) / 2;
        return cy >= box.y0 - h * 0.6 && cy <= box.y1 + h * 0.6 && cx >= box.x0 - h && cx <= box.x1 + h;
      });
    let placed = box;
    if (near.length) {
      near.forEach(({ i }) => used.add(i));
      placed = {
        x0: Math.min(...near.map(({ w }) => w.x0)),
        y0: Math.min(...near.map(({ w }) => w.y0)),
        x1: Math.max(...near.map(({ w }) => w.x1)),
        y1: Math.max(...near.map(({ w }) => w.y1)),
      };
    }
    return { words: [{ text: l.text, ...placed }] };
  });
}

// One call per document: kept for this session, and on this device for the last few documents.
const memory = new Map<string, Promise<TranscriptLine[] | null>>();
const STORE_KEY = 'riq.transcripts.v1';
const STORE_MAX = 30;

function stored(): Record<string, { at: number; lines: TranscriptLine[] }> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function remember(key: string, lines: TranscriptLine[]) {
  try {
    const all = stored();
    all[key] = { at: Date.now(), lines };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, STORE_MAX);
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // storage full or blocked: the session copy is enough
  }
}

/** A reading already saved for this key (this session or this device), without calling anything. */
export function savedTranscript(key: string): TranscriptLine[] | null {
  return stored()[key]?.lines ?? null;
}

/** Why the last AI reading wasn't used — shown in the preview so a fallback is never silent. */
export type TranscriptUnavailable = 'not-signed-in' | 'function-outdated' | 'function-missing' | 'failed';
let lastUnavailable: TranscriptUnavailable | null = null;
/** Set once the Edge Function answered like the old version (no transcribe mode): not asked again this session. */
let functionOutdated = false;

export function transcriptUnavailableReason(): TranscriptUnavailable | null {
  return lastUnavailable;
}

export const TRANSCRIPT_UNAVAILABLE_MESSAGES: Record<TranscriptUnavailable, string> = {
  'not-signed-in': 'AI reading needs you to be signed in — showing the on-device reading, which is often wrong on photos.',
  'function-outdated': 'AI reading isn’t switched on yet: the "extract-document-vision" Supabase function needs redeploying. Showing the on-device reading, which is often wrong on photos.',
  'function-missing': 'AI reading isn’t available: the "extract-document-vision" Supabase function isn’t deployed or its API key isn’t set. Showing the on-device reading.',
  failed: 'The AI reading didn’t work this time — showing the on-device reading. Reopen the preview to try again.',
};

/** The AI transcription of a photo, or null when it isn't available (see transcriptUnavailableReason). Never throws. */
export function transcribePhoto(key: string, blob: Blob, currentUserId: string | null): Promise<TranscriptLine[] | null> {
  const cached = memory.get(key);
  if (cached) return cached;
  const saved = stored()[key]?.lines;
  if (saved?.length) {
    const p = Promise.resolve(saved);
    memory.set(key, p);
    return p;
  }
  const job = (async (): Promise<TranscriptLine[] | null> => {
    const fail = (why: TranscriptUnavailable) => {
      lastUnavailable = why;
      return null;
    };
    if (!isSupabaseConfigured || !supabase || !currentUserId) return fail('not-signed-in');
    if (functionOutdated) return fail('function-outdated');
    try {
      const bitmap = await decodeOriented(new File([blob], 'photo', { type: blob.type }));
      let base64: string | undefined;
      try {
        base64 = drawToCanvas(bitmap, MAX_DIMENSION).toDataURL('image/jpeg', 0.9).split(',')[1];
      } finally {
        bitmap.close();
      }
      if (!base64) return fail('failed');
      const { data, error } = await supabase.functions.invoke('extract-document-vision', { body: { imageBase64: base64, mimeType: 'image/jpeg', mode: 'transcribe' } });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        return fail(status === 404 || status === 503 ? 'function-missing' : 'failed');
      }
      if (data && typeof data === 'object' && !('lines' in data) && ('documentType' in data || 'scalarFields' in data)) {
        // The deployed function predates transcribe mode: it ran a normal extraction instead.
        functionOutdated = true;
        return fail('function-outdated');
      }
      const lines = validateTranscript(data);
      if (!lines) return fail('failed');
      lastUnavailable = null;
      remember(key, lines);
      return lines;
    } catch {
      return fail('failed');
    }
  })();
  memory.set(key, job);
  // A failed read can be retried next time the preview opens.
  job.then((r) => !r && memory.delete(key));
  return job;
}
