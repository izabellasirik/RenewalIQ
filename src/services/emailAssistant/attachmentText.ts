import type { ParsedAttachment } from './parseEmail';

/**
 * The text of an attachment, to tell what kind of document it is: a PDF's own embedded text (no
 * OCR, no AI — a scan is identified by its name only), or a text/CSV file as it is. Loaded only
 * when the Email Assistant reads an email, so the PDF reader isn't pulled into other pages.
 */
export async function attachmentText(att: ParsedAttachment): Promise<string | null> {
  if (!att.data) return null;
  if (/pdf$/i.test(att.contentType) || /\.pdf$/i.test(att.name)) {
    const { parsePdf } = await import('../ingestion/parsePdf');
    const raw = await parsePdf(new File([new Uint8Array(att.data)], att.name, { type: 'application/pdf' }), { ocrScannedPages: false });
    return raw.text.slice(0, 200_000) || null;
  }
  if (/^text\/|csv/i.test(att.contentType) || /\.(txt|csv)$/i.test(att.name)) return new TextDecoder('utf-8', { fatal: false }).decode(att.data.slice(0, 512 * 1024));
  return null;
}
