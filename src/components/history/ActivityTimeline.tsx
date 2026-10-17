import { Clock } from 'lucide-react';
import { EVENT_ICON, EVENT_TONE } from './activityIcons';
import type { ActivityEvent } from '../../types';
import { formatDate } from '../../utils/dates';
import { cn } from '../../utils/cn';
import { useAccountsStore } from '../../state/useAccountsStore';

/** A client submission: exactly what arrived — names as uploaded, who (as given), the reference. */
function ClientSubmissionFacts({ details }: { details: NonNullable<ActivityEvent['details']> }) {
  return (
    <div className="mt-1 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 px-3 py-2 text-xs text-[var(--color-ink-700)]" data-testid="client-submission-facts">
      {details.accountName && <p className="font-semibold text-[var(--color-ink-900)]">{details.accountName}</p>}
      <p>
        {details.files.length} file{details.files.length === 1 ? '' : 's'} received
      </p>
      {details.files.length > 0 && (
        <ul className="mt-0.5 list-disc pl-4">
          {details.files.map((f, i) => (
            <li key={`${f}-${i}`} className="break-all">
              {f}
            </li>
          ))}
        </ul>
      )}
      {details.clientEmail && <p className="mt-1">Submitted by: {details.clientEmail}{details.clientName ? ` (${details.clientName})` : ''} — as entered on the form</p>}
      {!details.clientEmail && details.linkSentTo && <p className="mt-1">Through the secure link sent to: {details.linkSentTo}</p>}
      {details.reference && <p>Reference: {details.reference}</p>}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** Newest-first vertical timeline. Unknown event types (e.g. from a newer client via cloud sync) fall back to a clock icon rather than crashing. */
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const members = useAccountsStore((s) => s.agencyMembers);
  // Who did it: "You", the agency member's current name, or the name saved with the event.
  const actorOf = (e: ActivityEvent): string | null => {
    if (e.type === 'client_submitted') return 'Client';
    if (!e.actorId && !e.actorName) return null;
    if (e.actorId && e.actorId === currentUserId) return 'You';
    return members.find((m) => m.userId === e.actorId)?.name ?? e.actorName ?? null;
  };
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
              {event.type === 'client_submitted' && event.details && <ClientSubmissionFacts details={event.details} />}
              <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">
                {formatTimestamp(event.timestamp)}
                {actorOf(event) && (
                  <>
                    {' · '}
                    <span className="font-medium text-[var(--color-ink-600)]">{actorOf(event)}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
