import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Paperclip } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { findTemplateItem } from '../../services/workflow/checklistTemplates';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { inputClass, labelClass } from './formStyles';

/**
 * Mark a checklist item received, optionally linking the uploaded document that satisfies it —
 * either one already on the account or a new file uploaded right here (which then goes through
 * the normal extraction pipeline like any other upload).
 */
export function ReceiveItemDialog({ accountId, itemId, open, onClose }: { accountId: string; itemId: string | null; open: boolean; onClose: () => void }) {
  const { items, quotes, documents } = useAccountWorkflow(accountId);
  const markItemReceived = useAccountsStore((s) => s.markItemReceived);
  const addFiles = useAccountsStore((s) => s.addFiles);
  const item = items.find((i) => i.id === itemId);
  const quote = item?.neededByQuoteId ? quotes.find((q) => q.id === item.neededByQuoteId) : undefined;

  const [documentId, setDocumentId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Documents whose category matches this checklist item float to the top.
  const suggestedCategories = findTemplateItem(item?.templateKey)?.documentCategories ?? [];
  const sortedDocs = useMemo(
    () => [...documents].sort((a, b) => Number(suggestedCategories.includes(b.category)) - Number(suggestedCategories.includes(a.category))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents, item?.templateKey]
  );

  useEffect(() => {
    if (!open) return;
    const suggested = documents.find((d) => suggestedCategories.includes(d.category));
    setDocumentId(item?.documentId ?? suggested?.id ?? '');
    setFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId]);

  if (!item) return null;

  function confirm() {
    if (!item) return;
    let linked = documentId || undefined;
    if (file) linked = addFiles(accountId, [file])[0];
    markItemReceived(accountId, item.id, { documentId: linked });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark received — ${item.label}`}
      subtitle={quote ? `Needed by ${quote.marketName}. It will show as ready to send to them.` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" icon={<PackageCheck size={14} />} onClick={confirm}>
            Mark received
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass} htmlFor="recv-doc">
            Link an uploaded document (optional)
          </label>
          <select
            id="recv-doc"
            value={file ? '' : documentId}
            onChange={(e) => {
              setDocumentId(e.target.value);
              setFile(null);
            }}
            className={inputClass}
            disabled={!!file}
          >
            <option value="">No document</option>
            {sortedDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {DOCUMENT_CATEGORY_LABELS[d.category]}
                {suggestedCategories.includes(d.category) ? ' (suggested)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelClass}>…or upload it now</p>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Paperclip size={14} />} onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
            {file && (
              <span className="text-xs text-[var(--color-ink-600)]">
                {file.name}{' '}
                <button onClick={() => setFile(null)} className="ml-1 text-[var(--color-danger-600)] hover:underline cursor-pointer">
                  remove
                </button>
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-400)]">Uploaded files are read into the Risk Profile like any other document.</p>
        </div>
      </div>
    </Modal>
  );
}
