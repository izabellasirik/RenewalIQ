import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '../ui';

export function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{description}</p>}
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-1 pt-2">{children}</CardBody>
    </Card>
  );
}
