import { FileText, FileSpreadsheet, Loader2, CircleCheck, TriangleAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import type { UploadedDocument } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { Badge } from '../ui';

function fileIcon(doc: UploadedDocument) {
  return doc.fileType === 'xlsx' || doc.fileType === 'csv' ? FileSpreadsheet : FileText;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function DocumentList({ documents }: { documents: UploadedDocument[] }) {
  if (documents.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => {
        const Icon = fileIcon(doc);
        return (
          <motion.li
            key={doc.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-ink-50)] text-[var(--color-ink-500)]">
              <Icon size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{doc.name}</p>
              <p className="text-xs text-[var(--color-ink-400)]">
                {DOCUMENT_CATEGORY_LABELS[doc.category]} · {formatSize(doc.sizeBytes)}
              </p>
              {doc.warnings && doc.warnings.length > 0 && (
                <p className="mt-1 flex items-start gap-1 text-xs text-[var(--color-warning-600)]">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  {doc.warnings.join(' ')}
                </p>
              )}
            </div>
            {doc.status === 'processing' ? (
              <Badge tone="info">
                <Loader2 size={12} className="animate-spin" />
                Extracting…
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
  );
}
