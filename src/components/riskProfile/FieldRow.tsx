import { useEffect, useState } from 'react';
import { Pencil, Check, X, FileText, TriangleAlert, ChevronDown, ChevronUp, CircleAlert, PencilLine } from 'lucide-react';
import type { ExtractionMethod, FieldValue } from '../../types';
import type { FieldResolution } from '../../services/extraction';
import { Badge, Skeleton } from '../ui';
import { cn } from '../../utils/cn';
import { relativeTime } from '../../utils/dates';

export type FieldValueType = 'text' | 'textarea' | 'number' | 'boolean' | 'list';

const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  ai_extraction: 'AI-extracted',
  deterministic_import: 'Imported from API',
  manual_entry: 'Entered by broker',
};

interface FieldRowProps<T> {
  label: string;
  field: FieldValue<T>;
  valueType: FieldValueType;
  onSave: (value: T) => void;
  /** Enables the "choose which extracted value is correct" conflict resolver. Omit for fields that can't conflict (e.g. coverage lines today). */
  onResolve?: (resolution: FieldResolution<T>) => void;
  readOnly?: boolean;
  /** Show a skeleton instead of "Not provided" — used while a document that might fill this field is still processing. */
  pending?: boolean;
  /** Auto-opens the source/conflict detail panel — used when another page deep-links straight to this field. */
  autoExpand?: boolean;
}

export function displayReadValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && Math.abs(value) >= 1000) return value.toLocaleString('en-US');
  return String(value);
}

export function parseDraft(valueType: FieldValueType, raw: string): unknown {
  if (valueType === 'number') return raw.trim() === '' ? null : Number(raw.replace(/,/g, ''));
  if (valueType === 'list') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (valueType === 'boolean') return raw === 'Yes';
  return raw;
}

function ValueInput({ valueType, value, onChange, autoFocus }: { valueType: FieldValueType; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  if (valueType === 'boolean') {
    return (
      <select autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none">
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  return (
    <input
      autoFocus={autoFocus}
      type={valueType === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none"
    />
  );
}

function ConflictResolver<T>({
  field,
  valueType,
  onResolve,
  onDone,
}: {
  field: FieldValue<T>;
  valueType: FieldValueType;
  onResolve: (resolution: FieldResolution<T>) => void;
  onDone: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState('');

  const options: { display: string; source?: FieldValue<T>['source']; resolution: FieldResolution<T> }[] = [
    { display: displayReadValue(field.value), source: field.source, resolution: { type: 'primary' } },
    ...(field.alternateValues ?? []).map((alt, i) => ({
      display: displayReadValue(alt.value),
      source: alt.source,
      resolution: { type: 'alternate' as const, index: i },
    })),
  ];

  function choose(resolution: FieldResolution<T>) {
    onResolve(resolution);
    onDone();
  }

  return (
    <div className="space-y-2">
      <p className="font-medium text-[var(--color-ink-700)]">Documents disagree on this value — choose the correct one:</p>
      {options.map((opt, i) => (
        <div key={i} className="flex items-start justify-between gap-3 rounded-md bg-white px-2.5 py-2">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--color-ink-900)]">{opt.display || '—'}</p>
            {opt.source && (
              <p className="mt-0.5 text-[var(--color-ink-500)]">
                {opt.source.documentName}
                {opt.source.page ? `, page ${opt.source.page}` : ''}
                {opt.source.excerpt && <span className="italic"> — "{opt.source.excerpt}"</span>}
              </p>
            )}
          </div>
          <button
            onClick={() => choose(opt.resolution)}
            className="shrink-0 cursor-pointer rounded-md bg-[var(--color-brand-800)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-brand-700)]"
          >
            Use this value
          </button>
        </div>
      ))}

      {!manualOpen ? (
        <button
          onClick={() => setManualOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] underline decoration-dotted underline-offset-2 cursor-pointer"
        >
          <PencilLine size={12} />
          Enter a different value manually
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <ValueInput valueType={valueType} value={manualDraft} onChange={setManualDraft} autoFocus />
          <button
            onClick={() => choose({ type: 'manual', value: parseDraft(valueType, manualDraft) as T })}
            className="shrink-0 cursor-pointer rounded-md bg-[var(--color-brand-800)] p-1.5 text-white"
            aria-label="Save manual value"
          >
            <Check size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function FieldRow<T>({ label, field, valueType, onSave, onResolve, readOnly, pending, autoExpand }: FieldRowProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(displayReadValue(field.value));
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (autoExpand) setShowDetail(true);
  }, [autoExpand]);

  function commit() {
    onSave(parseDraft(valueType, draft) as T);
    setIsEditing(false);
  }

  const hasIssue = field.isMissing || field.isConflicting;
  const needsReview = !field.isMissing && !field.isConflicting && field.confidence === 'low';
  const wasManuallyEdited = !field.isMissing && !field.isConflicting && field.extractionMethod === 'manual_entry';

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
              {valueType === 'textarea' ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[var(--color-brand-500)] px-2 py-1.5 text-sm outline-none"
                />
              ) : (
                <ValueInput valueType={valueType} value={draft} onChange={setDraft} autoFocus />
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
            {needsReview && (
              <Badge tone="warning">
                <CircleAlert size={12} />
                Needs Review
              </Badge>
            )}
            {wasManuallyEdited && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-ink-400)]">
                <Pencil size={10} />
                Manually edited
              </span>
            )}
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
          {field.isConflicting && onResolve ? (
            <ConflictResolver field={field} valueType={valueType} onResolve={onResolve} onDone={() => setShowDetail(false)} />
          ) : (
            <>
              {field.source && (
                <div className="flex items-start gap-2 text-[var(--color-ink-500)]">
                  <FileText size={13} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-[var(--color-ink-700)]">{field.source.documentName}{field.source.page ? `, page ${field.source.page}` : ''}</p>
                    {field.source.excerpt && <p className="mt-0.5 italic text-[var(--color-ink-500)]">"{field.source.excerpt}"</p>}
                  </div>
                </div>
              )}
              {(field.extractionMethod || field.lastUpdatedAt) && (
                <p className="text-[var(--color-ink-400)]">
                  {field.extractionMethod && EXTRACTION_METHOD_LABELS[field.extractionMethod]}
                  {field.extractionMethod && field.lastUpdatedAt && ' · '}
                  {field.lastUpdatedAt && `updated ${relativeTime(field.lastUpdatedAt)}`}
                </p>
              )}
              {field.isConflicting &&
                field.alternateValues?.map((alt, i) => (
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
