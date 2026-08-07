import type { ExtractionProvider, ExtractedFieldResult, UploadedDocument } from '../../types';
import { extractionPayloads } from '../../data/sampleDocuments';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stand-in for a real document-AI / LLM extraction provider. Returns canned
 * field results keyed by document id after a simulated processing delay so
 * the UI can demonstrate the async upload -> extract -> review flow.
 *
 * A real provider (LLM/OCR/vendor API) implements the same ExtractionProvider
 * interface and can be swapped in without touching any calling code.
 */
export const mockExtractionProvider: ExtractionProvider = {
  async extract(doc: UploadedDocument): Promise<ExtractedFieldResult[]> {
    await delay(900 + Math.random() * 900);
    return extractionPayloads[doc.id] ?? [];
  },
};
