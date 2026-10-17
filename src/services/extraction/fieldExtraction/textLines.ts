import type { RawDocument } from '../../ingestion';
import { lineTexts } from '../../ingestion/pdfLayout';

export interface TextLine {
  text: string;
  page?: number;
  /** PDF only: which layout line (RawDocument.layout) this text came from — ties a match to a table row or a section. */
  index?: number;
}

/** Flattens a RawDocument into individual lines, keeping page numbers where available (PDF only). */
export function toTextLines(doc: RawDocument): TextLine[] {
  if (doc.layout && doc.layout.length > 0) {
    return doc.layout.flatMap((line, index) => lineTexts(line).map((text) => ({ text, page: line.page, index })));
  }
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages.flatMap((page) => page.text.split('\n').map((text) => ({ text, page: page.pageNumber })));
  }
  return doc.text.split('\n').map((text) => ({ text }));
}

/** Truncates a line for use as a human-readable source excerpt. */
export function toExcerpt(text: string, maxLength = 160): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}
