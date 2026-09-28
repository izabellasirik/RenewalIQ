import type { StateStorage } from 'zustand/middleware';

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
