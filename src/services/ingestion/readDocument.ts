import type { ExtractedFieldResult, ReviewCandidate } from '../../types';
import { extractInsuranceFields, reconcileImageExtraction, gateExtraction, type DocumentClassification } from '../extraction';
import { extractViaVision, type VisionExtractionResult } from './visionExtraction';
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
  documentCategory: ReturnType<typeof reconcileImageExtraction>['documentCategory'];
  candidateNotes?: string;
  visionResult: VisionExtractionResult | null;
  isImageSource: boolean;
  /** The document id/name the results' sources point to. */
  documentId: string;
  documentName: string;
}

export async function readDocumentFile(file: File, documentId: string, documentName: string, currentUserId: string | null): Promise<DocumentRead> {
  const { parseFile } = await import('./index');
  const raw = await parseFile(file);
  const isImageSource = raw.fileType === 'image';
  const ocrResults = extractInsuranceFields(raw, { documentId, documentName, isImageSource: isImageSource || raw.ocrConfidence !== undefined });

  // Images are the primary case vision extraction exists for — a layout-aware model reads the
  // photo directly instead of relying only on OCR text + regex. Attempted only when Supabase is
  // configured and the broker is signed in (see isVisionExtractionAvailable); resolves to null on
  // any failure so OCR is always there as a fallback — never throws, never blocks the OCR path.
  const visionResult = isImageSource ? await extractViaVision(file, currentUserId) : null;

  const { results: read, documentCategory: visionCategory, candidateNotes } = isImageSource
    ? reconcileImageExtraction({ documentId, documentName, ocrResults, visionResult })
    : { results: ocrResults, documentCategory: null, candidateNotes: undefined };
  // Nothing reaches an account just because a reader returned it: classify, validate, then apply,
  // hold for review, or drop.
  const gate = gateExtraction({ results: read, text: raw.text, fileName: documentName, scanned: isImageSource || raw.ocrConfidence !== undefined, visionCategory });
  const documentCategory = gate.classification.certainty === 'low' ? visionCategory : gate.classification.category;
  return {
    raw,
    results: gate.applied,
    review: gate.review,
    rejectedCount: gate.rejected,
    classification: gate.classification,
    documentCategory,
    candidateNotes,
    visionResult,
    isImageSource,
    documentId,
    documentName,
  };
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
      const v = r.value as { documentId?: unknown } | null;
      const value = v && typeof v === 'object' && !Array.isArray(v) && v.documentId === read.documentId ? { ...v, documentId } : r.value;
      return { ...r, value, source: rekey(r.source) };
    }),
    review: read.review.map((c) => ({ ...c, source: rekey(c.source) })),
  };
}
