/**
 * Remembered view settings (filters on Accounts and Today's Plate).
 *
 * For now they're kept on this device (localStorage), under the signed-in user's id so two people
 * sharing a computer don't get each other's filters. Every saved value is versioned and checked on
 * the way back in, so a stale or hand-edited entry falls back to the defaults instead of breaking a
 * page. Moving them to a per-user setting in the database later only means swapping the store below.
 */

export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VERSION = 1;

/** localStorage when it's usable (private windows and some browsers refuse it), otherwise nothing is remembered. */
export function deviceStore(): PreferenceStore | null {
  try {
    const s = globalThis.localStorage;
    const probe = 'renewaliq.view.probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function preferenceKey(scope: string, userId: string | null | undefined): string {
  return `renewaliq.view.v${VERSION}.${userId || 'local'}.${scope}`;
}

/**
 * The saved settings for `scope`, each one kept only if `sanitize` accepts it; anything missing or
 * unusable takes its default.
 */
export function loadPreferences<T extends object>(scope: string, userId: string | null | undefined, defaults: T, sanitize: (saved: Record<string, unknown>) => Partial<T>, store: PreferenceStore | null = deviceStore()): T {
  if (!store) return defaults;
  try {
    const raw = store.getItem(preferenceKey(scope, userId));
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    return { ...defaults, ...sanitize(parsed as Record<string, unknown>) };
  } catch {
    return defaults;
  }
}

/** Saves the settings; settings equal to the defaults aren't stored at all. */
export function savePreferences<T extends object>(scope: string, userId: string | null | undefined, value: T, defaults: T, store: PreferenceStore | null = deviceStore()): void {
  if (!store) return;
  try {
    const changed = Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== (defaults as Record<string, unknown>)[k]));
    const key = preferenceKey(scope, userId);
    if (Object.keys(changed).length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(changed));
  } catch {
    // Storage full or refused: the page still works, it just won't remember.
  }
}

/** Sanitizer helpers. */
export const oneOf =
  <V extends string>(allowed: readonly V[]) =>
  (v: unknown): V | undefined =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as V) : undefined;
export const aString = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined);
/** A YYYY-MM-DD date. */
export const aDateKey = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
export const aBoolean = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Drops undefined entries, so they don't override defaults. */
export function defined<T extends object>(o: { [K in keyof T]?: T[K] | undefined }): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
