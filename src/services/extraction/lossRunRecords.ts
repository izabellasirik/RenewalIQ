import type { LossRun, RiskProfile } from '../../types';
import { generateId } from '../../utils/id';

const norm = (s: string | undefined) => (s ?? '').replace(/[\s-]/g, '').toLowerCase();

/**
 * Turns the loss-run records just read from a document (RiskProfile.pendingLossRuns) into the
 * account's LossRun records, and links each claim read under one to it (lossRunKey → lossRunId).
 *
 * The same report uploaded again matches the record it already made (same policy number and
 * period, or the same document) instead of adding a second one; a field the broker already filled
 * or corrected is never overwritten — only what's still empty is filled in.
 */
export function settleLossRuns(existing: LossRun[], profile: RiskProfile, now = new Date().toISOString()): { lossRuns: LossRun[]; profile: RiskProfile } {
  const pending = profile.pendingLossRuns ?? [];
  const hasKeys = profile.lossHistory.some((l) => l.lossRunKey);
  if (pending.length === 0 && !hasKeys) return { lossRuns: existing, profile };

  const lossRuns = [...existing];
  const idForKey = new Map<string, string>();
  for (const { key, ...draft } of pending) {
    const match = lossRuns.find((r) =>
      draft.policyNumber
        ? norm(r.policyNumber) === norm(draft.policyNumber) && (!r.coverageStart || !draft.coverageStart || r.coverageStart === draft.coverageStart)
        : !r.policyNumber && !!draft.documentId && r.documentId === draft.documentId
    );
    if (match) {
      const filled: LossRun = { ...match };
      for (const [k, v] of Object.entries(draft) as [keyof typeof draft, unknown][]) {
        const current = filled[k as keyof LossRun];
        const empty = current === undefined || current === '' || (k === 'carrier' && current === 'Carrier not listed');
        if (empty && v !== undefined) (filled as unknown as Record<string, unknown>)[k] = v;
      }
      filled.updatedAt = now;
      lossRuns[lossRuns.indexOf(match)] = filled;
      idForKey.set(key, match.id);
    } else {
      const record: LossRun = { ...draft, id: generateId('lossrun'), createdAt: now, updatedAt: now };
      lossRuns.push(record);
      idForKey.set(key, record.id);
    }
  }

  const lossHistory = profile.lossHistory.map((l) => {
    if (!l.lossRunKey) return l;
    const { lossRunKey, ...rest } = l;
    const id = idForKey.get(lossRunKey);
    return id && !rest.lossRunId ? { ...rest, lossRunId: id } : rest;
  });
  const { pendingLossRuns: _pending, ...settled } = profile;
  return { lossRuns, profile: { ...settled, lossHistory } };
}
