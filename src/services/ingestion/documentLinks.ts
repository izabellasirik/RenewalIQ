import { inferFileType } from '../../utils/documents';

/**
 * Documents that arrive as a LINK instead of the file itself — a .url / .webloc shortcut, a tiny text
 * file that's just a URL, or a link dragged/pasted from a browser or email. Deliberately narrow:
 * one https GET from the broker's own browser (never a server fetching on anyone's behalf), no
 * cookies or credentials sent, public internet hosts only, a size cap, and the response must really
 * be a document type Renewal IQ already reads. Anything else — a login page, a private share, a
 * blocked download — is reported as not accessible; nothing is ever extracted from it.
 */

export const LINK_UNREADABLE_MESSAGE = 'Document could not be accessed — upload the file directly.';

/** Thrown when a link can't be turned into a readable document. `sourceUrl` is kept for traceability. */
export class DocumentLinkError extends Error {
  readonly sourceUrl: string;
  /** Why, for logs/support — the broker-facing message is always LINK_UNREADABLE_MESSAGE. */
  readonly reason: string;
  constructor(sourceUrl: string, reason: string) {
    super(LINK_UNREADABLE_MESSAGE);
    this.name = 'DocumentLinkError';
    this.sourceUrl = sourceUrl;
    this.reason = reason;
  }
}

const MAX_LINK_FILE_BYTES = 16 * 1024;
const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const SINGLE_URL = /^https?:\/\/\S+$/i;

/** The URL a file stands for, when the file is only a link to the real document; null for a real document. */
export async function detectDocumentLink(file: File): Promise<string | null> {
  if (file.size === 0 || file.size > MAX_LINK_FILE_BYTES) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) return null;
  const text = (await file.text()).trim();
  if (ext === 'url') return text.match(/^URL=(\S+)$/im)?.[1] ?? null; // Windows internet shortcut
  if (ext === 'webloc') return text.match(/<string>\s*(https?:\/\/[^<\s]+)\s*<\/string>/i)?.[1] ?? null; // macOS web location
  if (SINGLE_URL.test(text)) return text; // a text (or mislabeled) file that's nothing but a URL
  const refresh = text.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i)?.[1]; // tiny redirect page
  return refresh && SINGLE_URL.test(refresh) ? refresh : null;
}

/** https on the public internet only: no plain http, no localhost / IP literals / internal names, no embedded credentials. */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return false;
  return true;
}

/** Common "view" share links rewritten to their direct-download form. Everything else is used as-is. */
export function directDownloadUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === 'drive.google.com') {
      const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id');
      if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    }
    if (host === 'www.dropbox.com' || host === 'dropbox.com') {
      url.searchParams.set('dl', '1');
      return url.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

const TYPE_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function filenameFrom(res: Response, url: string): string | null {
  const disposition = res.headers.get('content-disposition') ?? '';
  const quoted = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  if (quoted) return decodeURIComponent(quoted.trim());
  const last = new URL(url).pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}

/** Downloads the document a link points to, or throws DocumentLinkError — never returns something that isn't a readable document. */
export async function fetchLinkedDocument(sourceUrl: string, fallbackName: string): Promise<File> {
  if (!isFetchableUrl(sourceUrl)) throw new DocumentLinkError(sourceUrl, 'Only public https links can be opened.');
  const target = directDownloadUrl(sourceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal });
  } catch {
    // Network error, timeout, or the site doesn't allow downloads from other websites (CORS).
    throw new DocumentLinkError(sourceUrl, 'The site did not allow the document to be downloaded.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new DocumentLinkError(sourceUrl, `The link returned HTTP ${res.status}.`);
  if (res.url && !isFetchableUrl(res.url)) throw new DocumentLinkError(sourceUrl, 'The link redirected somewhere that is not allowed.');
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_FETCH_BYTES) throw new DocumentLinkError(sourceUrl, 'The linked file is too large.');

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const nameFromServer = filenameFrom(res, res.url || target);
  let ext = TYPE_TO_EXT[contentType];
  if (!ext && (contentType === 'application/octet-stream' || contentType === '')) {
    // Generic download: trust the file name only if it's a type we read.
    const byName = nameFromServer ? inferFileType(nameFromServer) : 'other';
    if (byName !== 'other' && byName !== 'txt') ext = nameFromServer!.split('.').pop()!.toLowerCase();
  }
  // HTML (a login / sign-in / preview page) or anything else we don't read: not the document.
  if (!ext) throw new DocumentLinkError(sourceUrl, `The link opened a ${contentType || 'unknown'} page, not a document (it may need a sign-in).`);

  const blob = await res.blob();
  if (blob.size === 0) throw new DocumentLinkError(sourceUrl, 'The linked file is empty.');
  if (blob.size > MAX_FETCH_BYTES) throw new DocumentLinkError(sourceUrl, 'The linked file is too large.');
  if (ext === 'pdf') {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') throw new DocumentLinkError(sourceUrl, 'The link did not return a real PDF.');
  }
  const base = (nameFromServer ?? fallbackName).replace(/\.(url|webloc|txt|html?)$/i, '');
  const name = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  return new File([blob], name, { type: contentType || 'application/octet-stream' });
}

/** A link dropped or pasted into the upload box, turned into a tiny .url shortcut file so it goes through the same pipeline. */
export function linkAsFile(url: string): File {
  let host = 'link';
  try {
    host = new URL(url).hostname;
  } catch {
    // keep default
  }
  return new File([`[InternetShortcut]\nURL=${url}\n`], `${host}.url`, { type: 'text/plain' });
}
