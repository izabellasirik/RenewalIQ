export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/** Appetite data older than this many days is flagged for re-verification. */
export const STALE_THRESHOLD_DAYS = 90;

export function isStale(lastVerifiedIso: string): boolean {
  return daysSince(lastVerifiedIso) > STALE_THRESHOLD_DAYS;
}
