import {
  PlusCircle,
  Copy,
  UploadCloud,
  ScanLine,
  Trash2,
  CheckCircle2,
  Pencil,
  GitMerge,
  DollarSign,
  Compass,
  Clock,
  ListPlus,
  UserPlus,
  UserCog,
  UserMinus,
  Mail,
  CalendarClock,
  PackageCheck,
  Ban,
  Send,
  Building2,
  FileQuestion,
  StickyNote,
  BadgeDollarSign,
  XCircle,
  ArrowRightLeft,
  ShieldCheck,
  Flag,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityEvent, ActivityEventType } from '../../types';
import { formatDate } from '../../utils/dates';
import { cn } from '../../utils/cn';

const EVENT_ICON: Record<ActivityEventType, LucideIcon> = {
  account_created: PlusCircle,
  account_duplicated: Copy,
  document_uploaded: UploadCloud,
  document_processed: ScanLine,
  document_deleted: Trash2,
  field_completed: CheckCircle2,
  field_corrected: Pencil,
  conflict_resolved: GitMerge,
  coverage_edited: DollarSign,
  coverage_added: ListPlus,
  coverage_deleted: Trash2,
  record_added: ListPlus,
  record_edited: Pencil,
  record_deleted: Trash2,
  matching_run: Compass,
  account_updated: Pencil,
  stage_changed: Flag,
  broker_assigned: UserCog,
  contact_added: UserPlus,
  contact_updated: UserCog,
  contact_removed: UserMinus,
  item_added: ListPlus,
  item_requested: Mail,
  follow_up_scheduled: CalendarClock,
  follow_up_completed: CheckCircle2,
  item_received: PackageCheck,
  item_waived: Ban,
  item_removed: Trash2,
  item_sent_to_carrier: Send,
  market_added: Building2,
  market_removed: Trash2,
  submission_sent: Send,
  carrier_requested_item: FileQuestion,
  carrier_note_added: StickyNote,
  quote_received: BadgeDollarSign,
  carrier_declined: XCircle,
  quote_status_changed: ArrowRightLeft,
  policy_bound: ShieldCheck,
};

const EVENT_TONE: Partial<Record<ActivityEventType, string>> = {
  item_received: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]',
  quote_received: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]',
  policy_bound: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]',
  carrier_declined: 'bg-[var(--color-danger-100)] text-[var(--color-danger-600)]',
  carrier_requested_item: 'bg-[var(--color-warning-100)] text-[var(--color-warning-600)]',
  item_requested: 'bg-[var(--color-info-100)] text-[var(--color-info-600)]',
  submission_sent: 'bg-[var(--color-info-100)] text-[var(--color-info-600)]',
  item_sent_to_carrier: 'bg-[var(--color-info-100)] text-[var(--color-info-600)]',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** Newest-first vertical timeline. Unknown event types (e.g. from a newer client via cloud sync) fall back to a clock icon rather than crashing. */
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return (
    <ol className="flex flex-col gap-1">
      {sorted.map((event, i) => {
        const Icon = EVENT_ICON[event.type] ?? Clock;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 pl-1 last:pb-0">
            {i < sorted.length - 1 && <span className="absolute left-[15px] top-7 h-full w-px bg-[var(--color-ink-100)]" />}
            <span className={cn('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', EVENT_TONE[event.type] ?? 'bg-[var(--color-ink-50)] text-[var(--color-ink-500)]')}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 pt-1">
              <p className="break-words text-sm text-[var(--color-ink-800)]">{event.message}</p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">{formatTimestamp(event.timestamp)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
