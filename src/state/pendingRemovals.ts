import { useSyncExternalStore } from 'react';

/**
 * Deletions that can still be undone. A deleted policy / endorsement disappears at once, but the deletion is
 * only saved (and so taken out of Analytics, 0079) when its Undo window ends — Undo just drops it, so nothing
 * recorded ever has to be put back. Leaving the page saves the deletions still waiting.
 */
export const UNDO_SECONDS = 15;

export interface PendingRemoval {
  key: string;
  label: string;
  /** When the Undo window ends (ms since epoch). */
  until: number;
}

interface Entry extends PendingRemoval {
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
}

const pending = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: PendingRemoval[] = [];
const notify = () => {
  snapshot = [...pending.values()].map(({ key, label, until }) => ({ key, label, until }));
  listeners.forEach((l) => l());
};

export const removalKey = (accountId: string, entryId: string) => `${accountId}|${entryId}`;

/** Hides it now; runs `commit` (the real deletion) after the Undo window unless undone. */
export function scheduleRemoval(key: string, label: string, commit: () => void, seconds = UNDO_SECONDS): void {
  if (pending.has(key)) return;
  const timer = setTimeout(() => finish(key), seconds * 1000);
  pending.set(key, { key, label, until: Date.now() + seconds * 1000, timer, commit });
  notify();
}

function finish(key: string) {
  const e = pending.get(key);
  if (!e) return;
  clearTimeout(e.timer);
  pending.delete(key);
  notify();
  e.commit();
}

/** Undo: the deletion never happens. */
export function undoRemoval(key: string): void {
  const e = pending.get(key);
  if (!e) return;
  clearTimeout(e.timer);
  pending.delete(key);
  notify();
}

/** Saves every deletion still waiting (e.g. the page is being left). */
export function commitAllRemovals(): void {
  for (const key of [...pending.keys()]) finish(key);
}

export function usePendingRemovals(): PendingRemoval[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot
  );
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', commitAllRemovals);
