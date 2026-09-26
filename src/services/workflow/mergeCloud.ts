import type { AccountNote, FieldValue, RiskProfile } from '../../types';

/**
 * When this device is about to save an account that someone else saved in the meantime, these keep
 * both people's work instead of letting the older copy overwrite the newer one.
 */

// Timestamps come back from Postgres as "…+00:00" and are written here as "…Z" — compare instants, not strings.
export const toMs = (iso: string | undefined | null) => (iso ? Date.parse(iso) || 0 : 0);
const stamp = (f: FieldValue<unknown> | undefined) => toMs(f?.lastUpdatedAt);

/** Business and transportation fields: whichever copy of each field was changed most recently wins. */
export function mergeNewerFields(local: RiskProfile, cloud: RiskProfile): RiskProfile {
  function section<T extends object>(l: T, c: T): T {
    const out = { ...l } as Record<string, FieldValue<unknown>>;
    const cr = c as Record<string, FieldValue<unknown>>;
    for (const key of Object.keys(cr)) {
      if (cr[key] && stamp(cr[key]) > stamp(out[key])) out[key] = cr[key];
    }
    return out as T;
  }
  return { ...local, business: section(local.business, cloud.business), transportation: section(local.transportation, cloud.transportation) };
}

/** Lists with ids (notes, follow-ups): union by id; when both have one, the most recently changed copy wins. */
export function mergeById<T extends { id: string }>(local: T[], cloud: T[], changedAt: (x: T) => number): T[] {
  const byId = new Map<string, T>();
  for (const x of cloud) byId.set(x.id, x);
  for (const x of local) {
    const c = byId.get(x.id);
    if (!c || changedAt(x) >= changedAt(c)) byId.set(x.id, x);
  }
  return [...byId.values()];
}

export const noteChangedAt = (n: AccountNote) => toMs(n.updatedAt ?? n.createdAt);
