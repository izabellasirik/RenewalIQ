import { TriangleAlert } from 'lucide-react';
import type { MappedApplication } from '../../types';
import { Card, CardBody, CardHeader, ConfidenceBadge } from '../ui';

export function ApplicationPreview({
  application,
  values,
  onChange,
}: {
  application: MappedApplication;
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5 print:gap-3">
      {application.sections.map((section, sIdx) => (
        <Card key={section.title} className="print:border-0 print:shadow-none">
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{section.title}</h3>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
            {section.fields.map((field, fIdx) => {
              const id = `${sIdx}-${fIdx}`;
              const needsReview = field.status === 'needs_review';
              return (
                <div key={id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-[var(--color-ink-500)]">{field.targetLabel}</label>
                    {field.confidence && <ConfidenceBadge confidence={field.confidence} className="print:hidden" />}
                  </div>
                  {field.editable ? (
                    <input
                      value={values[id] ?? field.value}
                      onChange={(e) => onChange(id, e.target.value)}
                      placeholder="Not provided"
                      className={`rounded-md border px-2.5 py-2 text-sm text-[var(--color-ink-900)] outline-none placeholder:italic placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15 print:border-0 print:p-0 ${needsReview ? 'border-[var(--color-warning-300)] bg-[var(--color-warning-100)]/20' : 'border-[var(--color-ink-200)]'}`}
                    />
                  ) : (
                    <p className={`rounded-md px-2.5 py-2 text-sm text-[var(--color-ink-800)] print:bg-transparent print:p-0 ${needsReview ? 'bg-[var(--color-warning-100)]/20' : 'bg-[var(--color-ink-50)]'}`}>
                      {values[id] ?? field.value}
                    </p>
                  )}
                  {needsReview && (
                    <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-600)] print:hidden">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                      {field.reviewReason}
                    </p>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
