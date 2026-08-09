import { useState } from 'react';
import { CircleCheck, CircleHelp, TriangleAlert, CircleAlert, Pencil, FileText, ChevronDown, ChevronUp, ArrowRight, Save } from 'lucide-react';
import type { MappedField, MappedFieldStatus } from '../../types';
import { Badge, type BadgeTone } from '../ui';

const STATUS_META: Record<MappedFieldStatus, { label: string; tone: BadgeTone; Icon: typeof CircleCheck }> = {
  auto_filled: { label: 'Auto-filled', tone: 'success', Icon: CircleCheck },
  manually_entered: { label: 'Entered by broker', tone: 'brand', Icon: Pencil },
  missing: { label: 'Missing', tone: 'neutral', Icon: CircleHelp },
  conflict: { label: 'Conflict', tone: 'danger', Icon: TriangleAlert },
  needs_review: { label: 'Needs Review', tone: 'warning', Icon: CircleAlert },
};

export function ApplicationFieldRow({
  field,
  value,
  onLocalChange,
  onSaveToRiskProfile,
  onResolveConflict,
}: {
  field: MappedField;
  value: string;
  onLocalChange: (value: string) => void;
  /** Present only when field.riskProfilePath exists — lets the broker also persist a manual entry back into the Risk Profile. */
  onSaveToRiskProfile?: (value: string) => void;
  /** Present only for status === 'conflict' — deep-links to the existing Risk Profile conflict resolver. */
  onResolveConflict?: () => void;
}) {
  const [showManualInput, setShowManualInput] = useState(false);
  const [savedToRiskProfile, setSavedToRiskProfile] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const meta = STATUS_META[field.status];
  const hasLocalValue = value.trim() !== '';
  const showEmptyState = field.status === 'missing' && !hasLocalValue && !showManualInput;

  function saveBack() {
    onSaveToRiskProfile?.(value);
    setSavedToRiskProfile(true);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-[var(--color-ink-500)]">
          {field.targetLabel}
          {field.required && <span className="ml-0.5 text-[var(--color-danger-500)]">*</span>}
        </label>
        <Badge tone={meta.tone} className="print:hidden">
          <meta.Icon size={11} />
          {meta.label}
        </Badge>
      </div>

      {field.status === 'conflict' ? (
        <div className="rounded-md border border-[var(--color-danger-100)] bg-[var(--color-danger-100)]/20 px-2.5 py-2 text-xs text-[var(--color-danger-700)]">
          <p className="font-medium">Conflict must be resolved before this field can be completed.</p>
          <p className="mt-1 text-[var(--color-ink-500)]">{field.reviewReason}</p>
          {onResolveConflict && (
            <button
              onClick={onResolveConflict}
              className="mt-1.5 inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer print:hidden"
            >
              Resolve in Risk Profile <ArrowRight size={12} />
            </button>
          )}
        </div>
      ) : showEmptyState ? (
        <div className="rounded-md border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-2.5 py-2">
          <p className="text-xs italic text-[var(--color-ink-400)]">{field.reviewReason ?? 'Not found in uploaded documents.'}</p>
          <button
            onClick={() => setShowManualInput(true)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] underline decoration-dotted underline-offset-2 cursor-pointer print:hidden"
          >
            <Pencil size={11} />
            Enter manually
          </button>
        </div>
      ) : (
        <>
          <input
            autoFocus={showManualInput && !hasLocalValue}
            value={value}
            onChange={(e) => onLocalChange(e.target.value)}
            placeholder={field.status === 'missing' ? field.targetLabel : undefined}
            className={`rounded-md border px-2.5 py-2 text-sm text-[var(--color-ink-900)] outline-none placeholder:italic placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15 print:border-0 print:p-0 ${
              field.status === 'needs_review' ? 'border-[var(--color-warning-300)] bg-[var(--color-warning-100)]/20' : 'border-[var(--color-ink-200)]'
            }`}
          />
          {field.status === 'needs_review' && field.reviewReason && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-600)] print:hidden">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              {field.reviewReason}
            </p>
          )}
        </>
      )}

      {field.status === 'missing' && hasLocalValue && onSaveToRiskProfile && !savedToRiskProfile && (
        <button onClick={saveBack} className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer print:hidden">
          <Save size={10} />
          Also save to Risk Profile
        </button>
      )}
      {savedToRiskProfile && <p className="text-[11px] text-[var(--color-success-600)] print:hidden">Saved to Risk Profile.</p>}

      {field.source && (
        <button
          onClick={() => setShowSource((v) => !v)}
          className="inline-flex items-center gap-1 self-start text-[11px] text-[var(--color-ink-400)] hover:text-[var(--color-ink-600)] cursor-pointer print:hidden"
        >
          <FileText size={10} />
          Where did this come from?
          {showSource ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}
      {showSource && field.source && (
        <div className="rounded-md bg-[var(--color-ink-50)] px-2 py-1.5 text-[11px] text-[var(--color-ink-500)] print:hidden">
          <p className="font-medium text-[var(--color-ink-700)]">
            {field.source.documentName}
            {field.source.page ? `, page ${field.source.page}` : ''}
          </p>
          {field.source.excerpt && <p className="mt-0.5 italic">"{field.source.excerpt}"</p>}
        </div>
      )}
    </div>
  );
}
