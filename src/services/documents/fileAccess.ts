import { getLocalFile } from './localFileStore';
import { downloadDocumentFile } from '../supabase/submissionsRepo';

/** The original bytes of a stored file (uploaded document or quote attachment): this browser's copy first, then the broker's cloud account. */
export async function loadStoredFile(file: { id: string; storagePath?: string }): Promise<Blob | null> {
  const local = await getLocalFile(file.id);
  if (local) return local.blob;
  if (file.storagePath) {
    const res = await downloadDocumentFile(file.storagePath);
    if (res.ok) return res.data;
  }
  return null;
}

/** Saves a blob to the broker's computer under its original name. */
export function saveBlobAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
