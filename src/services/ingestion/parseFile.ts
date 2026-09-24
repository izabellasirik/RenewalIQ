import { inferFileType } from '../../utils/documents';
import type { RawDocument } from './types';
import { parsePdf } from './parsePdf';
import { parseDocx } from './parseDocx';
import { parseSpreadsheet } from './parseSpreadsheet';
import { parseCsv } from './parseCsv';
import { parseText } from './parseText';
import { parseImage } from './parseImage';
import { DocumentLinkError, detectDocumentLink, fetchLinkedDocument } from './documentLinks';

/**
 * HEIC/HEIF (the default format for recent iPhone photos) isn't decodable by any browser API used
 * here — no <canvas>/createImageBitmap support without a dedicated WASM conversion library, which
 * would add real bundle weight for a format most upload flows already avoid (iPhones re-encode to
 * JPEG automatically when sharing via most apps/AirDrop-to-non-Apple, browsers, etc.). Rather than
 * silently reading the raw bytes as if they were text (garbled, and a poor experience with zero
 * explanation), this is called out explicitly so the broker gets a clear, immediate reason instead.
 */
const UNSUPPORTED_IMAGE_EXTENSIONS = ['heic', 'heif'];

/**
 * Dispatches a File to the parser for its type. Unrecognized extensions fall back to plain text.
 * A file that's only a link to the real document (see documentLinks.ts) is downloaded and parsed
 * instead — or throws DocumentLinkError ("Document could not be accessed — upload the file
 * directly."), so a link is never read as if it were the document.
 */
export async function parseFile(file: File): Promise<RawDocument> {
  const link = await detectDocumentLink(file);
  if (link) {
    const fetched = await fetchLinkedDocument(link, file.name);
    if (await detectDocumentLink(fetched)) throw new DocumentLinkError(link, 'The link pointed to another link.');
    const raw = await parseByType(fetched);
    return { ...raw, sourceUrl: link, linkedFile: fetched };
  }
  return parseByType(file);
}

async function parseByType(file: File): Promise<RawDocument> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`.${ext.toUpperCase()} photos aren't supported yet — please export or re-save this as a JPG, PNG, or WEBP and upload again.`);
  }

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
    case 'image':
      return parseImage(file);
    case 'txt':
    case 'other':
      return parseText(file);
  }
}
