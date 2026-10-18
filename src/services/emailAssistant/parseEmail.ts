/**
 * Email Assistant — reads a pasted email or an .eml file into plain text and its attachments.
 *
 * Deliberately inert: HTML is converted to text and never rendered, links are never followed, and
 * nothing is sent or stored here. Attachment contents are decoded in the browser only so they can be
 * fingerprinted (attachments.ts) and, if the agent approves, imported to the account through the
 * normal upload checks — never opened or run.
 */

/** An .eml file, attachments included — the same 25 MB limit as any upload. */
export const MAX_EMAIL_BYTES = 25 * 1024 * 1024;
/** Pasted text. */
export const MAX_PASTE_BYTES = 200 * 1024;
/** Attachments decoded in total; past this they are listed but not read. */
export const MAX_DECODED_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Body text kept for review; anything longer is cut (and flagged). */
export const MAX_BODY_CHARS = 60_000;
const MAX_ATTACHMENTS = 20;
const MAX_MIME_DEPTH = 6;
const MAX_MIME_PARTS = 200;

export interface EmailAddress {
  name?: string;
  address?: string;
}

export interface ParsedAttachment {
  name: string;
  contentType: string;
  sizeBytes: number;
  /** The decoded file, when it could be read within the limits. Never rendered or run. */
  data?: Uint8Array;
  /** Why it can't be read or imported (an Outlook-only format, too large, an attached email …). */
  unreadable?: string;
}

export interface ParsedEmail {
  source: 'paste' | 'eml';
  from: EmailAddress;
  replyTo?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** As written in the Date header (pasted emails may have "Sent:" instead). */
  dateHeader?: string;
  /** ISO timestamp, when the date could be read. */
  date?: string;
  messageId?: string;
  /** The whole readable body, quoted history included (HTML already turned into text). */
  text: string;
  /** Only the new part of the message — quoted replies and forwarded history removed. Extraction reads this. */
  newText: string;
  /** Raw HTML parts, kept only so the safety checks can look for hidden text and disguised links. Never rendered. */
  html: string[];
  attachments: ParsedAttachment[];
  /** Authentication-Results, when the .eml carries them (a pasted email never does). */
  auth: { spf?: string; dkim?: string; dmarc?: string };
  /** Problems reading the email itself (cut short, unknown encoding …). */
  warnings: string[];
}

export class EmailTooLargeError extends Error {
  constructor(pasted = false) {
    super(pasted ? `Pasted text is limited to ${MAX_PASTE_BYTES / 1024} KB. Paste only the message, or upload the .eml file.` : `This email is larger than ${MAX_EMAIL_BYTES / 1024 / 1024} MB. Ask the sender for a smaller one, or paste only the message text.`);
  }
}

// ── headers ─────────────────────────────────────────────────────────────────────────────────────

type Headers = Map<string, string[]>;

/** Splits a header block from its body at the first empty line; unfolds continued header lines. */
function splitHeaders(raw: string): { headers: Headers; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers: Headers = new Map();
  const lines = head.split(/\r?\n/);
  let current: string | null = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current !== null) {
      const list = headers.get(current)!;
      list[list.length - 1] += ' ' + line.trim();
      continue;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    current = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers.set(current, [...(headers.get(current) ?? []), value]);
  }
  return { headers, body };
}

const first = (h: Headers, name: string) => h.get(name)?.[0];

function bytesToString(bytes: Uint8Array, charset = 'utf-8'): string {
  const cs = charset.toLowerCase().replace(/^"|"$/g, '');
  try {
    return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const bin = atob(clean.length % 4 === 0 ? clean : clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '='));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

function quotedPrintableToBytes(qp: string, headerMode = false): Uint8Array {
  const src = (headerMode ? qp.replace(/_/g, ' ') : qp).replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = src.charCodeAt(i);
      if (code < 128) out.push(code);
      else out.push(...new TextEncoder().encode(c));
    }
  }
  return new Uint8Array(out);
}

/** RFC 2047 encoded words ("=?utf-8?B?…?=") in a header. */
export function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) =>
      bytesToString(enc.toUpperCase() === 'B' ? base64ToBytes(text) : quotedPrintableToBytes(text, true), charset)
    );
}

/** "Pat Lee <pat@example.com>", "pat@example.com", '"Lee, Pat" <pat@example.com>'. */
export function parseAddress(value: string | undefined): EmailAddress {
  if (!value) return {};
  const v = decodeHeaderWords(value).trim();
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(v);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { ...(name ? { name } : {}), address: angle[2].trim().toLowerCase() };
  }
  const bare = /[^\s<>()"]+@[^\s<>()"]+/.exec(v);
  if (bare) return { address: bare[0].toLowerCase().replace(/[.,;]+$/, '') };
  return v ? { name: v } : {};
}

/** Splits an address list on commas outside quotes and angle brackets. */
function parseAddressList(value: string | undefined): EmailAddress[] {
  if (!value) return [];
  const parts: string[] = [];
  let buf = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle++;
    if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if ((ch === ',' || ch === ';') && !quoted && angle === 0) {
      parts.push(buf);
      buf = '';
    } else buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => parseAddress(p)).filter((a) => a.address || a.name);
}

function headerParams(value: string | undefined): { value: string; params: Record<string, string> } {
  if (!value) return { value: '', params: {} };
  const [main, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    const key = p.slice(0, idx).trim().toLowerCase().replace(/\*$/, '');
    let val = p.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    // RFC 2231 (filename*=utf-8''Loss%20Runs.pdf)
    const ext = /^([^']*)'[^']*'(.*)$/.exec(val);
    if (ext && /\*$/.test(p.slice(0, idx).trim())) {
      try {
        val = decodeURIComponent(ext[2]);
      } catch {
        val = ext[2];
      }
    }
    params[key] = decodeHeaderWords(val);
  }
  return { value: main.trim().toLowerCase(), params };
}

// ── HTML → text ─────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Elements styled to be invisible — removed from the text (and reported by the safety checks). */
const HIDDEN_STYLE = /style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(?:\.0+)?\s*(?:;|["']))[^"']*["']/i;

const HIDDEN_OPEN = new RegExp(`<(\\w+)\\b[^>]*${HIDDEN_STYLE.source}[^>]*>`, 'i');

/** Removes each invisibly-styled element with everything inside it (nested same-name tags counted). */
function removeHiddenElements(html: string): string {
  let s = html;
  for (let guard = 0; guard < 200; guard++) {
    const m = HIDDEN_OPEN.exec(s);
    if (!m) break;
    const tag = m[1].toLowerCase();
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = s.length;
    for (let t = re.exec(s); t; t = re.exec(s)) {
      depth += t[1] ? -1 : t[0].endsWith('/>') ? 0 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    s = `${s.slice(0, m.index)} ${s.slice(end)}`;
  }
  return s;
}

/** Plain text from HTML, without ever rendering it. Scripts, styles, comments and hidden elements are dropped. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = removeHiddenElements(s);
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|section|article)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── MIME ────────────────────────────────────────────────────────────────────────────────────────

interface Collected {
  plain: string[];
  html: string[];
  attachments: ParsedAttachment[];
  warnings: string[];
  parts: number;
  decodedBytes: number;
}

function decodePart(body: string, transferEncoding: string | undefined): Uint8Array {
  const enc = (transferEncoding ?? '').trim().toLowerCase();
  if (enc === 'base64') return base64ToBytes(body);
  if (enc === 'quoted-printable') return quotedPrintableToBytes(body);
  return new TextEncoder().encode(body);
}

/** Size of an attachment without decoding it (base64 → ¾ of its length). */
function encodedSize(body: string, transferEncoding: string | undefined): number {
  const enc = (transferEncoding ?? '').trim().toLowerCase();
  if (enc === 'base64') return Math.floor((body.replace(/[^A-Za-z0-9+/]/g, '').length * 3) / 4);
  return body.length;
}

function walkMime(raw: string, out: Collected, depth: number): void {
  if (++out.parts > MAX_MIME_PARTS) {
    if (out.parts === MAX_MIME_PARTS + 1) out.warnings.push('This email has too many parts; only the first ones were read.');
    return;
  }
  const { headers, body } = splitHeaders(raw);
  const ct = headerParams(first(headers, 'content-type') ?? 'text/plain');
  const disposition = headerParams(first(headers, 'content-disposition'));
  const cte = first(headers, 'content-transfer-encoding');

  if (ct.value.startsWith('multipart/')) {
    const boundary = ct.params.boundary;
    if (!boundary) {
      out.warnings.push('A multipart section had no boundary and was skipped.');
      return;
    }
    if (depth >= MAX_MIME_DEPTH) {
      out.warnings.push('This email is nested too deeply; inner parts were skipped.');
      return;
    }
    const delimiter = `--${boundary}`;
    const sections = body.split(delimiter).slice(1);
    for (const section of sections) {
      if (section.startsWith('--')) break; // closing delimiter
      walkMime(section.replace(/^\r?\n/, ''), out, depth + 1);
    }
    return;
  }

  const filename = disposition.params.filename ?? ct.params.name;
  const isAttachment = disposition.value === 'attachment' || (!!filename && !ct.value.startsWith('text/')) || (!!filename && disposition.value !== 'inline');
  if (isAttachment || (!ct.value.startsWith('text/') && ct.value !== 'message/rfc822')) {
    if (out.attachments.length < MAX_ATTACHMENTS) {
      const name = (filename || 'unnamed attachment').slice(0, 200);
      const sizeBytes = encodedSize(body, cte);
      const att: ParsedAttachment = { name, contentType: ct.value || 'application/octet-stream', sizeBytes };
      if (/^winmail\.dat$/i.test(name) || ct.value === 'application/ms-tnef') att.unreadable = 'Outlook-only format (winmail.dat) — ask the sender to resend the files directly.';
      else if (sizeBytes > MAX_DECODED_ATTACHMENT_BYTES || out.decodedBytes + sizeBytes > MAX_DECODED_ATTACHMENT_BYTES) att.unreadable = 'Too large to read here (attachments over 25 MB in total).';
      else {
        att.data = decodePart(body, cte);
        att.sizeBytes = att.data.length;
        out.decodedBytes += att.data.length;
      }
      out.attachments.push(att);
    } else if (out.attachments.length === MAX_ATTACHMENTS) {
      out.warnings.push(`Only the first ${MAX_ATTACHMENTS} attachments are listed.`);
    }
    return;
  }
  if (ct.value === 'message/rfc822') {
    // A forwarded email attached whole: read its text as part of the history, not the new message,
    // and list it — its own attachments aren't imported from here.
    if (out.attachments.length < MAX_ATTACHMENTS) out.attachments.push({ name: (filename || 'forwarded email.eml').slice(0, 200), contentType: 'message/rfc822', sizeBytes: body.length, unreadable: 'An attached email — its text is read as part of the thread; open it separately to review its own attachments.' });
    if (depth < MAX_MIME_DEPTH) walkMime(body, out, depth + 1);
    return;
  }
  const text = bytesToString(decodePart(body, cte), ct.params.charset);
  if (ct.value === 'text/html') out.html.push(text);
  else out.plain.push(text);
}

// ── quoted history ──────────────────────────────────────────────────────────────────────────────

const HISTORY_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}/i,
  /^-{2,}\s*forwarded message\s*-{2,}/i,
  /^begin forwarded message:?/i,
  /^on .{3,200}\bwrote:\s*$/i,
  /^_{8,}\s*$/,
];

/**
 * Only the newest message of a thread: stops at the first "On … wrote:", "-----Original Message-----",
 * a quoted header block (From: … Sent:/Date: …) or ">"-quoted lines. Earlier requests in the thread
 * are therefore never extracted again as new ones.
 */
export function stripQuotedHistory(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (HISTORY_MARKERS.some((re) => re.test(line))) break;
    // "On Tue, Oct 14, 2026 at 9:02 AM Pat Lee <pat@x.com>" + "wrote:" on the next line
    if (/^on .{3,200}$/i.test(line) && /^.{0,120}wrote:\s*$/i.test((lines[i + 1] ?? '').trim()) && /\d/.test(line)) break;
    if (/^from:\s*\S/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date|to|subject):\s*/i.test(l.trim())) && kept.some((k) => k.trim())) break;
    if (/^>/.test(line)) continue;
    kept.push(lines[i]);
  }
  return kept.join('\n').trim();
}

// ── entry points ────────────────────────────────────────────────────────────────────────────────

function clip(text: string, warnings: string[]): string {
  if (text.length <= MAX_BODY_CHARS) return text;
  warnings.push('The message is very long; only the beginning was read.');
  return text.slice(0, MAX_BODY_CHARS);
}

function readDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.replace(/\s+\(.*\)\s*$/, ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function readAuth(headers: Headers): ParsedEmail['auth'] {
  const all = (headers.get('authentication-results') ?? []).join(' ; ').toLowerCase();
  const pick = (k: string) => new RegExp(`\\b${k}=(\\w+)`).exec(all)?.[1];
  const spfHeader = first(headers, 'received-spf')?.toLowerCase().split(/\s/)[0];
  return { spf: pick('spf') ?? spfHeader, dkim: pick('dkim'), dmarc: pick('dmarc') };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Reads a whole .eml file (RFC 5322 + MIME). */
export function parseEml(raw: string): ParsedEmail {
  if (byteLength(raw) > MAX_EMAIL_BYTES) throw new EmailTooLargeError();
  const { headers } = splitHeaders(raw);
  const collected: Collected = { plain: [], html: [], attachments: [], warnings: [], parts: 0, decodedBytes: 0 };
  walkMime(raw, collected, 0);
  const fromPlain = collected.plain.join('\n\n').trim();
  const text = clip((fromPlain || collected.html.map(htmlToText).join('\n\n')).replace(/\r\n/g, '\n').trim(), collected.warnings);
  const dateHeader = first(headers, 'date');
  return {
    source: 'eml',
    from: parseAddress(first(headers, 'from')),
    replyTo: first(headers, 'reply-to') ? parseAddress(first(headers, 'reply-to')) : undefined,
    to: parseAddressList(first(headers, 'to')),
    cc: parseAddressList(first(headers, 'cc')),
    subject: decodeHeaderWords(first(headers, 'subject') ?? '').slice(0, 500),
    dateHeader,
    date: readDate(dateHeader),
    messageId: first(headers, 'message-id')?.slice(0, 300),
    text,
    newText: stripQuotedHistory(text),
    html: collected.html,
    attachments: collected.attachments,
    auth: readAuth(headers),
    warnings: collected.warnings,
  };
}

const PASTE_HEADER = /^(from|to|cc|sent|date|subject|reply-to):\s*(.*)$/i;

/**
 * Pasted email text. When it starts with header lines as mail apps copy them ("From: …", "Sent: …",
 * "To: …", "Subject: …"), those are read as headers; everything else is the body. Attachments and
 * authentication results can't be known from pasted text.
 */
export function parsePastedEmail(raw: string): ParsedEmail {
  if (byteLength(raw) > MAX_PASTE_BYTES) throw new EmailTooLargeError(true);
  const lines = raw.replace(/\r\n/g, '\n').replace(/^\s+/, '').split('\n');
  const found: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length && i < 12; i++) {
    const m = PASTE_HEADER.exec(lines[i].trim());
    if (!m) break;
    const key = m[1].toLowerCase();
    if (!(key in found)) found[key] = m[2].trim();
  }
  const bodyLines = Object.keys(found).length >= 2 ? lines.slice(i) : lines;
  const warnings: string[] = [];
  const text = clip(bodyLines.join('\n').trim(), warnings);
  const dateHeader = found.date ?? found.sent;
  return {
    source: 'paste',
    from: parseAddress(found.from),
    replyTo: found['reply-to'] ? parseAddress(found['reply-to']) : undefined,
    to: parseAddressList(found.to),
    cc: parseAddressList(found.cc),
    subject: decodeHeaderWords(found.subject ?? '').slice(0, 500),
    dateHeader,
    date: readDate(dateHeader),
    text,
    newText: stripQuotedHistory(text),
    html: /<\/?(html|body|div|p|a|span|table)\b/i.test(text) ? [text] : [],
    attachments: [],
    auth: {},
    warnings,
  };
}

/** A file is read as an .eml when it looks like one (headers, then MIME); otherwise as pasted text. */
export function parseEmailInput(raw: string, source: 'paste' | 'eml'): ParsedEmail {
  if (source === 'eml') return parseEml(raw);
  const looksLikeEml = /^(?:[\w-]+:.*\r?\n(?:[ \t].*\r?\n)*)+/.test(raw) && /^(mime-version|content-type|message-id|received):/im.test(raw.slice(0, 4000));
  return looksLikeEml ? parseEml(raw) : parsePastedEmail(raw);
}
