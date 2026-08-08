import { inferFileType } from '../../utils/documents';
import type { RawDocument } from './types';
import { parsePdf } from './parsePdf';
import { parseDocx } from './parseDocx';
import { parseSpreadsheet } from './parseSpreadsheet';
import { parseCsv } from './parseCsv';
import { parseText } from './parseText';

/** Dispatches a File to the parser for its type. Unrecognized extensions fall back to plain text. */
export async function parseFile(file: File): Promise<RawDocument> {
  const fileType = inferFileType(file.name);
  switch (fileType) {
    case 'pdf':
      return parsePdf(file);
    case 'docx':
      return parseDocx(file);
    case 'xlsx':
      return parseSpreadsheet(file);
    case 'csv':
      return parseCsv(file);
    case 'txt':
    case 'other':
      return parseText(file);
  }
}
