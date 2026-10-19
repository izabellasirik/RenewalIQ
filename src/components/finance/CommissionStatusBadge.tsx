import { Badge, type BadgeTone } from '../ui';
import { STATUS_LABELS, type LedgerStatus } from '../../services/finance/ledger';

const TONES: Record<LedgerStatus, BadgeTone> = {
  missing_proof: 'warning',
  pending_verification: 'info',
  verified: 'success',
  historical_review: 'warning',
  settled_outside: 'neutral',
  void: 'neutral',
};

/** Missing Proof · Pending Verification · Verified (and Historical – needs review, Settled outside RenewalIQ, Void). */
export function CommissionStatusBadge({ status }: { status: LedgerStatus }) {
  return (
    <Badge tone={TONES[status]} data-commission-status={status}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
