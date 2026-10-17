import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { UploadedDocument } from '../../types';
import { downloadAllDocuments } from '../../services/documents/downloadDocuments';

/** "Download all": every document of the account in one ZIP. */
export function DownloadAllDocuments({ documents, accountName }: { documents: UploadedDocument[]; accountName: string }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (documents.length === 0) return null;

  async function run() {
    setNote(null);
    setProgress(`0 of ${documents.length}`);
    try {
      const { saved, missing } = await downloadAllDocuments(documents, `${accountName} documents`, (done, total) => setProgress(`${done} of ${total}`));
      if (saved === 0) setNote('None of these files are available to download.');
      else if (missing.length) setNote(`Downloaded ${saved}; not available: ${missing.join(', ')}.`);
    } catch {
      setNote('Could not create the download — try again.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        onClick={() => void run()}
        disabled={!!progress}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline disabled:opacity-60 cursor-pointer"
        data-testid="download-all"
      >
        {progress ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        {progress ? `Preparing ${progress}…` : `Download all (${documents.length})`}
      </button>
      {note && <span className="mt-0.5 max-w-xs text-right text-[11px] text-[var(--color-ink-500)]">{note}</span>}
    </span>
  );
}
