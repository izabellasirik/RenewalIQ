import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransientError, TimeoutError, withRetry, withTimeout } from '../retry';
import { clearIntakeDraft, draftHasContent, loadIntakeDraft, saveIntakeDraft } from '../intakeDraft';

describe('retry', () => {
  const noSleep = async () => {};

  it('retries temporary failures with growing pauses, then succeeds', async () => {
    const pauses: number[] = [];
    const retries: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('Service Unavailable'), { status: 503 });
        return 'ok';
      },
      { sleep: async (ms) => void pauses.push(ms), onRetry: (a) => retries.push(a) }
    );
    expect(result).toBe('ok');
    expect(pauses).toEqual([1000, 2000]);
    expect(retries).toEqual([2, 3]);
  });

  it('gives up after the last attempt, and never retries a final error', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new TypeError('Failed to fetch'); }, { sleep: noSleep })).rejects.toThrow('Failed to fetch');
    expect(calls).toBe(4);
    calls = 0;
    await expect(withRetry(async () => { calls++; throw Object.assign(new Error('Payload too large'), { status: 413 }); }, { sleep: noSleep })).rejects.toThrow('too large');
    expect(calls).toBe(1);
  });

  it('knows which errors are temporary', () => {
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientError(new TimeoutError('Uploading x'))).toBe(true);
    expect(isTransientError({ statusCode: '502', message: 'Bad gateway' })).toBe(true);
    expect(isTransientError({ status: 429, message: 'slow down' })).toBe(true);
    expect(isTransientError({ status: 403, message: 'new row violates row-level security policy' })).toBe(false);
    expect(isTransientError(new Error('This submission is no longer accepting files.'))).toBe(false);
  });

  it('times out a hung request', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000, 'Uploading a.pdf');
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow('Uploading a.pdf timed out');
    vi.useRealTimers();
  });
});

describe('intake draft', () => {
  const answers = { namedInsured: 'Blue Ridge', contactName: '', contactEmail: '', contactPhone: '', dotNumber: '', mcNumber: '', yearsInBusiness: null, powerUnits: null, driverCount: null, operationType: '', commoditiesHauled: '', operatingRadius: '', operatingStates: '', coverageRequested: [], currentCarrier: '', effectiveDate: '', additionalNotes: '' };
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps answers, the submission and which files already arrived, per link', () => {
    saveIntakeDraft('tok', { clientToken: 'c1', answers, files: [{ key: 'k1', name: 'a.pdf', size: 3, uploaded: true }], submissionId: 'isub_1', reference: 'RIQ-001001' });
    const d = loadIntakeDraft('tok')!;
    expect(d).toMatchObject({ clientToken: 'c1', submissionId: 'isub_1', reference: 'RIQ-001001', files: [{ key: 'k1', uploaded: true }] });
    expect(d.answers.namedInsured).toBe('Blue Ridge');
    expect(loadIntakeDraft('other')).toBeNull();
    expect(draftHasContent(d)).toBe(true);
    clearIntakeDraft('tok');
    expect(loadIntakeDraft('tok')).toBeNull();
  });

  it('drops a draft older than 7 days or one that is unreadable', () => {
    saveIntakeDraft('tok', { clientToken: 'c1', answers, files: [] });
    expect(loadIntakeDraft('tok', Date.now() + 8 * 24 * 3600 * 1000)).toBeNull();
    localStorage.setItem('renewaliq.intakeDraft.x', '{broken');
    expect(loadIntakeDraft('x')).toBeNull();
  });

  it('an empty form is not worth restoring', () => {
    saveIntakeDraft('tok', { clientToken: 'c1', answers: { ...answers, namedInsured: '' }, files: [] });
    expect(draftHasContent(loadIntakeDraft('tok')!)).toBe(false);
  });
});
