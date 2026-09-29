import type { PublicRequestItem } from '../supabase/documentRequestsRepo';

/**
 * The client page's states for a requested item: missing (nothing sent), under review (sent, your
 * agent hasn't accepted it yet) and received (accepted). Under review never counts as received.
 */
export type ItemState = 'missing' | 'review' | 'received';
/** Received = your agent accepted it. Uploaded but not accepted yet = under review — never shown as received. */
export function itemState(item: Pick<PublicRequestItem, 'received' | 'confirmed' | 'files'>): ItemState {
  if (item.confirmed) return 'received';
  return item.received || item.files.length > 0 ? 'review' : 'missing';
}

/** "1 of 5 received · 4 remaining" — only accepted items count as received. */
export function requestProgress(items: Pick<PublicRequestItem, 'received' | 'confirmed' | 'files'>[]) {
  const total = items.length;
  const received = items.filter((i) => itemState(i) === 'received').length;
  const reviewing = items.filter((i) => itemState(i) === 'review').length;
  return { total, received, reviewing, remaining: total - received };
}
