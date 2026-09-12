import { useState } from 'react';
import { CircleCheck, CircleHelp, TriangleAlert, CircleAlert, Pencil, Check, X, FileText, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import type { MappedField, MappedFieldStatus } from '../../types';
import { Badge, type BadgeTone } from '../ui';

/** Coverage limits and annual revenue are the monetary fields reachable from this page today — kept as a small local check rather than threading a valueType prop through, since it's just "start the edit from plain digits", not a display change (the value is already formatted via the template's own formatCurrency, see templates.ts). */
function isCurrencyPath(path?: string): boolean {
  return !!path && (path.startsWith('coverage.') || path === 'business.annualRevenue');
}

const STATUS_META: Record<MappedFieldStatus, { label: string; tone: BadgeTone; Icon: typeof CircleCheck }> = {
  auto_filled: { label: 'Auto-filled', tone: 'success', Icon: CircleCheck },
  manually_entered: { label: 'Entered by broker', tone: 'brand', Icon: Pencil },
  missing: { label: 'Missing', tone: 'neutral', Icon: CircleHelp },
  conflict: { label: 'Conflict', tone: 'danger', Icon: TriangleAlert },
  needs_review: { label: 'Needs Review', tone: 'warning', Icon: CircleAlert },
};

/**
 * Edits in place directly against the canonical Risk Profile — no separate local "draft" value
 * that could ever diverge from what Risk Profile shows. `field` always reflects the live profile
 * (mapRiskProfileToApplication is recomputed from it on every render), so once onSaveToRiskProfile
 * commits, this row's own next render already shows the saved value with its real status (typically
 * 'manually_entered', via extractionMethod: 'manual_entry' — see fieldDataStatus/mapField) — the
 * same store actions (updateField/updateCoverage) the main Risk Profile page uses, so provenance,
 * conflict-recalculation, and "never touch unrelated fields" all come for free.
 *
 * A field with no riskProfilePath (DBA, FEIN, City, ZIP — see templates.ts) has nowhere canonical
 * to save to, so onSaveToRiskProfile is undefined for it and it is intentionally NOT editable here:
 * an editable-but-never-persisted value is exactly the bug this component used to have.
 */
export function ApplicationFieldRow({
  field,
  onSaveToRiskProfile,
  onResolveConflict,
}: {
  field: MappedField;
  /** Present only when field.riskProfilePath exists. */
  onSaveToRiskProfile?: (value: string) => void;
  /** Present only for status === 'conflict' — deep-links to the existing Risk Profile conflict resolver. */
  onResolveConflict?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showSource, setShowSource] = useState(false);

  const meta = STATUS_META[field.status];
  const canEdit = !!onSaveToRiskProfile;

  function startEdit() {
    if (field.status === 'missing') {
      setDraft('');
    } else if (isCurrencyPath(field.riskProfilePath)) {
      // Strip back to plain digits so editing starts from "100000", not "$100,000" — easy to
      // backspace/retype. normalizeCurrencyText (applied on save) re-formats it either way.
      setDraft(field.value.replace(/[$,\s]/g, ''));
    } else {
      setDraft(field.value);
    }
    setIsEditing(true);
  }

  function commit() {
    onSaveToRiskProfile?.(draft);
    setIsEditing(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-[var(--color-ink-500)]">
          {field.targetLabel}
          {field.required && <span className="ml-0.5 text-[var(--color-danger-500)]">*</span>}
        </label>
        {!isEditing && (
          <Badge tone={meta.tone} className="print:hidden">
            <meta.Icon size={11} />
            {meta.label}
          </Badge>
        )}
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
      ) : isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded-md border border-[var(--color-brand-500)] px-2.5 py-2 text-sm text-[var(--color-ink-900)] outline-none"
          />
          <button onClick={commit} className="shrink-0 rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
            <Check size={14} />
          </button>
          <button onClick={() => setIsEditing(false)} className="shrink-0 rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
            <X size={14} />
          </button>
        </div>
      ) : field.status === 'missing' ? (
        <div className="rounded-md border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-2.5 py-2">
          <p className="text-xs italic text-[var(--color-ink-400)]">{field.reviewReason ?? 'Not found in uploaded documents.'}</p>
          {canEdit ? (
            <button
              onClick={startEdit}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] underline decoration-dotted underline-offset-2 cursor-pointer print:hidden"
            >
              <Pencil size={11} />
              Enter manually
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--color-ink-400)] print:hidden">Not tracked in the Risk Profile yet.</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <p
            className={`flex-1 rounded-md border px-2.5 py-2 text-sm print:border-0 print:p-0 ${
              field.status === 'needs_review' ? 'border-[var(--color-warning-300)] bg-[var(--color-warning-100)]/20' : 'border-transparent'
            } ${field.value ? 'text-[var(--color-ink-900)]' : 'italic text-[var(--color-ink-400)]'}`}
          >
            {field.value || '—'}
          </p>
          {canEdit && (
            <button onClick={startEdit} className="shrink-0 rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer print:hidden" aria-label="Edit">
              <Pencil size={13} />
            </button>
          )}
        </div>
      )}

      {field.status === 'needs_review' && field.reviewReason && !isEditing && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-600)] print:hidden">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {field.reviewReason}
        </p>
      )}

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
