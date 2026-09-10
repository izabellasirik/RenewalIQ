import { useState } from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, CircleX, Info, Pencil, Check, X } from 'lucide-react';
import type { RiskProfile, UploadedDocument, DriverEntry, VehicleEntry, LossEntry, CoverageType } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { Drawer, Badge, type BadgeTone } from '../ui';
import { fieldPathLabel, fieldPathValueType, DRIVER_FIELD_LABELS, VEHICLE_FIELD_LABELS, LOSS_FIELD_LABELS } from '../../utils/fieldLabels';
import { summarizeDocumentExtraction, scalarFieldValue, type DocumentFieldSummary } from '../../utils/documentExtractionSummary';
import { displayReadValue, parseDraft, ValueInput } from '../riskProfile/FieldRow';
import { countExtractedFields } from '../../utils/fieldCount';

/**
 * The broker-facing status for one document's contribution to a field — deliberately reduced to
 * the four states worth a badge (Applied / Conflict / Needs Review / Broker Edited), never raw
 * confidence. A document's own extraction confidence still lives on the data (FieldValue.confidence,
 * DocumentExtractedField.confidence) and still drives merge/conflict logic in
 * services/extraction — this is purely a display simplification for this panel.
 */
function simplifiedStatus(summary: DocumentFieldSummary, profile: RiskProfile): { label: string; tone: BadgeTone } | null {
  if (summary.fieldPath === 'drivers' || summary.fieldPath === 'vehicles' || summary.fieldPath === 'lossHistory') {
    const rows = summary.fieldPath === 'drivers' ? profile.drivers : summary.fieldPath === 'vehicles' ? profile.vehicles : profile.lossHistory;
    const row = summary.rowId ? rows.find((r) => r.id === summary.rowId) : undefined;
    if (row?.isManual) return { label: 'Broker Edited', tone: 'brand' };
  } else if (summary.fieldPath !== 'coverageLine') {
    const current = scalarFieldValue(profile, summary.fieldPath);
    if (current?.extractionMethod === 'manual_entry') return { label: 'Broker Edited', tone: 'brand' };
  }
  if (summary.disposition === 'conflict') return { label: 'Conflict', tone: 'danger' };
  if (summary.disposition === 'needs_review') return { label: 'Needs Review', tone: 'warning' };
  if (summary.disposition === 'applied') return { label: 'Applied', tone: 'success' };
  // 'superseded' / 'not_applied': not one of the four statuses worth a badge here — the scalar row
  // still shows what the Risk Profile currently has instead (see the 'superseded' text below), so
  // nothing is silently hidden, it's just not given badge-level prominence.
  return null;
}

function StatusBadge({ status }: { status: { label: string; tone: BadgeTone } }) {
  const Icon = status.tone === 'success' ? CircleCheck : status.tone === 'warning' ? CircleAlert : status.tone === 'danger' ? TriangleAlert : Pencil;
  return (
    <Badge tone={status.tone}>
      <Icon size={12} />
      {status.label}
    </Badge>
  );
}

const SECTION_ORDER = ['business_transportation', 'coverage', 'drivers', 'vehicles', 'lossHistory'] as const;
const SECTION_TITLES: Record<(typeof SECTION_ORDER)[number], string> = {
  business_transportation: 'Business & Operations',
  coverage: 'Coverage',
  drivers: 'Drivers',
  vehicles: 'Vehicles',
  lossHistory: 'Loss History',
};

function sectionFor(fieldPath: string): (typeof SECTION_ORDER)[number] {
  if (fieldPath === 'drivers') return 'drivers';
  if (fieldPath === 'vehicles') return 'vehicles';
  if (fieldPath === 'lossHistory') return 'lossHistory';
  if (fieldPath.startsWith('coverage.') || fieldPath === 'coverageLine') return 'coverage';
  return 'business_transportation';
}

interface UpdateHandlers {
  onUpdateField?: (section: 'business' | 'transportation', key: string, value: unknown) => void;
  onUpdateCoverage?: (coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
  onUpdateVehicle?: (id: string, patch: Partial<VehicleEntry>) => void;
  onUpdateDriver?: (id: string, patch: Partial<DriverEntry>) => void;
  onUpdateLoss?: (id: string, patch: Partial<LossEntry>) => void;
}

function ScalarFieldRow({ summary, profile, onUpdateField, onUpdateCoverage }: { summary: DocumentFieldSummary; profile: RiskProfile } & Pick<UpdateHandlers, 'onUpdateField' | 'onUpdateCoverage'>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const status = simplifiedStatus(summary, profile);
  const valueType = fieldPathValueType(summary.fieldPath);
  // 'coverageLine' is a membership marker (this coverage type was requested), not a value — nothing to edit.
  const canEdit = summary.fieldPath !== 'coverageLine' && (!!onUpdateField || !!onUpdateCoverage);
  // Shows the LIVE canonical value, not a frozen snapshot of what this document originally read —
  // once editing is possible from this panel, the display has to reflect a save immediately, the
  // same way the main Risk Profile page's FieldRow always shows the current value. Falls back to
  // this document's own extracted value only when the field currently has nothing live (e.g. it was
  // since cleared) — see disposition/StatusBadge for whether that still matches what this document said.
  const current = summary.fieldPath === 'coverageLine' ? undefined : scalarFieldValue(profile, summary.fieldPath);
  const displayValue = current && !current.isMissing ? current.value : summary.value;

  function startEdit() {
    setDraft(displayReadValue(displayValue));
    setIsEditing(true);
  }

  function commit() {
    const value = parseDraft(valueType, draft);
    if (summary.fieldPath.startsWith('coverage.')) {
      const [, coverageType, sub] = summary.fieldPath.split('.') as [string, CoverageType, 'currentLimit' | 'requestedLimit'];
      onUpdateCoverage?.(coverageType, sub, (value ?? '') as string);
    } else {
      const [section, key] = summary.fieldPath.split('.') as ['business' | 'transportation', string];
      onUpdateField?.(section, key, value);
    }
    setIsEditing(false);
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--color-ink-500)]">{fieldPathLabel(summary.fieldPath)}</p>
          {!isEditing ? (
            <p className="mt-0.5 text-sm font-medium text-[var(--color-ink-900)]">{displayReadValue(displayValue) || '—'}</p>
          ) : (
            <div className="mt-1">
              <ValueInput valueType={valueType} value={draft} onChange={setDraft} autoFocus />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isEditing ? (
            <>
              {status && <StatusBadge status={status} />}
              {canEdit && (
                <button onClick={startEdit} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-ink-500)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer">
                  <Pencil size={12} />
                  Edit
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={commit} className="rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
                <Check size={13} />
              </button>
              <button onClick={() => setIsEditing(false)} className="rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const NUMERIC_ROW_KEYS: Record<'drivers' | 'vehicles' | 'lossHistory', string[]> = {
  drivers: ['yearsExperience'],
  vehicles: ['year', 'value'],
  lossHistory: ['paid', 'reserved', 'incurred'],
};
const BOOLEAN_ROW_KEYS: Record<'drivers' | 'vehicles' | 'lossHistory', string[]> = {
  drivers: ['isCDL'],
  vehicles: [],
  lossHistory: [],
};

function RowEntryCard({
  summary,
  profile,
  fieldLabels,
  title,
  rowKind,
  onUpdate,
}: {
  summary: DocumentFieldSummary;
  profile: RiskProfile;
  fieldLabels: Record<string, string>;
  title: string;
  rowKind: 'drivers' | 'vehicles' | 'lossHistory';
  onUpdate?: (id: string, patch: Record<string, unknown>) => void;
}) {
  // Shows the LIVE canonical row (looked up by rowId) when one is known, not a frozen snapshot of
  // what this document originally read — the same reasoning as ScalarFieldRow's displayValue, so a
  // save is reflected immediately and any current conflicts/fieldConfidence shown are the row's
  // real, present-day ones. Falls back to the document's own extracted value when no live row
  // matches (rowId undefined) — in that case editing is disabled too, since there's nothing to edit.
  const rows = rowKind === 'drivers' ? profile.drivers : rowKind === 'vehicles' ? profile.vehicles : profile.lossHistory;
  const canonicalRow = summary.rowId ? rows.find((r) => r.id === summary.rowId) : undefined;
  const entry = (canonicalRow ?? summary.value) as Record<string, unknown>;
  const conflicts = (entry.conflicts ?? {}) as Partial<Record<string, { value: unknown; extractionMethod: string }[]>>;
  const subFields = Object.entries(entry).filter(([key, value]) => fieldLabels[key] && value !== undefined && value !== null && value !== '');

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const status = simplifiedStatus(summary, profile);
  // Editing only makes sense once we know which real, currently-live profile row this document's
  // contribution corresponds to (see rowDisposition in documentExtractionSummary.ts) — a row this
  // document contributed that's no longer reflected anywhere in the profile has nothing to edit.
  const canEdit = !!summary.rowId && !!onUpdate;

  function startEdit() {
    const initial: Record<string, string> = {};
    for (const [key, value] of subFields) initial[key] = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
    setDraft(initial);
    setIsEditing(true);
  }

  function commit() {
    if (!summary.rowId) return;
    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(draft)) {
      if (raw.trim() === '') continue; // never blank out a field the row already had — only changed/filled values are sent
      if (BOOLEAN_ROW_KEYS[rowKind].includes(key)) patch[key] = raw === 'Yes';
      else if (NUMERIC_ROW_KEYS[rowKind].includes(key)) patch[key] = Number(raw.replace(/,/g, ''));
      else patch[key] = raw.trim();
    }
    onUpdate?.(summary.rowId, patch);
    setIsEditing(false);
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--color-ink-500)]">{title}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isEditing ? (
            <>
              {status && <StatusBadge status={status} />}
              {canEdit && (
                <button onClick={startEdit} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-ink-500)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer">
                  <Pencil size={12} />
                  Edit
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={commit} className="rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save">
                <Check size={13} />
              </button>
              <button onClick={() => setIsEditing(false)} className="rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {subFields.map(([key, value]) => (
          <div key={key}>
            <p className="text-xs text-[var(--color-ink-400)]">{fieldLabels[key]}</p>
            {!isEditing ? (
              <>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <p className="text-sm font-medium text-[var(--color-ink-900)]">{displayReadValue(value)}</p>
                  {conflicts[key] && <TriangleAlert size={13} className="shrink-0 text-[var(--color-danger-600)]" aria-label="Conflict" />}
                </div>
                {conflicts[key]?.[0] && <p className="mt-0.5 text-xs italic text-[var(--color-danger-600)]">OCR read: {displayReadValue(conflicts[key]![0].value)}</p>}
              </>
            ) : (
              <input
                className="mt-0.5 w-full rounded-md border border-[var(--color-brand-500)] px-1.5 py-1 text-sm outline-none"
                value={draft[key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentExtractionDetail({
  open,
  onClose,
  document,
  profile,
  onUpdateField,
  onUpdateCoverage,
  onUpdateVehicle,
  onUpdateDriver,
  onUpdateLoss,
}: {
  open: boolean;
  onClose: () => void;
  document: UploadedDocument | null;
  profile: RiskProfile;
} & UpdateHandlers) {
  if (!document) return <Drawer open={open} onClose={onClose} title="Extracted Data"><></></Drawer>;

  const summaries = summarizeDocumentExtraction(document, profile);
  // Always derived from the SAME list rendered below, never from document.fieldsExtracted (a
  // separately-persisted number computed at upload time) — those two going out of sync for any
  // document processed before extractedFields existed on UploadedDocument is exactly what
  // previously produced "11 fields extracted" next to "No fields were extracted from this
  // document." Deriving the count from what's actually displayed makes that contradiction
  // structurally impossible, not just less likely.
  const visibleFieldCount = countExtractedFields(summaries);
  const bySection = new Map<(typeof SECTION_ORDER)[number], DocumentFieldSummary[]>();
  for (const s of summaries) {
    const section = sectionFor(s.fieldPath);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(s);
  }

  return (
    <Drawer open={open} onClose={onClose} title="Extracted Data" subtitle={document.name}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{DOCUMENT_CATEGORY_LABELS[document.category]}</Badge>
          {document.status === 'error' && (
            <Badge tone="danger">
              <CircleX size={12} />
              Could not read this document
            </Badge>
          )}
          <span className="text-xs text-[var(--color-ink-400)]">{visibleFieldCount} field{visibleFieldCount === 1 ? '' : 's'} extracted</span>
        </div>

        {document.warnings && document.warnings.length > 0 && (
          <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/30 px-3 py-2.5 text-sm text-[var(--color-ink-700)]">
            {document.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        {summaries.length === 0 && document.status !== 'error' && (
          <p className="text-sm italic text-[var(--color-ink-400)]">No fields were extracted from this document.</p>
        )}

        {SECTION_ORDER.map((section) => {
          const items = bySection.get(section);
          if (!items || items.length === 0) return null;
          return (
            <div key={section}>
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink-800)]">{SECTION_TITLES[section]}</h3>
              <div className="space-y-2">
                {items.map((s, i) =>
                  s.fieldPath === 'drivers' ? (
                    <RowEntryCard key={i} summary={s} profile={profile} fieldLabels={DRIVER_FIELD_LABELS} title="Driver" rowKind="drivers" onUpdate={onUpdateDriver as (id: string, patch: Record<string, unknown>) => void} />
                  ) : s.fieldPath === 'vehicles' ? (
                    <RowEntryCard key={i} summary={s} profile={profile} fieldLabels={VEHICLE_FIELD_LABELS} title="Vehicle" rowKind="vehicles" onUpdate={onUpdateVehicle as (id: string, patch: Record<string, unknown>) => void} />
                  ) : s.fieldPath === 'lossHistory' ? (
                    <RowEntryCard key={i} summary={s} profile={profile} fieldLabels={LOSS_FIELD_LABELS} title="Loss/Claim" rowKind="lossHistory" onUpdate={onUpdateLoss as (id: string, patch: Record<string, unknown>) => void} />
                  ) : (
                    <ScalarFieldRow key={i} summary={s} profile={profile} onUpdateField={onUpdateField} onUpdateCoverage={onUpdateCoverage} />
                  )
                )}
              </div>
            </div>
          );
        })}

        {document.candidateNotes && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink-800)]">Additional Information Noted</h3>
            <div className="rounded-lg border border-[var(--color-info-100)] bg-[var(--color-info-100)]/30 px-3 py-2.5 text-sm text-[var(--color-ink-700)]">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-500)]">
                <Info size={12} />
                Readable but not automatically filed to a field
              </p>
              {document.candidateNotes}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
