/**
 * What the AI reader is told about the image it's reading, besides the image: which document and
 * account it belongs to (for usage/cost accounting) and which file and page it is (so the server
 * can reuse a read it already paid for — see supabase/functions/extract-document-vision/store.ts).
 * Identifiers only — never document content.
 */
export interface AiReadContext {
  accountId?: string;
  documentId?: string;
  /** Scanned PDFs: the 1-based page number. */
  page?: number;
  sourceKind: 'photo' | 'scanned_pdf_page';
  /** SHA-256 (hex) of the original file — see fileSha256. */
  sourceHash?: string;
}

const hashes = new WeakMap<Blob, Promise<string | undefined>>();

/** SHA-256 of a file's bytes, hex — the same file always gives the same reads back. Undefined if the browser can't hash. */
export function fileSha256(blob: Blob): Promise<string | undefined> {
  let p = hashes.get(blob);
  if (!p) {
    p = (async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      } catch {
        return undefined;
      }
    })();
    hashes.set(blob, p);
  }
  return p;
}
