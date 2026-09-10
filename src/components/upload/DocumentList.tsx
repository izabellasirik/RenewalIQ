import { useState } from 'react';
import { FileText, FileSpreadsheet, Image as ImageIcon, Loader2, CircleCheck, CircleX, TriangleAlert, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import type { RiskProfile, UploadedDocument } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { previewDocumentRemovalImpact } from '../../services/extraction';
import { Badge, ConfirmDialog } from '../ui';
import { ImagePreviewModal } from './ImagePreviewModal';
import { DocumentExtractionDetail } from './DocumentExtractionDetail';

function fileIcon(doc: UploadedDocument) {
  if (doc.fileType === 'image') return ImageIcon;
  return doc.fileType === 'xlsx' || doc.fileType === 'csv' ? FileSpreadsheet : FileText;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function DocumentList({
  documents,
  profile,
  onDelete,
}: {
  documents: UploadedDocument[];
  /** Used only to preview what a deletion would affect, in the confirm dialog — never mutated here. */
  profile?: RiskProfile;
  onDelete?: (documentId: string) => void;
}) {
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UploadedDocument | null>(null);
  const [detailDoc, setDetailDoc] = useState<UploadedDocument | null>(null);

  if (documents.length === 0) return null;

  const impact = deleteTarget && profile ? previewDocumentRemovalImpact(profile, deleteTarget.id) : null;
  const impactParts = impact
    ? [
        impact.fields > 0 && `${impact.fields} field${impact.fields === 1 ? '' : 's'}`,
        impact.vehicles > 0 && `${impact.vehicles} vehicle${impact.vehicles === 1 ? '' : 's'}`,
        impact.drivers > 0 && `${impact.drivers} driver${impact.drivers === 1 ? '' : 's'}`,
        impact.losses > 0 && `${impact.losses} loss${impact.losses === 1 ? '' : 'es'}`,
      ].filter((p): p is string => !!p)
    : [];

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
              ) : profile ? (
                <button
                  onClick={() => setDetailDoc(doc)}
                  className="cursor-pointer"
                  aria-label={`View extracted data for ${doc.name}`}
                >
                  <Badge tone={doc.warnings && doc.warnings.length > 0 ? 'warning' : 'success'} className="hover:opacity-80">
                    <CircleCheck size={12} />
                    {doc.fieldsExtracted ?? 0} field{doc.fieldsExtracted === 1 ? '' : 's'} extracted · View
                  </Badge>
                </button>
              ) : (
                <Badge tone={doc.warnings && doc.warnings.length > 0 ? 'warning' : 'success'}>
                  <CircleCheck size={12} />
                  {doc.fieldsExtracted ?? 0} field{doc.fieldsExtracted === 1 ? '' : 's'} extracted
                </Badge>
              )}
              {onDelete && (
                <button
                  onClick={() => setDeleteTarget(doc)}
                  className="shrink-0 rounded-md p-1.5 text-[var(--color-ink-300)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer"
                  aria-label={`Delete ${doc.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>

      <ImagePreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} src={previewDoc?.previewDataUrl ?? ''} name={previewDoc?.name ?? ''} />

      {profile && <DocumentExtractionDetail open={!!detailDoc} onClose={() => setDetailDoc(null)} document={detailDoc} profile={profile} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete?.(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Delete this file?"
        description={
          impactParts.length > 0
            ? `Removing this file may affect information extracted from it: ${impactParts.join(', ')} that depended only on ${deleteTarget?.name} will be removed or updated. Values also confirmed by you or supported by another document will be kept.`
            : `Removing this file may affect information extracted from it. Nothing currently in the Risk Profile depends only on ${deleteTarget?.name ?? 'this file'}.`
        }
        confirmLabel="Delete file"
      />
    </>
  );
}
