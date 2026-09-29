import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

/**
 * localStorage for the persisted store that never throws. Browsers cap localStorage at ~5 MB per
 * site; once a broker's saved accounts, documents and image previews reach that, every write
 * throws QuotaExceededError — and because zustand's persist writes synchronously inside `set`, that
 * error escaped from whatever store action was running (e.g. creating a submission stopped halfway,
 * before its cloud save started, leaving New Submission stuck on "Creating Risk Profile…").
 *
 * On a failed write this retries without image preview thumbnails (they're conveniences: cloud
 * accounts keep them in the database, and every original stays in this browser's file store), and
 * if even that doesn't fit, it keeps the last saved copy and reports it. The app itself keeps
 * working either way — the in-memory state and the cloud are unaffected.
 */

export const STORAGE_FULL_EVENT = 'renewaliq:storage-full';

let lastFailureReported = 0;

function report(name: string, error: unknown) {
  const now = Date.now();
  if (now - lastFailureReported < 60_000) return; // once a minute is plenty
  lastFailureReported = now;
  console.warn(`Could not save ${name} in this browser (storage is full). Cloud saves are not affected.`, error);
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT));
  } catch {
    // no window (tests)
  }
}

/** Removes every `previewDataUrl` (image thumbnails) from a persisted snapshot. */
export function withoutImagePreviews(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { state?: { documents?: Record<string, { previewDataUrl?: string }[]> } };
    const docs = parsed.state?.documents;
    if (!docs) return null;
    let removed = false;
    for (const list of Object.values(docs)) {
      for (const d of list ?? []) {
        if (d && d.previewDataUrl) {
          delete d.previewDataUrl;
          removed = true;
        }
      }
    }
    return removed ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

export function createSafeStorage(getStorage: () => Storage | undefined = () => (typeof localStorage === 'undefined' ? undefined : localStorage)): StateStorage {
  return {
    getItem: (name) => {
      try {
        return getStorage()?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      const storage = getStorage();
      if (!storage) return;
      try {
        storage.setItem(name, value);
        return;
      } catch (error) {
        const slim = withoutImagePreviews(value);
        if (slim) {
          try {
            storage.setItem(name, slim);
            return;
          } catch {
            // still too big — fall through
          }
        }
        report(name, error);
      }
    },
    removeItem: (name) => {
      try {
        getStorage()?.removeItem(name);
      } catch {
        // nothing to do
      }
    },
  };
}

/**
 * The persisted store's JSON storage, written at most once per `delayMs` (the latest state wins),
 * and right away when the page is hidden or closed. zustand's persist writes on EVERY state change;
 * serializing a broker's whole saved state (dozens of accounts, their documents and market
 * matches) each time froze the page for seconds after sign-in, when every account is re-matched.
 */
export function createDebouncedJSONStorage<S>(getStorage: () => StateStorage, delayMs = 800): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (error) {
      console.warn(`Could not save ${name} in this browser.`, error);
      return;
    }
    void getStorage().setItem(name, json);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }

  return {
    getItem: (name) => {
      flush(); // never read an older copy than the one waiting to be written
      const raw = getStorage().getItem(name) as string | null;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null;
      void getStorage().removeItem(name);
    },
  };
}
