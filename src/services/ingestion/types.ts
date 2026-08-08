import type { DocumentFileType } from '../../types';

export interface RawDocumentPage {
  pageNumber: number;
  text: string;
}

/** A table found in a document: a spreadsheet sheet, a CSV, or a DOCX table. */
export interface RawTable {
  sheetName?: string;
  headers: string[];
  rows: string[][];
}

/**
 * The common shape every file-type parser produces, decoupled from both the source file format
 * and from insurance-domain knowledge. extractInsuranceFields() is the only thing that reads
 * these and knows what a "DOT number" is.
 */
export interface RawDocument {
  documentName: string;
  fileType: DocumentFileType;
  /** Full text, concatenated across pages/paragraphs. Empty string if none was extractable. */
  text: string;
  /** Per-page text, PDF only — lets extraction attribute a match to a page number. */
  pages?: RawDocumentPage[];
  /** Structured tables found in the document, if any. */
  tables?: RawTable[];
  /** Non-fatal problems parsing this file, e.g. a scanned PDF with no embedded text. */
  warnings: string[];
}
