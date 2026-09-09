import { useState } from 'react';
import { FileText, FileSpreadsheet, Image as ImageIcon, Loader2, CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import type { UploadedDocument } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { Badge } from '../ui';
import { ImagePreviewModal } from './ImagePreviewModal';

function fileIcon(doc: UploadedDocument) {
  if (doc.fileType === 'image') return ImageIcon;
  return doc.fileType === 'xlsx' || doc.fileType === 'csv' ? FileSpreadsheet : FileText;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function DocumentList({ documents }: { documents: UploadedDocument[] }) {
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);

  if (documents.length === 0) return null;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {documents.map((doc) => {
          const Icon = fileIcon(doc);
          const isImage = doc.fileType === 'image';
          const canPreview = isImage && !!doc.previewDataUrl;
          return (
            <motion.li
              key={doc.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3"
            >
              {canPreview ? (
                <button
                  onClick={() => setPreviewDoc(doc)}
                  className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-[var(--color-ink-100)] cursor-pointer"
                  aria-label={`View ${doc.name}`}
                >
                  <img src={doc.previewDataUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-ink-50)] text-[var(--color-ink-500)]">
                  <Icon size={17} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">
                  {doc.name}
                  {canPreview && (
                    <button onClick={() => setPreviewDoc(doc)} className="ml-2 text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                      View image
                    </button>
                  )}
                </p>
                <p className="text-xs text-[var(--color-ink-400)]">
                  {DOCUMENT_CATEGORY_LABELS[doc.category]} · {formatSize(doc.sizeBytes)}
                </p>
                {doc.warnings && doc.warnings.length > 0 && (
                  <p className={`mt-1 flex items-start gap-1 text-xs ${doc.status === 'error' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-warning-600)]'}`}>
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                    {doc.warnings.join(' ')}
                  </p>
                )}
              </div>
              {doc.status === 'processing' ? (
                <Badge tone="info">
                  <Loader2 size={12} className="animate-spin" />
                  {isImage ? 'Reading image…' : 'Extracting…'}
                </Badge>
              ) : doc.status === 'error' ? (
                <Badge tone="danger">
                  <CircleX size={12} />
                  Couldn't read
                </Badge>
              ) : (
                <Badge tone={doc.warnings && doc.warnings.length > 0 ? 'warning' : 'success'}>
                  <CircleCheck size={12} />
                  {doc.fieldsExtracted ?? 0} fields
                </Badge>
              )}
            </motion.li>
          );
        })}
      </ul>

      <ImagePreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} src={previewDoc?.previewDataUrl ?? ''} name={previewDoc?.name ?? ''} />
    </>
  );
}
