import type { AppetiteCriterion, AppetiteRecord } from '../types';

/** Shared plain-English formatters for AppetiteCriterion values — used by both the market detail
 * view and the appetite-update request form, so "current value" reads identically in both places. */

export function formatStates(record: AppetiteRecord): string {
  const c = record.states;
  if (!c.value) return 'Not verified';
  const parts: string[] = [];
  if (c.value.admitted?.length) parts.push(`Admitted: ${c.value.admitted.join(', ')}`);
  if (c.value.excluded?.length) parts.push(`Excluded: ${c.value.excluded.join(', ')}`);
  return parts.join(' · ') || 'Not verified';
}

export function formatFleetSize(record: AppetiteRecord): string {
  const c = record.fleetSize;
  if (!c.value) return 'Not verified';
  const { min, max } = c.value;
  if (min === undefined && max === undefined) return 'Not verified';
  return `${min ?? 0}–${max !== undefined ? max : '∞'} units`;
}

export function formatCriterion<T>(c: AppetiteCriterion<T>, formatter: (v: T) => string): string {
  if (c.value === null) return 'Not verified';
  return formatter(c.value);
}
