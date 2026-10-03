import type { DriverEntry, MissingItem } from '../../types';
import { requirementKey } from './requirementKey';

/**
 * "MVRs — all drivers" is the checklist's placeholder for when no drivers were known yet. When
 * the Risk Profile now names the drivers, a client request asks for one MVR per driver instead —
 * each its own canonical checklist requirement ("MVR — John Smith"), so each can be missing, under
 * review or received on its own. The same driver's existing item is reused, never duplicated. With
 * no named drivers the generic item is left as it is.
 */
export interface DriverSplit {
  /** The generic "MVRs — all drivers" item being replaced. */
  genericId: string;
  /** One per named driver; `existingId` when the checklist already has that driver's MVR item. */
  drivers: { label: string; templateKey: string; existingId?: string }[];
}

export const isGenericMvr = (item: Pick<MissingItem, 'label' | 'templateKey'>) => requirementKey(item) === 'mvr|all';

export function splitDriverMvrs(selected: MissingItem[], all: MissingItem[], drivers: DriverEntry[]): { display: MissingItem[]; splits: DriverSplit[] } {
  const named = drivers.filter((d) => d.name && d.name.trim());
  const splits: DriverSplit[] = [];
  const display: MissingItem[] = [];
  const shown = new Set<string>();
  const push = (item: MissingItem) => {
    const key = requirementKey(item);
    if (shown.has(key)) return;
    shown.add(key);
    display.push(item);
  };
  for (const item of selected) {
    if (!isGenericMvr(item) || named.length === 0) {
      push(item);
      continue;
    }
    const split: DriverSplit = { genericId: item.id, drivers: [] };
    for (const d of named) {
      const label = `MVR — ${d.name!.trim()}`;
      const existing = all.find((i) => requirementKey(i) === requirementKey({ label }));
      // Already in (or not needed): not asked for again.
      if (existing && (existing.status === 'received' || existing.status === 'waived')) continue;
      split.drivers.push({ label, templateKey: `mvr:${d.id}`, existingId: existing?.id });
      push(existing ?? { ...item, id: `split:${item.id}:${d.id}`, label, templateKey: `mvr:${d.id}`, status: 'missing', instructions: item.instructions });
    }
    splits.push(split);
  }
  return { display, splits };
}
