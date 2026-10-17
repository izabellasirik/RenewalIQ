import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawDocument } from '../types';
import type { VisionExtractionResult } from '../visionExtraction';

// Synthetic data only — no real person, license or document.
const parseFile = vi.fn();
const parseImage = vi.fn();
const renderPdfPagesForVision = vi.fn();
const ocrPdfPages = vi.fn();
const extractViaVision = vi.fn();
const extractImageViaVision = vi.fn();
let quotaMessage: string | null = null;

vi.mock('../index', () => ({ parseFile: (...a: unknown[]) => parseFile(...a) }));
vi.mock('../parseImage', () => ({ parseImage: (...a: unknown[]) => parseImage(...a) }));
vi.mock('../parsePdf', () => ({
  renderPdfPagesForVision: (...a: unknown[]) => renderPdfPagesForVision(...a),
  ocrPdfPages: (...a: unknown[]) => ocrPdfPages(...a),
}));
vi.mock('../aiReadContext', () => ({ fileSha256: async () => 'a'.repeat(64) }));
vi.mock('../visionExtraction', () => ({
  extractViaVision: (...a: unknown[]) => extractViaVision(...a),
  extractImageViaVision: (...a: unknown[]) => extractImageViaVision(...a),
  isVisionExtractionAvailable: (uid: string | null) => !!uid,
  recentQuotaRefusal: () => quotaMessage,
}));

const { readDocumentFile, MAX_AI_SCANNED_PAGES, OCR_FALLBACK_NOTICE } = await import('../readDocument');
const { OCR_FALLBACK_HOLD_REASON } = await import('../../extraction/reconcileImageExtraction');

const photo = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });

const BUSINESS_TEXT = 'Named Insured: Prairie Line Freight LLC\nUSDOT Number: 3141592\nMC Number: 271828';

function vision(partial: Partial<VisionExtractionResult>): VisionExtractionResult {
  return { documentType: 'other', documentTypeConfidence: 'high', scalarFields: [], ...partial };
}

const scheduleDriver = (name: string, licenseNumber: string) => ({ name, dob: '07/24/1985', licenseState: 'TX', licenseNumber, fieldConfidence: {} });

beforeEach(() => {
  vi.clearAllMocks();
  quotaMessage = null;
  renderPdfPagesForVision.mockImplementation(async (_f: File, pages: number[]) => pages.map((page) => ({ page, base64: `img${page}` })));
});

describe('reading order: native text → AI → OCR fallback', () => {
  it('photo: the AI reading is used alone — OCR never runs, so it can’t disagree', async () => {
    parseFile.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: '', warnings: [] } satisfies RawDocument);
    extractViaVision.mockResolvedValue(vision({ documentType: 'application', scalarFields: [{ fieldPath: 'transportation.dotNumber', value: '3141592', confidence: 'high' }] }));
    // What OCR would have read (a misread digit) — if it ran, its value would conflict.
    parseImage.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: 'USDOT Number: 3747592', warnings: [], ocrConfidence: 70 });

    const read = await readDocumentFile(photo, 'doc_1', 'card.jpg', 'user_1', { accountId: 'acct_1' });

    expect(parseFile).toHaveBeenCalledWith(photo, { ocr: false });
    expect(parseImage).not.toHaveBeenCalled();
    expect(extractViaVision).toHaveBeenCalledWith(photo, 'user_1', { documentId: 'doc_1', accountId: 'acct_1' });
    const dots = [...read.results, ...read.review].filter((r) => r.fieldPath === 'transportation.dotNumber');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ value: '3141592', extractionMethod: 'vision_extraction' });
    expect(read.review).toHaveLength(0);
  });

  it('photo: AI unavailable → OCR runs, and everything it read waits for review', async () => {
    parseFile.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: '', warnings: [] } satisfies RawDocument);
    extractViaVision.mockResolvedValue(null);
    parseImage.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: BUSINESS_TEXT, warnings: [], ocrConfidence: 80 });

    const read = await readDocumentFile(photo, 'doc_1', 'card.jpg', 'user_1');

    expect(parseImage).toHaveBeenCalledTimes(1);
    expect(read.results.filter((r) => !r.fieldPath.startsWith('lossRun'))).toHaveLength(0);
    expect(read.review.length).toBeGreaterThan(0);
    expect(read.review.every((c) => c.reason === OCR_FALLBACK_HOLD_REASON && c.confidence === 'low')).toBe(true);
    expect(read.review.find((c) => c.fieldPath === 'transportation.dotNumber')?.value).toBe('3141592');
    expect(read.raw.warnings).toContain(OCR_FALLBACK_NOTICE);
  });

  it('photo: the daily AI limit was reached → OCR, held for review, and the broker is told why', async () => {
    parseFile.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: '', warnings: [] } satisfies RawDocument);
    extractViaVision.mockImplementation(async () => {
      quotaMessage = 'You’ve reached today’s limit for AI document reading.';
      return null;
    });
    parseImage.mockResolvedValue({ documentName: 'card.jpg', fileType: 'image', text: BUSINESS_TEXT, warnings: [], ocrConfidence: 80 });
    const read = await readDocumentFile(photo, 'doc_q', 'card.jpg', 'user_1');
    expect(read.raw.warnings).toContain('You’ve reached today’s limit for AI document reading.');
    expect(read.review.every((c) => c.reason === OCR_FALLBACK_HOLD_REASON)).toBe(true);
  });

  it('scanned PDF (no native text): every page is read by the AI and combined; OCR never runs', async () => {
    parseFile.mockResolvedValue({
      documentName: 'report.pdf', fileType: 'pdf', text: '', warnings: [], scannedPages: [1, 2],
      pages: [{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '' }], layout: [],
    } satisfies RawDocument);
    extractImageViaVision.mockImplementation(async (_b: string, _m: string, _n: string, _u: string, ctx: { page: number }) =>
      ctx.page === 1
        ? vision({ documentType: 'driver_schedule', drivers: [scheduleDriver('Jordan Avery', 'T1000001'), scheduleDriver('Casey Brooks', 'T1000002')] })
        : vision({ documentType: 'driver_schedule', drivers: [scheduleDriver('Riley Chen', 'T1000003'), scheduleDriver('Casey Brooks', 'T1000002')] })
    );

    const read = await readDocumentFile(pdf, 'doc_2', 'report.pdf', 'user_1', { accountId: 'acct_1' });

    expect(extractImageViaVision).toHaveBeenCalledTimes(2);
    expect(extractImageViaVision.mock.calls.map((c) => c[4])).toEqual([
      { documentId: 'doc_2', accountId: 'acct_1', sourceKind: 'scanned_pdf_page', page: 1, sourceHash: 'a'.repeat(64) },
      { documentId: 'doc_2', accountId: 'acct_1', sourceKind: 'scanned_pdf_page', page: 2, sourceHash: 'a'.repeat(64) },
    ]);
    expect(ocrPdfPages).not.toHaveBeenCalled();
    const names = read.results.filter((r) => r.fieldPath === 'drivers').map((r) => (r.value as { name: string }).name).sort();
    expect(names).toEqual(['Casey Brooks', 'Jordan Avery', 'Riley Chen']); // repeated row counted once
    expect(read.results.find((r) => r.fieldPath === 'transportation.driverCount')?.value).toBe(3);
  });

  it('PDF with text and scanned pages: text pages read as text (no AI), only scanned pages go to the AI', async () => {
    parseFile.mockResolvedValue({
      documentName: 'report.pdf', fileType: 'pdf', text: BUSINESS_TEXT, warnings: [], scannedPages: [2],
      pages: [{ pageNumber: 1, text: BUSINESS_TEXT }, { pageNumber: 2, text: '' }], layout: [],
    } satisfies RawDocument);
    extractImageViaVision.mockResolvedValue(
      vision({ documentType: 'loss_run', lossRuns: [{ carrier: 'Sample Mutual Insurance Company', policyNumber: 'TX-100', coverageStart: '2025-01-01', coverageEnd: '2026-01-01' }], lossEntries: [{ lossDate: '2025-03-04', claimType: 'Cargo', paid: 1000, reserved: 0, incurred: 1000, status: 'closed', confidence: 'high' }] })
    );

    const read = await readDocumentFile(pdf, 'doc_3', 'report.pdf', 'user_1');

    expect(renderPdfPagesForVision).toHaveBeenCalledWith(pdf, [2]);
    expect(extractImageViaVision).toHaveBeenCalledTimes(1);
    expect(read.results.find((r) => r.fieldPath === 'transportation.dotNumber')).toMatchObject({ value: '3141592', extractionMethod: 'ai_extraction' });
    const run = read.results.find((r) => r.fieldPath === 'lossRun')!.value as { key: string; carrier: string; policyNumber: string };
    expect(run).toMatchObject({ carrier: 'Sample Mutual Insurance Company', policyNumber: 'TX-100' });
    expect(read.results.find((r) => r.fieldPath === 'lossHistory')!.value).toMatchObject({ incurred: 1000, lossRunKey: run.key });
  });

  it('a scanned page the AI couldn’t read falls back to OCR for that page only, held for review', async () => {
    parseFile.mockResolvedValue({
      documentName: 'report.pdf', fileType: 'pdf', text: '', warnings: [], scannedPages: [1, 2],
      pages: [{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '' }], layout: [],
    } satisfies RawDocument);
    extractImageViaVision.mockImplementation(async (_b: string, _m: string, _n: string, _u: string, ctx: { page: number }) => (ctx.page === 1 ? vision({ scalarFields: [{ fieldPath: 'business.namedInsured', value: 'Prairie Line Freight LLC', confidence: 'high' }] }) : null));
    ocrPdfPages.mockImplementation(async (_f: File, raw: RawDocument) => ({ ...raw, pages: [{ pageNumber: 1, text: '' }, { pageNumber: 2, text: 'USDOT Number: 3141592' }], ocrConfidence: 70 }));

    const read = await readDocumentFile(pdf, 'doc_4', 'report.pdf', 'user_1');

    expect(ocrPdfPages).toHaveBeenCalledWith(pdf, expect.anything(), [2]);
    expect(read.results.find((r) => r.fieldPath === 'business.namedInsured')?.value).toBe('Prairie Line Freight LLC');
    expect(read.review.find((c) => c.fieldPath === 'transportation.dotNumber')).toMatchObject({ value: '3141592', reason: OCR_FALLBACK_HOLD_REASON });
    expect(read.raw.warnings.join(' ')).toMatch(/Scanned page 2 couldn’t be read by AI/);
  });

  it(`more than ${MAX_AI_SCANNED_PAGES} scanned pages: only the first ${MAX_AI_SCANNED_PAGES} are read, and the broker is told`, async () => {
    const all = Array.from({ length: 30 }, (_, i) => i + 1);
    parseFile.mockResolvedValue({ documentName: 'report.pdf', fileType: 'pdf', text: '', warnings: [], scannedPages: all, pages: all.map((pageNumber) => ({ pageNumber, text: '' })), layout: [] } satisfies RawDocument);
    extractImageViaVision.mockResolvedValue(vision({}));

    const read = await readDocumentFile(pdf, 'doc_5', 'report.pdf', 'user_1');

    expect(renderPdfPagesForVision).toHaveBeenCalledWith(pdf, all.slice(0, 25));
    expect(extractImageViaVision).toHaveBeenCalledTimes(25);
    expect(read.raw.warnings.join(' ')).toContain('This PDF has 30 scanned pages. Only the first 25 were read automatically — pages 26–30 were not read.');
  });

  it('text-only files never call the AI', async () => {
    parseFile.mockResolvedValue({ documentName: 'app.pdf', fileType: 'pdf', text: BUSINESS_TEXT, warnings: [], pages: [{ pageNumber: 1, text: BUSINESS_TEXT }], layout: [] } satisfies RawDocument);
    const read = await readDocumentFile(pdf, 'doc_6', 'app.pdf', 'user_1');
    expect(extractImageViaVision).not.toHaveBeenCalled();
    expect(extractViaVision).not.toHaveBeenCalled();
    expect(read.results.find((r) => r.fieldPath === 'business.namedInsured')?.value).toBe('Prairie Line Freight LLC');
  });
});
