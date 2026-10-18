import type { UploadedDocument } from '../../types';
import { checkUpload, SIGNATURE_BYTES } from '../../../api/_lib/fileSignature';
import { detectDocumentSignals, REQUIREMENT_KIND_LABELS, sameCompany, type RequirementKind } from '../requests/documentSignals';
import { normalizeDot } from '../intake/duplicateDetection';
import { formatShortDate } from '../workflow/dates';
import type { ParsedAttachment, ParsedEmail } from './parseEmail';
import { DANGEROUS_EXT } from './safetyChecks';
import { extractIdentifiers } from './rulesExtractor';
import type { EmailExtraction, ExtractedDocument } from './types';

/**
 * What each attachment is and whether it's new: a SHA-256 fingerprint of its bytes (compared with
 * the account's documents and with attachments of emails reviewed before), the kind of document it
 * evidently is, and anything in it that contradicts the email or the account. Nothing is imported
 * here — an attachment reaches the account only when the agent approves its import.
 */

export type AttachmentStatus =
  /** Not seen before — can be imported. */
  | 'new'
  /** The same file (same fingerprint) is already on the account. */
  | 'on_account'
  /** A document with the same name and size is on the account (it has no fingerprint to compare). */
  | 'possible_duplicate'
  /** The same file came with an earlier email reviewed for this account. */
  | 'seen_before'
  /** The same file appears earlier in this email. */
  | 'repeated_in_email'
  /** A type that can run code or disguise a page — never imported. */
  | 'blocked'
  /** Not a type the account accepts, or its contents don't match its name. */
  | 'not_supported'
  /** Couldn't be read here (Outlook-only format, too large, an attached email …). */
  | 'unreadable';

export interface AttachmentReview {
  index: number;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  kinds: RequirementKind[];
  insuredNames: string[];
  dotNumbers: string[];
  status: AttachmentStatus;
  detail: string;
  duplicateOf?: { documentId?: string; name: string; when?: string };
  /** Can be imported if the agent approves. */
  importable: boolean;
  /** Ticked for import when the review opens. */
  defaultSelected: boolean;
}

export type ContradictionCode = 'said_attached_none_attached' | 'said_attached_kind_missing' | 'insured_mismatch' | 'dot_mismatch' | 'same_kind_different_insured';

export interface Contradiction {
  code: ContradictionCode;
  message: string;
  attachmentIndex?: number;
}

/** An earlier email's attachment, from the stored reviews (fingerprints only). */
export interface EarlierAttachment {
  sha256: string;
  name: string;
  reviewedAt: string;
}

export interface AttachmentContext {
  documents: UploadedDocument[];
  namedInsured: string;
  dotNumber?: string | null;
  earlier?: EarlierAttachment[];
}

export interface AttachmentDeps {
  /** Text of an attachment, to tell what it is. Default: plain-text and CSV files only. */
  readText?: (att: ParsedAttachment) => Promise<string | null>;
}

/** Which checklist kinds a document the email names can be recognised by. */
const KIND_OF_TEMPLATE: Record<string, RequirementKind> = { loss_runs: 'loss_runs', mvr: 'mvr', ifta: 'ifta', unit_list: 'unit_list', driver_list: 'driver_list', application: 'application' };
const KIND_OF_LABEL: Record<string, RequirementKind> = { 'CDL copies': 'driver_license', 'Vehicle registrations': 'vehicle_registration' };

export function kindOfDocument(doc: Pick<ExtractedDocument, 'templateKey' | 'label'>): RequirementKind | undefined {
  if (doc.templateKey && KIND_OF_TEMPLATE[doc.templateKey]) return KIND_OF_TEMPLATE[doc.templateKey];
  if (/^MVR\b/.test(doc.label)) return 'mvr';
  return KIND_OF_LABEL[doc.label];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

async function defaultReadText(att: ParsedAttachment): Promise<string | null> {
  if (!att.data || (!/^text\/|csv/.test(att.contentType) && !/\.(txt|csv)$/i.test(att.name))) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(att.data.slice(0, 512 * 1024));
}

const withSize = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** What can be known about an attachment without the account: readable or not, fingerprint, kind. */
export interface AttachmentFacts {
  index: number;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Set when it can't be imported at all, whatever the account. */
  refused?: { status: 'blocked' | 'not_supported' | 'unreadable'; detail: string };
  sha256?: string;
  kinds: RequirementKind[];
  insuredNames: string[];
  dotNumbers: string[];
  /** Whether its text could be read (otherwise its kind comes from its name only). */
  textRead: boolean;
}

/** Step 1 (once per email): checks, fingerprints and reads every attachment. */
export async function readAttachments(email: ParsedEmail, deps: AttachmentDeps = {}): Promise<AttachmentFacts[]> {
  const readText = deps.readText ?? defaultReadText;
  const out: AttachmentFacts[] = [];
  for (const [index, att] of email.attachments.entries()) {
    const base: AttachmentFacts = { index, name: att.name, contentType: att.contentType, sizeBytes: att.sizeBytes, kinds: [], insuredNames: [], dotNumbers: [], textRead: false };
    if (DANGEROUS_EXT.test(att.name.trim()) || /\.(pdf|docx?|xlsx?|jpe?g|png)\.(exe|js|scr|bat|cmd|vbs|html?)$/i.test(att.name.trim())) {
      out.push({ ...base, refused: { status: 'blocked', detail: 'A file type that can run code or disguise a page. Not imported — don’t open it.' } });
      continue;
    }
    if (att.unreadable || !att.data) {
      out.push({ ...base, refused: { status: 'unreadable', detail: att.unreadable ?? 'Couldn’t be read from this email.' } });
      continue;
    }
    const check = checkUpload(att.name, att.data.length, att.data.slice(0, SIGNATURE_BYTES));
    if (!check.ok) {
      out.push({ ...base, refused: { status: 'not_supported', detail: check.reason } });
      continue;
    }
    let text: string | null = null;
    try {
      text = await readText(att);
    } catch {
      text = null;
    }
    const signals = detectDocumentSignals({ text: text ?? '', fileName: att.name });
    out.push({ ...base, sha256: await sha256Hex(att.data), kinds: signals.kinds, insuredNames: signals.insuredNames ?? [], dotNumbers: text ? extractIdentifiers(text).dotNumbers : [], textRead: !!text });
  }
  return out;
}

/** Step 2 (per account): duplicates against the account and earlier emails, and contradictions. */
export function reviewAttachments(email: ParsedEmail, facts: AttachmentFacts[], extraction: EmailExtraction, ctx: AttachmentContext): { attachments: AttachmentReview[]; contradictions: Contradiction[] } {
  const accountDot = normalizeDot(ctx.dotNumber);
  const seenInEmail = new Map<string, number>();
  const attachments: AttachmentReview[] = [];

  for (const f of facts) {
    const base = { index: f.index, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256: f.sha256, kinds: f.kinds, insuredNames: f.insuredNames, dotNumbers: f.dotNumbers };
    const done = (status: AttachmentStatus, detail: string, extra: Partial<AttachmentReview> = {}) =>
      attachments.push({ ...base, status, detail, importable: status === 'new' || status === 'possible_duplicate' || status === 'seen_before', defaultSelected: status === 'new', ...extra });
    if (f.refused) {
      done(f.refused.status, f.refused.detail);
      continue;
    }
    const firstIndex = f.sha256 ? seenInEmail.get(f.sha256) : undefined;
    if (f.sha256 && firstIndex !== undefined) {
      done('repeated_in_email', `The same file as ${facts[firstIndex].name}, attached twice. Imported once at most.`, { duplicateOf: { name: facts[firstIndex].name } });
      continue;
    }
    if (f.sha256) seenInEmail.set(f.sha256, f.index);

    const sameFile = f.sha256 ? ctx.documents.find((d) => d.contentSha256 === f.sha256) : undefined;
    if (sameFile) {
      done('on_account', `Already on the account as ${sameFile.name} (uploaded ${formatShortDate(sameFile.uploadedAt.slice(0, 10))}).`, { duplicateOf: { documentId: sameFile.id, name: sameFile.name, when: sameFile.uploadedAt } });
      continue;
    }
    const sameNameSize = ctx.documents.find((d) => !d.contentSha256 && d.name.trim().toLowerCase() === f.name.trim().toLowerCase() && d.sizeBytes === f.sizeBytes);
    if (sameNameSize) {
      done('possible_duplicate', `A document with the same name and size (${withSize(sameNameSize.sizeBytes)}) is already on the account. Probably the same file — not ticked.`, { duplicateOf: { documentId: sameNameSize.id, name: sameNameSize.name, when: sameNameSize.uploadedAt } });
      continue;
    }
    const earlier = f.sha256 ? ctx.earlier?.find((e) => e.sha256 === f.sha256) : undefined;
    if (earlier) {
      done('seen_before', `The same file came with an earlier email reviewed ${formatShortDate(earlier.reviewedAt.slice(0, 10))} and wasn’t imported then. Not ticked.`, { duplicateOf: { name: earlier.name, when: earlier.reviewedAt } });
      continue;
    }
    const what = f.kinds.length ? `Looks like ${f.kinds.map((k) => REQUIREMENT_KIND_LABELS[k]).join(' / ')}.` : `Couldn’t tell what kind of document it is from its name${f.textRead ? ' or text' : ''}.`;
    done('new', `${what} Not on the account yet.`);
  }

  const contradictions: Contradiction[] = [];
  const provided = extraction.documents.filter((d) => d.stance === 'provided');
  if (provided.length && email.source === 'eml' && email.attachments.length === 0) {
    contradictions.push({ code: 'said_attached_none_attached', message: `The email says ${provided.map((d) => d.label).join(', ')} ${provided.length === 1 ? 'is' : 'are'} attached, but nothing is attached.` });
  }
  const readable = attachments.filter((a) => a.status !== 'blocked' && a.status !== 'unreadable' && a.status !== 'not_supported');
  // Only when every readable attachment could be identified: otherwise an unidentified one may be it.
  if (readable.length && readable.every((a) => a.kinds.length > 0)) {
    for (const d of provided) {
      const kind = kindOfDocument(d);
      if (kind && !readable.some((a) => a.kinds.includes(kind))) {
        contradictions.push({ code: 'said_attached_kind_missing', message: `The email says ${d.label} ${/s$/.test(d.label) ? 'are' : 'is'} attached, but no attachment looks like ${REQUIREMENT_KIND_LABELS[kind]} (attached: ${readable.map((a) => a.name).join(', ')}).` });
      }
    }
  }
  for (const a of readable) {
    const others = a.insuredNames.filter((n) => !sameCompany(n, ctx.namedInsured));
    if (others.length && !a.insuredNames.some((n) => sameCompany(n, ctx.namedInsured))) {
      contradictions.push({ code: 'insured_mismatch', attachmentIndex: a.index, message: `${a.name} names “${others[0]}” as the insured, not ${ctx.namedInsured}. It may belong to another client.` });
    }
    const dots = a.dotNumbers.map((d) => normalizeDot(d)).filter(Boolean);
    if (accountDot && dots.length && !dots.includes(accountDot)) {
      contradictions.push({ code: 'dot_mismatch', attachmentIndex: a.index, message: `${a.name} shows USDOT ${dots.join(', ')}, not this account’s ${accountDot}.` });
    }
  }
  // Two files of the same kind naming different insureds.
  for (const kind of new Set(readable.flatMap((a) => a.kinds))) {
    const named = readable.filter((a) => a.kinds.includes(kind) && a.insuredNames.length);
    for (let i = 1; i < named.length; i++) {
      if (!named[i].insuredNames.some((n) => named[0].insuredNames.some((m) => sameCompany(n, m)))) {
        contradictions.push({ code: 'same_kind_different_insured', attachmentIndex: named[i].index, message: `${named[0].name} and ${named[i].name} are both ${REQUIREMENT_KIND_LABELS[kind]} but name different insureds (“${named[0].insuredNames[0]}” and “${named[i].insuredNames[0]}”).` });
        break;
      }
    }
  }
  // A file that seems to be another client's is never ticked for import.
  for (const c of contradictions) {
    const a = c.attachmentIndex === undefined ? undefined : attachments.find((x) => x.index === c.attachmentIndex);
    if (a) a.defaultSelected = false;
  }
  return { attachments, contradictions };
}

/** The attachment as a File, for the account's normal upload (only after the agent approves). */
export function attachmentFile(att: ParsedAttachment): File | null {
  if (!att.data) return null;
  const bytes = new Uint8Array(att.data);
  return new File([bytes], att.name, { type: att.contentType || 'application/octet-stream' });
}
