import type { ExtractedFieldResult } from '../../types';
import { extractInsuranceFields, reconcileImageExtraction } from '../extraction';
import { extractViaVision, type VisionExtractionResult } from './visionExtraction';
import type { RawDocument } from './types';

/**
 * Reads one file into extracted field results WITHOUT touching any account — the first half of an
 * upload. The store applies a read to an account (addFiles); a client's upload is read first and
 * only applied once it's confirmed to be what was asked for.
 */
export interface DocumentRead {
  raw: RawDocument;
  results: ExtractedFieldResult[];
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

  const { results, documentCategory, candidateNotes } = isImageSource
    ? reconcileImageExtraction({ documentId, documentName, ocrResults, visionResult })
    : { results: ocrResults, documentCategory: null, candidateNotes: undefined };
  return { raw, results, documentCategory, candidateNotes, visionResult, isImageSource, documentId, documentName };
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
  };
}
