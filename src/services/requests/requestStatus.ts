import type { BadgeTone } from '../../components/ui';
import type { DocumentRequest } from '../../types';

/**
 * Where a client request stands, for the broker — one place, so the request card, the Missing
 * Documents panel and Action required always agree.
 *
 *  prepared          the secure link exists (email copied / opened in Gmail), not marked sent
 *  sent              the broker marked it sent; nothing back yet
 *  sent_unconfirmed  made before sending was tracked (0047) — may or may not have gone out
 *  partially_received  some items back (accepted or waiting for review), some still outstanding
 *  pending_review    everything outstanding is back, but the broker hasn't accepted all of it
 *  complete          every item received or waived
 *  cancelled         closed by the broker
 *  expired           still open, but the link no longer works
 */
export type RequestProgressKey = 'prepared' | 'sent' | 'sent_unconfirmed' | 'partially_received' | 'pending_review' | 'complete' | 'cancelled' | 'expired';

export const REQUEST_PROGRESS: Record<RequestProgressKey, { label: string; tone: BadgeTone }> = {
  prepared: { label: 'Request prepared — not sent', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'warning' },
  sent_unconfirmed: { label: 'Sent (unconfirmed)', tone: 'warning' },
  partially_received: { label: 'Partially received', tone: 'info' },
  pending_review: { label: 'Received, pending review', tone: 'info' },
  complete: { label: 'Complete', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Link expired', tone: 'danger' },
};

export function requestProgress(r: DocumentRequest, now = new Date()): RequestProgressKey {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'complete') return 'complete';
  const active = r.items.filter((i) => i.status !== 'waived');
  if (active.length > 0 && active.every((i) => i.status === 'satisfied')) return 'complete';
  if (new Date(r.expiresAt).getTime() < now.getTime()) return 'expired';
  const outstanding = active.filter((i) => i.status === 'requested').length;
  const inReview = active.filter((i) => i.status === 'uploaded' || i.status === 'needs_review').length + r.files.filter((f) => !f.requestItemId && (f.matchStatus === 'pending' || f.matchStatus === 'needs_review')).length;
  const accepted = active.filter((i) => i.status === 'satisfied').length;
  if (outstanding === 0 && inReview > 0) return 'pending_review';
  if (outstanding > 0 && (inReview > 0 || accepted > 0)) return 'partially_received';
  if (r.deliveryStatus === 'prepared') return 'prepared';
  return r.deliveryStatus === 'sent' ? 'sent' : 'sent_unconfirmed';
}

/** Whether the follow-up clock runs: only once the request has (or may have) gone out. */
export function followUpApplies(r: Pick<DocumentRequest, 'deliveryStatus'>): boolean {
  return r.deliveryStatus !== 'prepared';
}
