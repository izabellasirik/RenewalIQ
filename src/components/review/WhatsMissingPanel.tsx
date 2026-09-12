import { useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, FileWarning, TriangleAlert, CircleHelp, Pencil, Check, X } from 'lucide-react';
import { Drawer, Badge, ProgressBar, type BadgeTone } from '../ui';
import { isSubmissionComplete, type CompletenessItem, type SubmissionCompleteness } from '../../services/application';
import { ValueInput, parseDraft } from '../riskProfile/FieldRow';
import { fieldPathValueType } from '../../utils/fieldLabels';
import { parseRiskProfilePath } from '../../utils/riskProfilePath';
import { normalizeCurrencyText } from '../../utils/currency';
import type { CoverageType } from '../../types';

export interface WhatsMissingUpdateHandlers {
  onUpdateField: (section: 'business' | 'transportation', key: string, value: unknown) => void;
  onUpdateCoverage: (coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
}

/**
 * One missing-field item, editable in place when it has a riskProfilePath — same canonical
 * updateField/updateCoverage store actions Risk Profile and Submission Assistant already use, so
 * there's no second copy of the data anywhere: saving here IS saving to the Risk Profile. Once
 * saved, the parent recomputes completeness from the live profile and this item simply stops being
 * in the list on the next render — nothing here removes it directly.
 */
function EditableItem({ item, onUpdateField, onUpdateCoverage }: { item: CompletenessItem } & WhatsMissingUpdateHandlers) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const target = item.riskProfilePath ? parseRiskProfilePath(item.riskProfilePath) : null;
  const valueType = item.riskProfilePath ? fieldPathValueType(item.riskProfilePath) : 'text';
  const canEdit = !!target;

  function startEdit() {
    setDraft('');
    setIsEditing(true);
  }

  function commit() {
    if (!target) return;
    if (target.kind === 'field') {
      onUpdateField(target.section, target.key, parseDraft(valueType, draft));
    } else {
      // Coverage limits are free text (a broker can write "$1M/$2M CSL"), but a plain-digit entry
      // like "100000" is normalized to "$100,000" — same rule every other coverage editor applies.
      onUpdateCoverage(target.coverageType, target.field, normalizeCurrencyText(draft));
    }
    setIsEditing(false);
  }

  return (
    <li className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-ink-800)]">{item.label}</p>
          {!isEditing && item.detail && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{item.detail}</p>}
          {isEditing && (
            <div className="mt-1.5">
              <ValueInput valueType={valueType} value={draft} onChange={setDraft} autoFocus />
            </div>
          )}
        </div>
        {canEdit &&
          (!isEditing ? (
            <button
              onClick={startEdit}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
            >
              <Pencil size={12} />
              Edit / Add value
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={commit} className="rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
                <Check size={13} />
              </button>
              <button onClick={() => setIsEditing(false)} className="rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
                <X size={13} />
              </button>
            </div>
          ))}
      </div>
    </li>
  );
}

function ReadOnlyItem({ item }: { item: CompletenessItem }) {
  return (
    <li className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
      <p className="text-sm font-medium text-[var(--color-ink-800)]">{item.label}</p>
      {item.detail && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{item.detail}</p>}
    </li>
  );
}

function Section({
  title,
  icon,
  tone,
  items,
  editable,
  update,
}: {
  title: string;
  icon: ReactNode;
  tone: BadgeTone;
  items: CompletenessItem[];
  editable?: boolean;
  update?: WhatsMissingUpdateHandlers;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)]">
        {icon}
        {title}
        <Badge tone={tone}>{items.length}</Badge>
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item, i) =>
          editable && update ? <EditableItem key={i} item={item} onUpdateField={update.onUpdateField} onUpdateCoverage={update.onUpdateCoverage} /> : <ReadOnlyItem key={i} item={item} />
        )}
      </ul>
    </div>
  );
}

export function WhatsMissingPanel({
  open,
  onClose,
  completeness,
  onUpdateField,
  onUpdateCoverage,
}: {
  open: boolean;
  onClose: () => void;
  completeness: SubmissionCompleteness;
} & WhatsMissingUpdateHandlers) {
  const complete = isSubmissionComplete(completeness);
  const update = { onUpdateField, onUpdateCoverage };

  return (
    <Drawer open={open} onClose={onClose} title="What's Missing?" subtitle={`${completeness.percent}% of required fields complete`}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-[var(--color-ink-700)]">Required fields filled</span>
            <span className="font-semibold text-[var(--color-ink-900)]">{completeness.percent}%</span>
          </div>
          <ProgressBar value={completeness.percent} className="mt-1.5" />
        </div>

        {complete ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-[var(--color-success-100)] bg-[var(--color-success-100)]/30 px-4 py-8 text-center">
            <CheckCircle2 size={24} className="text-[var(--color-success-600)]" />
            <p className="text-sm font-medium text-[var(--color-ink-800)]">Nothing outstanding.</p>
            <p className="text-xs text-[var(--color-ink-500)]">Every required field, recommended field, and recommended document Renewal IQ tracks is accounted for.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Section title="Missing Required Fields" icon={<CircleAlert size={15} className="text-[var(--color-danger-600)]" />} tone="danger" items={completeness.missingRequiredFields} editable update={update} />
            <Section title="Conflicts" icon={<TriangleAlert size={15} className="text-[var(--color-danger-600)]" />} tone="danger" items={completeness.conflicts} />
            <Section title="Needs Review" icon={<CircleHelp size={15} className="text-[var(--color-warning-600)]" />} tone="warning" items={completeness.needsReview} />
            <Section
              title="Missing Recommended Fields"
              icon={<CircleAlert size={15} className="text-[var(--color-warning-600)]" />}
              tone="warning"
              items={completeness.missingRecommendedFields}
              editable
              update={update}
            />
            <Section title="Missing Recommended Documents" icon={<FileWarning size={15} className="text-[var(--color-warning-600)]" />} tone="warning" items={completeness.missingRecommendedDocuments} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
