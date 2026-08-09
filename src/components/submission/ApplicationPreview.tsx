import type { MappedApplication } from '../../types';
import { Card, CardBody, CardHeader } from '../ui';
import { ApplicationFieldRow } from './ApplicationFieldRow';
import { ApplicationTableSection } from './ApplicationTableSection';

export function ApplicationPreview({
  application,
  values,
  onChange,
  onSaveToRiskProfile,
  onResolveConflict,
}: {
  application: MappedApplication;
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  onSaveToRiskProfile: (field: MappedApplication['sections'][number]['fields'][number], value: string) => void;
  onResolveConflict: (field: MappedApplication['sections'][number]['fields'][number]) => void;
}) {
  return (
    <div className="flex flex-col gap-5 print:gap-3">
      {application.sections.map((section, sIdx) => (
        <Card key={section.title} className="print:border-0 print:shadow-none">
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{section.title}</h3>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            {section.fields.map((field, fIdx) => {
              const id = `${sIdx}-${fIdx}`;
              return (
                <ApplicationFieldRow
                  key={id}
                  field={field}
                  value={values[id] ?? field.value}
                  onLocalChange={(value) => onChange(id, value)}
                  onSaveToRiskProfile={field.riskProfilePath ? (value) => onSaveToRiskProfile(field, value) : undefined}
                  onResolveConflict={field.status === 'conflict' ? () => onResolveConflict(field) : undefined}
                />
              );
            })}
          </CardBody>
        </Card>
      ))}

      {application.tableSections.map((table) => (
        <ApplicationTableSection key={table.title} table={table} />
      ))}
    </div>
  );
}
