/**
 * Original uploaded files, kept in this browser's IndexedDB (localStorage is far too small) so a
 * broker can preview a document after extraction without re-downloading it — including on a
 * local-only account with no cloud copy. Keyed by UploadedDocument.id.
 *
 * Every function fails soft: private browsing, a full disk, or a browser without IndexedDB just
 * means "no local copy" (the preview then falls back to the cloud copy, if any) — never an error
 * that blocks uploading or deleting a document.
 */

const DB_NAME = 'renewaliq-files';
const STORE = 'files';

export interface StoredFile {
  blob: Blob;
  name: string;
  type: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function saveLocalFile(documentId: string, file: Blob, name: string): Promise<void> {
  await run('readwrite', (s) => s.put({ blob: file, name, type: file.type } satisfies StoredFile, documentId));
}

export async function getLocalFile(documentId: string): Promise<StoredFile | undefined> {
  const value = await run<StoredFile | undefined>('readonly', (s) => s.get(documentId) as IDBRequest<StoredFile | undefined>);
  return value && value.blob ? value : undefined;
}

export async function deleteLocalFiles(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  await run('readwrite', (s) => {
    for (const id of documentIds) s.delete(id);
  });
}

export async function copyLocalFile(fromId: string, toId: string): Promise<void> {
  const f = await getLocalFile(fromId);
  if (f) await saveLocalFile(toId, f.blob, f.name);
}
