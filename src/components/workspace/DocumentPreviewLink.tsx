import { useState } from 'react';
import { Eye, FileText, Loader2 } from 'lucide-react';
import type { UploadedDocument } from '../../types';
import { ImagePreviewModal } from '../upload/ImagePreviewModal';
import { getSignedDocumentUrl } from '../../services/supabase/submissionsRepo';

/**
 * Opens an uploaded document using the preview paths that already exist: the in-browser image
 * preview for photos, or a short-lived signed URL for a file stored in the broker's cloud account.
 * Local-only non-image files have no retained bytes (see UploadedDocument.previewDataUrl), so they
 * show the name only.
 */
export function DocumentPreviewLink({ doc }: { doc: UploadedDocument }) {
  const [imageOpen, setImageOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImage = !!doc.previewDataUrl;
  const canCloud = !canImage && !!doc.storagePath;

  async function open() {
    if (canImage) return setImageOpen(true);
    if (!doc.storagePath) return;
    setLoading(true);
    setError(null);
    // Open synchronously so popup blockers allow it, then point it at the signed URL.
    const win = window.open('', '_blank');
    const res = await getSignedDocumentUrl(doc.storagePath);
    setLoading(false);
    if (res.ok && win) win.location.href = res.data;
    else {
      win?.close();
      setError(res.ok ? 'Popup blocked' : res.message);
    }
  }

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-[var(--color-ink-500)]">
        <FileText size={12} className="shrink-0" />
        <span className="truncate">{doc.name}</span>
        {(canImage || canCloud) && (
          <button onClick={open} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
            View
          </button>
        )}
        {error && <span className="text-[var(--color-danger-600)]">{error}</span>}
      </span>
      {canImage && <ImagePreviewModal open={imageOpen} onClose={() => setImageOpen(false)} src={doc.previewDataUrl ?? ''} name={doc.name} />}
    </>
  );
}
