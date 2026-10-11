import { useState } from 'react';
import { Eye, FileText } from 'lucide-react';
import type { UploadedDocument } from '../../types';
import { DocumentPreviewModal } from '../upload/DocumentPreviewModal';

/** A linked document's name with an in-app "View" — same viewer as the document list, nothing downloaded. */
export function DocumentPreviewLink({ doc }: { doc: UploadedDocument }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-[var(--color-ink-500)]">
        <FileText size={12} className="shrink-0" />
        <span className="truncate">{doc.name}</span>
        <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
          <Eye size={11} />
          View
        </button>
      </span>
      <DocumentPreviewModal doc={open ? doc : null} onClose={() => setOpen(false)} />
    </>
  );
}
