import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../sidebarPreference';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('sidebar collapsed preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is remembered, and defaults to expanded', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    expect(readSidebarCollapsed()).toBe(false);
    writeSidebarCollapsed(true);
    expect(readSidebarCollapsed()).toBe(true);
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', { localStorage: { getItem: blocked, setItem: blocked } });
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
    expect(readSidebarCollapsed()).toBe(false);
    vi.stubGlobal('window', undefined);
    expect(readSidebarCollapsed()).toBe(false);
  });
});
