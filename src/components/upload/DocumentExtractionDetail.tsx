import { useState } from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, CircleX, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { RiskProfile, UploadedDocument, Confidence } from '../../types';
import { DOCUMENT_CATEGORY_LABELS } from '../../types';
import { Drawer, Badge, ConfidenceBadge } from '../ui';
import { fieldPathLabel, DRIVER_FIELD_LABELS, VEHICLE_FIELD_LABELS, LOSS_FIELD_LABELS } from '../../utils/fieldLabels';
import { summarizeDocumentExtraction, FIELD_DISPOSITION_LABELS, type DocumentFieldSummary, type FieldDisposition } from '../../utils/documentExtractionSummary';
import { displayReadValue } from '../riskProfile/FieldRow';
import { countExtractedFields } from '../../utils/fieldCount';

const DISPOSITION_ICON: Record<FieldDisposition, typeof CircleCheck> = {
  applied: CircleCheck,
  needs_review: CircleAlert,
  conflict: TriangleAlert,
  superseded: Info,
  not_applied: Info,
};

const DISPOSITION_TONE: Record<FieldDisposition, 'success' | 'warning' | 'danger' | 'neutral'> = {
  applied: 'success',
  needs_review: 'warning',
  conflict: 'danger',
  superseded: 'neutral',
  not_applied: 'neutral',
};

function DispositionBadge({ disposition }: { disposition: FieldDisposition }) {
  const Icon = DISPOSITION_ICON[disposition];
  return (
    <Badge tone={DISPOSITION_TONE[disposition]}>
      <Icon size={12} />
      {FIELD_DISPOSITION_LABELS[disposition]}
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

function ScalarFieldRow({ summary }: { summary: DocumentFieldSummary }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--color-ink-500)]">{fieldPathLabel(summary.fieldPath)}</p>
        <p className="mt-0.5 text-sm font-medium text-[var(--color-ink-900)]">{displayReadValue(summary.value) || '—'}</p>
        {summary.disposition === 'superseded' && (
          <p className="mt-1 text-xs text-[var(--color-ink-400)]">Risk Profile currently shows: <span className="font-medium">{displayReadValue(summary.currentValue)}</span></p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ConfidenceBadge confidence={summary.confidence as Confidence} />
        <DispositionBadge disposition={summary.disposition} />
      </div>
    </div>
  );
}

function RowEntryCard({ summary, fieldLabels, title }: { summary: DocumentFieldSummary; fieldLabels: Record<string, string>; title: string }) {
  const entry = summary.value as Record<string, unknown>;
  const fieldConfidence = (entry.fieldConfidence ?? {}) as Partial<Record<string, Confidence>>;
  const conflicts = (entry.conflicts ?? {}) as Partial<Record<string, { value: unknown; extractionMethod: string }[]>>;
  const subFields = Object.entries(entry).filter(([key, value]) => fieldLabels[key] && value !== undefined && value !== null && value !== '');

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--color-ink-500)]">{title}</p>
        <DispositionBadge disposition={summary.disposition} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {subFields.map(([key, value]) => (
          <div key={key}>
            <p className="text-xs text-[var(--color-ink-400)]">{fieldLabels[key]}</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <p className="text-sm font-medium text-[var(--color-ink-900)]">{displayReadValue(value)}</p>
              {fieldConfidence[key] === 'low' && <CircleAlert size={13} className="shrink-0 text-[var(--color-warning-600)]" aria-label="Needs review" />}
              {conflicts[key] && <TriangleAlert size={13} className="shrink-0 text-[var(--color-danger-600)]" aria-label="Conflict" />}
            </div>
            {conflicts[key]?.[0] && (
              <p className="mt-0.5 text-xs italic text-[var(--color-danger-600)]">
                OCR read: {displayReadValue(conflicts[key]![0].value)}
              </p>
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
}: {
  open: boolean;
  onClose: () => void;
  document: UploadedDocument | null;
  profile: RiskProfile;
}) {
  const [showRaw, setShowRaw] = useState(false);

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
                    <RowEntryCard key={i} summary={s} fieldLabels={DRIVER_FIELD_LABELS} title="Driver" />
                  ) : s.fieldPath === 'vehicles' ? (
                    <RowEntryCard key={i} summary={s} fieldLabels={VEHICLE_FIELD_LABELS} title="Vehicle" />
                  ) : s.fieldPath === 'lossHistory' ? (
                    <RowEntryCard key={i} summary={s} fieldLabels={LOSS_FIELD_LABELS} title="Loss/Claim" />
                  ) : (
                    <ScalarFieldRow key={i} summary={s} />
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

        {summaries.length > 0 && (
          <div className="border-t border-[var(--color-ink-100)] pt-3">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer"
            >
              {showRaw ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Advanced: raw extraction data
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--color-ink-50)] p-3 text-[11px] text-[var(--color-ink-600)]">
                {JSON.stringify(document.extractedFields, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
