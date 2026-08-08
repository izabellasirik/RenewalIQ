import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '../../utils/cn';

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
        isDragging
          ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]/5'
          : 'border-[var(--color-ink-200)] bg-white hover:border-[var(--color-ink-300)] hover:bg-[var(--color-ink-50)]'
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-800)]/8 text-[var(--color-brand-700)]">
        <UploadCloud size={22} />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-ink-800)]">
          Drag and drop documents here, or <span className="text-[var(--color-brand-700)] underline underline-offset-2">browse</span>
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-500)]">PDF, DOCX, XLSX/XLS, CSV, TXT — questionnaires, loss runs, vehicle & driver schedules</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
