import type { ApplicationForm } from '../../types';
import { Card, CardBody, CardHeader } from '../ui';

export function ApplicationPreview({
  application,
  values,
  onChange,
}: {
  application: ApplicationForm;
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
              return (
                <div key={id} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[var(--color-ink-500)]">{field.label}</label>
                  {field.editable ? (
                    <input
                      value={values[id] ?? field.value}
                      onChange={(e) => onChange(id, e.target.value)}
                      placeholder="Not provided"
                      className="rounded-md border border-[var(--color-ink-200)] px-2.5 py-2 text-sm text-[var(--color-ink-900)] outline-none placeholder:italic placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15 print:border-0 print:p-0"
                    />
                  ) : (
                    <p className="rounded-md bg-[var(--color-ink-50)] px-2.5 py-2 text-sm text-[var(--color-ink-800)] print:bg-transparent print:p-0">
                      {values[id] ?? field.value}
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
