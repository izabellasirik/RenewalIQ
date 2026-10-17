import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('../../supabase/client', () => ({ isSupabaseConfigured: true, supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock('../imageUtils', () => ({
  decodeOriented: async () => ({ close() {} }),
  drawToCanvas: () => ({ toDataURL: () => 'data:image/jpeg;base64,aW1n' }),
}));

// The browser's storage (the test environment has none) — survives the "refresh" below.
const saved = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k) });

const { extractImageViaVision } = await import('../visionExtraction');
const { transcribePhoto } = await import('../visionTranscript');

const ctx = { documentId: 'doc_1', accountId: 'acct_1', sourceKind: 'scanned_pdf_page' as const, page: 3, sourceHash: 'c'.repeat(64) };

beforeEach(() => invoke.mockReset());

describe('AI reads from the browser', () => {
  it('the same page asked for twice at once is one request, sent with its document context', async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = extractImageViaVision('aW1n', 'image/jpeg', 'report.pdf', 'user_1', ctx);
    const b = extractImageViaVision('aW1n', 'image/jpeg', 'report.pdf', 'user_1', ctx);
    resolve({ data: { documentType: 'loss_run', documentTypeConfidence: 'high', scalarFields: [] }, error: null });
    const [ra, rb] = await Promise.all([a, b]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toEqual({ imageBase64: 'aW1n', mimeType: 'image/jpeg', fileName: 'report.pdf', context: ctx });
    expect(ra).toBe(rb);
    expect(ra?.documentType).toBe('loss_run');
  });

  it('never calls the AI when not signed in', async () => {
    expect(await extractImageViaVision('aW1n', 'image/jpeg', 'x.pdf', null, ctx)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reopening the preview (same session or after a refresh) reuses the reading — no new AI call', async () => {
    invoke.mockResolvedValue({ data: { lines: [{ text: 'CLASS A', box: [100, 100, 400, 150] }] }, error: null });
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const first = await transcribePhoto('doc_t:1', blob, 'user_1', { documentId: 'doc_t', sourceKind: 'photo', sourceHash: 'd'.repeat(64) });
    expect(first?.[0].text).toBe('CLASS A');
    expect(invoke.mock.calls[0][1].body).toMatchObject({ mode: 'transcribe', context: { documentId: 'doc_t', sourceKind: 'photo' } });
    await transcribePhoto('doc_t:1', blob, 'user_1');
    expect(invoke).toHaveBeenCalledTimes(1);
    // After a refresh the in-memory copy is gone; the browser's saved copy answers. (And beyond
    // this browser, the server returns its stored read instead of paying again — aiReadServer.test.ts.)
    vi.resetModules();
    const fresh = await import('../visionTranscript');
    const again = await fresh.transcribePhoto('doc_t:1', blob, 'user_1');
    expect(again?.[0].text).toBe('CLASS A');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
