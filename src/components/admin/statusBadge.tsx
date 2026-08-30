import type { AppetiteUpdateStatus } from '../../types';
import { Badge, type BadgeTone } from '../ui';

export const STATUS_LABELS: Record<AppetiteUpdateStatus, string> = {
  pending: 'Pending',
  needs_more_information: 'Needs More Information',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_TONES: Record<AppetiteUpdateStatus, BadgeTone> = {
  pending: 'info',
  needs_more_information: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function AppetiteUpdateStatusBadge({ status, className }: { status: AppetiteUpdateStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
