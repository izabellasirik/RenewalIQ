import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, FileWarning, TriangleAlert, CircleHelp } from 'lucide-react';
import { Drawer, Badge, ProgressBar, type BadgeTone } from '../ui';
import { isSubmissionComplete, type CompletenessItem, type SubmissionCompleteness } from '../../services/application';

function Section({ title, icon, tone, items }: { title: string; icon: ReactNode; tone: BadgeTone; items: CompletenessItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)]">
        {icon}
        {title}
        <Badge tone={tone}>{items.length}</Badge>
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
            <p className="text-sm font-medium text-[var(--color-ink-800)]">{item.label}</p>
            {item.detail && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{item.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatsMissingPanel({ open, onClose, completeness }: { open: boolean; onClose: () => void; completeness: SubmissionCompleteness }) {
  const complete = isSubmissionComplete(completeness);

  return (
    <Drawer open={open} onClose={onClose} title="What's Missing?" subtitle={`Submission ${completeness.percent}% complete`}>
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
            <Section title="Missing Required Fields" icon={<CircleAlert size={15} className="text-[var(--color-danger-600)]" />} tone="danger" items={completeness.missingRequiredFields} />
            <Section title="Conflicts" icon={<TriangleAlert size={15} className="text-[var(--color-danger-600)]" />} tone="danger" items={completeness.conflicts} />
            <Section title="Needs Review" icon={<CircleHelp size={15} className="text-[var(--color-warning-600)]" />} tone="warning" items={completeness.needsReview} />
            <Section title="Missing Recommended Fields" icon={<CircleAlert size={15} className="text-[var(--color-warning-600)]" />} tone="warning" items={completeness.missingRecommendedFields} />
            <Section title="Missing Recommended Documents" icon={<FileWarning size={15} className="text-[var(--color-warning-600)]" />} tone="warning" items={completeness.missingRecommendedDocuments} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
