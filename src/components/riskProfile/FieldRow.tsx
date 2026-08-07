import { useState } from 'react';
import { Pencil, Check, X, FileText, TriangleAlert, ChevronDown, ChevronUp } from 'lucide-react';
import type { FieldValue } from '../../types';
import { ConfidenceBadge, Skeleton } from '../ui';
import { cn } from '../../utils/cn';

export type FieldValueType = 'text' | 'textarea' | 'number' | 'boolean' | 'list';

interface FieldRowProps<T> {
  label: string;
  field: FieldValue<T>;
  valueType: FieldValueType;
  onSave: (value: T) => void;
  readOnly?: boolean;
  /** Show a skeleton instead of "Not provided" — used while a document that might fill this field is still processing. */
  pending?: boolean;
}

export function displayReadValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function FieldRow<T>({ label, field, valueType, onSave, readOnly, pending }: FieldRowProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(displayReadValue(field.value));
  const [showDetail, setShowDetail] = useState(false);

  function commit() {
    let parsed: unknown = draft;
    if (valueType === 'number') parsed = draft.trim() === '' ? null : Number(draft);
    if (valueType === 'list') parsed = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (valueType === 'boolean') parsed = draft === 'Yes';
    onSave(parsed as T);
    setIsEditing(false);
  }

  const hasIssue = field.isMissing || field.isConflicting;

  return (
    <div className={cn('rounded-lg border px-4 py-3 transition-colors', hasIssue ? 'border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/30' : 'border-transparent hover:bg-[var(--color-ink-50)]')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--color-ink-500)]">{label}</p>

          {!isEditing ? (
            <div className="mt-1 flex items-center gap-2">
              {field.isMissing && pending ? (
                <Skeleton width="60%" />
              ) : field.isMissing ? (
                <span className="text-sm italic text-[var(--color-ink-400)]">Not provided</span>
              ) : valueType === 'boolean' ? (
                <button
                  onClick={() => setShowDetail((v) => !v)}
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-sm font-medium',
                    field.value ? 'bg-[var(--color-success-100)] text-[var(--color-success-600)]' : 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]'
                  )}
                >
                  {displayReadValue(field.value)}
                </button>
              ) : (
                <p className="text-sm text-[var(--color-ink-900)]">{displayReadValue(field.value)}</p>
              )}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              {valueType === 'boolean' ? (
                <select
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none"
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              ) : valueType === 'textarea' ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none"
                />
              ) : (
                <input
                  autoFocus
                  type={valueType === 'number' ? 'number' : 'text'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commit()}
                  className="w-full rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none"
                />
              )}
              <button onClick={commit} className="rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
                <Check size={14} />
              </button>
              <button onClick={() => setIsEditing(false)} className="rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!field.isMissing && <ConfidenceBadge confidence={field.confidence} />}
            {field.isConflicting && (
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-100)] px-2 py-1 text-xs font-medium text-[var(--color-warning-600)] cursor-pointer"
              >
                <TriangleAlert size={12} />
                Conflict
              </button>
            )}
            {field.source && (
              <button onClick={() => setShowDetail((v) => !v)} className="rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label="Show source">
                <FileText size={14} />
              </button>
            )}
            {!readOnly && (
              <button
                onClick={() => {
                  setDraft(displayReadValue(field.value));
                  setIsEditing(true);
                }}
                className="rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer"
                aria-label="Edit"
              >
                <Pencil size={14} />
              </button>
            )}
            {(field.source || field.alternateValues?.length) && (
              <button onClick={() => setShowDetail((v) => !v)} className="rounded-md p-1 text-[var(--color-ink-300)] cursor-pointer">
                {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>
        )}
      </div>

      {showDetail && (
        <div className="mt-3 space-y-2 border-t border-[var(--color-ink-100)] pt-3 text-xs">
          {field.source && (
            <div className="flex items-start gap-2 text-[var(--color-ink-500)]">
              <FileText size={13} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-[var(--color-ink-700)]">{field.source.documentName}{field.source.page ? `, page ${field.source.page}` : ''}</p>
                {field.source.excerpt && <p className="mt-0.5 italic text-[var(--color-ink-500)]">"{field.source.excerpt}"</p>}
              </div>
            </div>
          )}
          {field.alternateValues?.map((alt, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md bg-white px-2 py-1.5 text-[var(--color-ink-500)]">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--color-warning-500)]" />
              <div>
                <p>
                  Conflicting value <span className="font-semibold text-[var(--color-ink-800)]">{displayReadValue(alt.value)}</span> from{' '}
                  <span className="font-medium text-[var(--color-ink-700)]">{alt.source.documentName}</span>
                </p>
                {alt.source.excerpt && <p className="mt-0.5 italic">"{alt.source.excerpt}"</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
