import { describe, expect, it, vi } from 'vitest';
import { createSafeStorage, withoutImagePreviews } from '../safeStorage';

/** A Storage that throws QuotaExceededError for any value longer than `limit` characters. */
function limitedStorage(limit: number) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException('exceeded the quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
  return { storage, data };
}

const snapshot = (preview: string) =>
  JSON.stringify({ state: { accounts: [{ id: 'a1' }], documents: { a1: [{ id: 'd1', name: 'license.jpg', previewDataUrl: preview }, { id: 'd2', name: 'loss.pdf' }] } }, version: 0 });

describe('safe persisted storage', () => {
  it('saves normally when there is room', () => {
    const { storage, data } = limitedStorage(10_000);
    createSafeStorage(() => storage).setItem('k', snapshot('data:image/jpeg;base64,abc'));
    expect(JSON.parse(data.get('k')!).state.documents.a1[0].previewDataUrl).toBe('data:image/jpeg;base64,abc');
  });

  it('when full, keeps everything but the image thumbnails instead of throwing', () => {
    const { storage, data } = limitedStorage(400);
    const value = snapshot('data:image/jpeg;base64,' + 'x'.repeat(1000));
    expect(() => createSafeStorage(() => storage).setItem('k', value)).not.toThrow();
    const saved = JSON.parse(data.get('k')!);
    expect(saved.state.accounts).toEqual([{ id: 'a1' }]);
    expect(saved.state.documents.a1.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
    expect(saved.state.documents.a1[0].previewDataUrl).toBeUndefined();
  });

  it('when even that does not fit, keeps the last saved copy and does not throw', () => {
    const { storage, data } = limitedStorage(50);
    data.set('k', 'previous');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => createSafeStorage(() => storage).setItem('k', snapshot('p'.repeat(100)))).not.toThrow();
    expect(data.get('k')).toBe('previous');
    warn.mockRestore();
  });

  it('reading or removing never throws either', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } } as unknown as Storage;
    const s = createSafeStorage(() => broken);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(s.getItem('k')).toBeNull();
    expect(() => s.setItem('k', '{}')).not.toThrow();
    expect(() => s.removeItem('k')).not.toThrow();
  });

  it('withoutImagePreviews returns null when there is nothing to strip', () => {
    expect(withoutImagePreviews(JSON.stringify({ state: { documents: { a: [{ id: 'd' }] } } }))).toBeNull();
    expect(withoutImagePreviews('not json')).toBeNull();
  });
});
