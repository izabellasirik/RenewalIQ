import { daysSince, formatDate, isStale } from '../../utils/dates';

export function buildStaleWarning(lastVerifiedDate: string): string | undefined {
  if (!isStale(lastVerifiedDate)) return undefined;
  const days = daysSince(lastVerifiedDate);
  return `Appetite data last verified ${formatDate(lastVerifiedDate)} (${days} days ago) — confirm current eligibility with the market before quoting.`;
}

export { isStale };
