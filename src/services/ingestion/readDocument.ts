import type { DocumentCategory, ExtractedFieldResult, ReviewCandidate } from '../../types';
import { extractInsuranceFields, gateExtraction, holdOcrResults, mergeVisionPages, visionToResults, type DocumentClassification } from '../extraction';
import { fileSha256 } from './aiReadContext';
import { extractImageViaVision, extractViaVision, isVisionExtractionAvailable, type VisionExtractionResult } from './visionExtraction';
import type { RawDocument } from './types';

/**
 * Reads one file into extracted field results WITHOUT touching any account — the first half of an
 * upload. The store applies a read to an account (addFiles); a client's upload is read first and
 * only applied once it's confirmed to be what was asked for.
 */
export interface DocumentRead {
  raw: RawDocument;
  /** Validated — what may be applied to the account (see gateExtraction). */
  results: ExtractedFieldResult[];
  /** Read but held for the broker: uncertain, or at odds with what the document is. */
  review: ReviewCandidate[];
  /** Fragments thrown away (labels, OCR noise). */
  rejectedCount: number;
  classification: DocumentClassification;
  documentCategory: DocumentCategory | null;
  candidateNotes?: string;
  visionResult: VisionExtractionResult | null;
  isImageSource: boolean;
  /** The document id/name the results' sources point to. */
  documentId: string;
  documentName: string;
}

export interface ReadDocumentOptions {
  /** The account the document belongs to, when there is one yet — for AI usage accounting only. */
  accountId?: string;
}

/**
 * Reading order: a document's own text first (text PDFs, Word, Excel, CSV — read exactly, no AI);
 * then the AI for photos and scanned PDF pages; on-device OCR only for an image or page the AI
 * couldn't read — and whatever OCR reads is held for the broker, never applied on its own.
 */
export async function readDocumentFile(file: File, documentId: string, documentName: string, currentUserId: string | null, options: ReadDocumentOptions = {}): Promise<DocumentRead> {
  const { parseFile } = await import('./index');
  // OCR waits: it runs below only for what the AI couldn't read.
  let raw = await parseFile(file, { ocr: false });
  const source = raw.linkedFile ?? file;
  const isImageSource = raw.fileType === 'image';
  const scannedPages = raw.fileType === 'pdf' ? (raw.scannedPages ?? []) : [];
  const meta = { documentId, documentName };
  const context = { documentId, ...(options.accountId ? { accountId: options.accountId } : {}) };

  let read: ExtractedFieldResult[];
  let visionResult: VisionExtractionResult | null = null;
  let aiRead = false;
  if (isImageSource) {
    visionResult = await extractViaVision(source, currentUserId, context);
    if (visionResult) {
      read = visionToResults(documentId, documentName, visionResult);
      aiRead = true;
    } else {
      const { parseImage } = await import('./parseImage');
      raw = { ...(await parseImage(source)), ...(raw.sourceUrl ? { sourceUrl: raw.sourceUrl, linkedFile: raw.linkedFile } : {}) };
      read = holdOcrResults(extractInsuranceFields(raw, { ...meta, isImageSource: true }));
      raw = { ...raw, warnings: [...raw.warnings, OCR_FALLBACK_NOTICE] };
    }
  } else if (scannedPages.length > 0) {
    const eligible = scannedPages.slice(0, MAX_AI_SCANNED_PAGES);
    const aiPages = await readScannedPagesWithAi(source, eligible, currentUserId, context);
    visionResult = mergeVisionPages(aiPages);
    const readByAi = new Set(aiPages.map((p) => p.page));
    const ocrPages = eligible.filter((n) => !readByAi.has(n));
    if (ocrPages.length) {
      const { ocrPdfPages } = await import('./parsePdf');
      raw = await ocrPdfPages(source, raw, ocrPages);
    }
    const textPages = (raw.pages ?? []).map((p) => p.pageNumber).filter((n) => !scannedPages.includes(n));
    read = [
      ...(textPages.length ? extractInsuranceFields(pagesOf(raw, textPages), { ...meta, isImageSource: false }) : []),
      ...(ocrPages.length ? holdOcrResults(extractInsuranceFields(pagesOf(raw, ocrPages), { ...meta, isImageSource: true })) : []),
      ...(visionResult ? visionToResults(documentId, documentName, visionResult) : []),
    ];
    aiRead = ocrPages.length === 0 && textPages.length === 0;
    const notes: string[] = [];
    if (scannedPages.length > MAX_AI_SCANNED_PAGES) {
      notes.push(`This PDF has ${scannedPages.length} scanned pages. Only the first ${MAX_AI_SCANNED_PAGES} were read automatically — pages ${scannedPages[MAX_AI_SCANNED_PAGES]}–${scannedPages[scannedPages.length - 1]} were not read. Check them against the file.`);
    }
    if (ocrPages.length) {
      notes.push(`${ocrPages.length === 1 ? 'Scanned page' : 'Scanned pages'} ${ocrPages.join(', ')} couldn’t be read by AI and ${ocrPages.length === 1 ? 'was' : 'were'} read by on-device text recognition instead — anything from ${ocrPages.length === 1 ? 'it' : 'them'} needs review.`);
    }
    raw = { ...raw, warnings: [...raw.warnings, ...notes] };
  } else {
    read = extractInsuranceFields(raw, { ...meta, isImageSource: false });
  }

  const visionCategory = visionResult?.documentType ?? null;
  // Nothing reaches an account just because a reader returned it: classify, validate, then apply,
  // hold for review, or drop.
  const gate = gateExtraction({ results: read, text: raw.text, fileName: documentName, scanned: isImageSource || scannedPages.length > 0, visionCategory, aiRead });
  const documentCategory = gate.classification.certainty === 'low' ? visionCategory : gate.classification.category;
  return {
    raw,
    results: gate.applied,
    review: gate.review,
    rejectedCount: gate.rejected,
    classification: gate.classification,
    documentCategory,
    candidateNotes: visionResult?.candidateNotes,
    visionResult,
    isImageSource,
    documentId,
    documentName,
  };
}

/** Shown on a photo the AI couldn't read: OCR stood in, so everything from it waits for the broker. */
export const OCR_FALLBACK_NOTICE = 'AI reading wasn’t available for this photo, so it was read by on-device text recognition — everything read from it needs review.';

/** Scanned pages read automatically per document — the rest are listed for the broker, never silently read. */
export const MAX_AI_SCANNED_PAGES = 25;
/** Scanned pages read by the AI at once — each call takes several seconds. */
const AI_PAGE_CONCURRENCY = 3;

/** The AI reading of each scanned page it could read (at most one paid call per page — the server reuses earlier reads). */
async function readScannedPagesWithAi(file: File, pages: number[], currentUserId: string | null, context: { documentId: string; accountId?: string }): Promise<{ page: number; result: VisionExtractionResult }[]> {
  if (!isVisionExtractionAvailable(currentUserId) || pages.length === 0) return [];
  const { renderPdfPagesForVision } = await import('./parsePdf');
  let images: { page: number; base64: string }[];
  try {
    images = await renderPdfPagesForVision(file, pages);
  } catch {
    return [];
  }
  const sourceHash = await fileSha256(file);
  const out: { page: number; result: VisionExtractionResult }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < images.length) {
      const img = images[next++];
      const result = await extractImageViaVision(img.base64, 'image/jpeg', file.name, currentUserId, { ...context, sourceKind: 'scanned_pdf_page', page: img.page, ...(sourceHash ? { sourceHash } : {}) });
      if (result) out.push({ page: img.page, result });
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_PAGE_CONCURRENCY, images.length) }, worker));
  return out.sort((a, b) => a.page - b.page);
}

/** The document restricted to some of its pages (text, layout and page list). */
function pagesOf(raw: RawDocument, pageNumbers: number[]): RawDocument {
  const keep = new Set(pageNumbers);
  const pages = (raw.pages ?? []).filter((p) => keep.has(p.pageNumber));
  return { ...raw, pages, layout: raw.layout?.filter((l) => keep.has(l.page)), text: pages.map((p) => p.text).join('\n') };
}

/** The same read, credited to the account document it's being imported as. */
export function rekeyRead(read: DocumentRead, documentId: string, documentName: string): DocumentRead {
  const rekey = <S extends { documentId: string; documentName: string } | undefined>(source: S): S =>
    source && source.documentId === read.documentId ? ({ ...source, documentId, documentName } as S) : source;
  return {
    ...read,
    documentId,
    documentName,
    // Values can carry the document id too (a loss-run record's documentId, for one).
    results: read.results.map((r) => {
      const v = r.value as { documentId?: unknown; cdlOriginalIssueSource?: { documentId: string; documentName: string } } | null;
      let value = v && typeof v === 'object' && !Array.isArray(v) && v.documentId === read.documentId ? { ...v, documentId } : r.value;
      // A driver's original-CDL-date provenance points at the document too.
      if (v && typeof v === 'object' && v.cdlOriginalIssueSource) value = { ...(value as object), cdlOriginalIssueSource: rekey(v.cdlOriginalIssueSource) };
      return { ...r, value, source: rekey(r.source) };
    }),
    review: read.review.map((c) => {
      const v = c.value as { cdlOriginalIssueSource?: { documentId: string; documentName: string } } | null;
      return { ...c, source: rekey(c.source), ...(v && typeof v === 'object' && v.cdlOriginalIssueSource ? { value: { ...v, cdlOriginalIssueSource: rekey(v.cdlOriginalIssueSource) } } : {}) };
    }),
  };
}
