import { Clock } from 'lucide-react';
import type { ActivityEvent } from '../../types';
import { Drawer, EmptyState } from '../ui';
import { ActivityTimeline } from './ActivityTimeline';

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
  return (
    <Drawer open={open} onClose={onClose} title="Submission History" subtitle={accountName}>
      {events.length === 0 ? (
        <EmptyState icon={<Clock size={24} strokeWidth={1.5} />} title="No activity yet" description="Actions taken on this submission will show up here." />
      ) : (
        <ActivityTimeline events={events} />
      )}
    </Drawer>
  );
}
