import {
  PlusCircle,
  Copy,
  UploadCloud,
  ScanLine,
  CheckCircle2,
  Pencil,
  GitMerge,
  DollarSign,
  Compass,
  Clock,
} from 'lucide-react';
import type { ActivityEvent, ActivityEventType } from '../../types';
import { Drawer, EmptyState } from '../ui';
import { formatDate } from '../../utils/dates';

const EVENT_ICON: Record<ActivityEventType, typeof PlusCircle> = {
  account_created: PlusCircle,
  account_duplicated: Copy,
  document_uploaded: UploadCloud,
  document_processed: ScanLine,
  field_completed: CheckCircle2,
  field_corrected: Pencil,
  conflict_resolved: GitMerge,
  coverage_edited: DollarSign,
  matching_run: Compass,
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function HistoryDrawer({
  open,
  onClose,
  accountName,
  events,
}: {
  open: boolean;
  onClose: () => void;
  accountName: string;
  events: ActivityEvent[];
}) {
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <Drawer open={open} onClose={onClose} title="Submission History" subtitle={accountName}>
      {sorted.length === 0 ? (
        <EmptyState icon={<Clock size={24} strokeWidth={1.5} />} title="No activity yet" description="Actions taken on this submission will show up here." />
      ) : (
        <ol className="flex flex-col gap-1">
          {sorted.map((event, i) => {
            const Icon = EVENT_ICON[event.type];
            return (
              <li key={event.id} className="relative flex gap-3 pb-5 pl-1 last:pb-0">
                {i < sorted.length - 1 && <span className="absolute left-[15px] top-7 h-full w-px bg-[var(--color-ink-100)]" />}
                <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink-50)] text-[var(--color-ink-500)]">
                  <Icon size={15} />
                </span>
                <div className="pt-1">
                  <p className="text-sm text-[var(--color-ink-800)]">{event.message}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">{formatTimestamp(event.timestamp)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Drawer>
  );
}
