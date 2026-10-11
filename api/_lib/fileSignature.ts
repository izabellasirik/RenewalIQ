/**
 * What a file really is, from its first bytes — never from its name or the type the browser
 * claims. Shared by the browser (an early, friendly refusal before uploading) and the server
 * (api/verify-upload — the check that counts). Plain TypeScript, no Node or DOM APIs.
 *
 * Accepted: PDF, JPEG, PNG, WebP, HEIC/HEIF, Word/Excel (.docx/.xlsx and the older .doc/.xls),
 * CSV and plain text — at most 25 MB. The extension must agree with the contents: a renamed file
 * (an .exe called .pdf, an HTML page called .txt) is refused.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** How much of the file the check needs. */
export const SIGNATURE_BYTES = 4096;

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic' | 'zip' | 'ole' | 'text';

/** Extension → the kind its contents must be, and the content type it is stored with. */
export const ALLOWED_EXTENSIONS: Record<string, { kind: FileKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  jpg: { kind: 'jpeg', mime: 'image/jpeg' },
  jpeg: { kind: 'jpeg', mime: 'image/jpeg' },
  png: { kind: 'png', mime: 'image/png' },
  webp: { kind: 'webp', mime: 'image/webp' },
  heic: { kind: 'heic', mime: 'image/heic' },
  heif: { kind: 'heic', mime: 'image/heif' },
  docx: { kind: 'zip', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'zip', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  doc: { kind: 'ole', mime: 'application/msword' },
  xls: { kind: 'ole', mime: 'application/vnd.ms-excel' },
  csv: { kind: 'text', mime: 'text/csv' },
  txt: { kind: 'text', mime: 'text/plain' },
};

/** Every content type a stored upload may have (the buckets' allow-list, 0048). */
export const ALLOWED_MIME_TYPES = Array.from(new Set(Object.values(ALLOWED_EXTENSIONS).map((e) => e.mime)));

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** The content type to store a file with — from its extension, never the browser's guess. */
export function contentTypeFor(name: string): string | undefined {
  return ALLOWED_EXTENSIONS[extensionOf(name)]?.mime;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

export function detectKind(b: Uint8Array): FileKind | null {
  if (b.length < 4) return b.length > 0 && looksLikeText(b) ? 'text' : null;
  const head = ascii(b, 0, Math.min(b.length, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))) return 'heic';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (looksLikeText(b)) return 'text';
  return null;
}

/** Text a spreadsheet or note would contain: no NUL bytes, mostly printable, and not a web page or script in disguise. */
function looksLikeText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  // Programs and scripts are never text here, however printable: Windows (MZ), Linux (ELF), Mac (Mach-O), shebang scripts.
  if (ascii(b, 0, 2) === 'MZ' || ascii(b, 0, 4) === '\x7fELF' || ascii(b, 0, 2) === '#!' || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0)) return false;
  let printable = 0;
  for (const c of b) if (c === 9 || c === 10 || c === 13 || c >= 32) printable++;
  if (printable / b.length < 0.95) return false;
  const sample = ascii(b, 0, Math.min(b.length, SIGNATURE_BYTES)).toLowerCase();
  return !/<\s*(script|html|svg|iframe|object|embed)\b|<\?php/.test(sample);
}

export type UploadCheck = { ok: true; kind: FileKind; mime: string } | { ok: false; reason: string };

const LABEL: Record<FileKind, string> = { pdf: 'a PDF', jpeg: 'a JPEG image', png: 'a PNG image', webp: 'a WebP image', heic: 'an iPhone (HEIC) photo', zip: 'a Word or Excel file', ole: 'a Word or Excel file', text: 'text' };

/** The whole rule: allowed extension, within the size limit, and contents that are what the extension says. */
export function checkUpload(name: string, size: number, firstBytes: Uint8Array): UploadCheck {
  const ext = extensionOf(name);
  const allowed = ALLOWED_EXTENSIONS[ext];
  if (!allowed) return { ok: false, reason: `${ext ? `.${ext} files aren't accepted` : 'Files without an extension aren’t accepted'} — send a PDF, photo (JPG, PNG, WebP, HEIC), Word, Excel, CSV or text file.` };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: `${name} is ${(size / 1024 / 1024).toFixed(1)} MB — files can be at most 25 MB.` };
  if (size === 0) return { ok: false, reason: `${name} is empty.` };
  const kind = detectKind(firstBytes);
  if (kind !== allowed.kind) return { ok: false, reason: `${name} doesn't contain what a .${ext} file should${kind ? ` (it looks like ${LABEL[kind]})` : ''} — it may be damaged or renamed.` };
  return { ok: true, kind, mime: allowed.mime };
}
