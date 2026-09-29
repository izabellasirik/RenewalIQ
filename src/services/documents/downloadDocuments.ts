import type { UploadedDocument } from '../../types';
import { loadStoredFile, saveBlobAs } from './fileAccess';

type Downloadable = Pick<UploadedDocument, 'id' | 'name' | 'storagePath'>;

/** One document's original file, saved under its own name. False when the file isn't available here or in the cloud. */
export async function downloadDocument(doc: Downloadable): Promise<boolean> {
  const blob = await loadStoredFile(doc);
  if (!blob) return false;
  saveBlobAs(blob, doc.name);
  return true;
}

/** "loss run.pdf", "loss run.pdf" → "loss run.pdf", "loss run (2).pdf" — a ZIP can't hold two files with one name. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const clean = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
    let candidate = clean;
    const dot = clean.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Every document's original file in one ZIP, named after the account. Files that can't be found
 * (e.g. a document that was only a link) are skipped and reported back, never silently dropped.
 */
export async function downloadAllDocuments(docs: Downloadable[], zipName: string, onProgress?: (done: number, total: number) => void): Promise<{ saved: number; missing: string[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const names = uniqueNames(docs.map((d) => d.name));
  const missing: string[] = [];
  let saved = 0;
  for (let i = 0; i < docs.length; i++) {
    const blob = await loadStoredFile(docs[i]);
    if (blob) {
      zip.file(names[i], blob);
      saved++;
    } else missing.push(docs[i].name);
    onProgress?.(i + 1, docs.length);
  }
  if (saved > 0) {
    const out = await zip.generateAsync({ type: 'blob' });
    saveBlobAs(out, `${zipName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documents'}.zip`);
  }
  return { saved, missing };
}
