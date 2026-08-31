import type { FeedbackStatus } from '../../types';
import { FEEDBACK_STATUS_LABELS } from '../../types';
import { Badge, type BadgeTone } from '../ui';

const FEEDBACK_STATUS_TONES: Record<FeedbackStatus, BadgeTone> = {
  new: 'info',
  reviewed: 'warning',
  resolved: 'success',
};

export function FeedbackStatusBadge({ status, className }: { status: FeedbackStatus; className?: string }) {
  return (
    <Badge tone={FEEDBACK_STATUS_TONES[status]} className={className}>
      {FEEDBACK_STATUS_LABELS[status]}
    </Badge>
  );
}
