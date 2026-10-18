import { EmailTooLargeError, MAX_EMAIL_BYTES, MAX_PASTE_BYTES } from './parseEmail';

/**
 * Where an email comes from. Today the agent uploads an .eml file or pastes the message; a Gmail or
 * Outlook connection can be added later as another EmailSource without changing anything after
 * loading (parse → read → match → suggest → approve). Every source gives back the raw message and a
 * reference to where it came from — never a live mailbox handle — and none can send email.
 */
export type EmailSourceKind = 'eml_upload' | 'paste' | 'gmail' | 'outlook';

export const SOURCE_LABELS: Record<EmailSourceKind, string> = {
  eml_upload: '.eml file',
  paste: 'pasted',
  gmail: 'Gmail',
  outlook: 'Outlook',
};

/** Identifiers only — kept with the review so the same message can be found again. */
export interface EmailSourceRef {
  kind: EmailSourceKind;
  /** The uploaded file's name. */
  fileName?: string;
  /** A mailbox's own id for the message (Gmail message id / Microsoft Graph message id). */
  providerMessageId?: string;
  providerThreadId?: string;
}

export interface LoadedEmail {
  raw: string;
  /** How to read `raw`: a full RFC 822 message, or text copied from a mail app. */
  format: 'eml' | 'paste';
  ref: EmailSourceRef;
}

export interface EmailSource {
  kind: EmailSourceKind;
  load(): Promise<LoadedEmail>;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** An .eml (or .txt) file the agent picked. Over 25 MB is refused before it's read. */
export function fileSource(file: File): EmailSource {
  return {
    kind: 'eml_upload',
    async load() {
      if (file.size > MAX_EMAIL_BYTES) throw new EmailTooLargeError();
      const raw = await file.text();
      const isEml = /\.eml$/i.test(file.name) || file.type === 'message/rfc822';
      if (!isEml && byteLength(raw) > MAX_PASTE_BYTES) throw new EmailTooLargeError(true);
      return { raw, format: isEml ? 'eml' : 'paste', ref: { kind: 'eml_upload', fileName: file.name.slice(0, 200) } };
    },
  };
}

/** Text pasted into the box. */
export function pasteSource(text: string): EmailSource {
  return {
    kind: 'paste',
    async load() {
      if (byteLength(text) > MAX_PASTE_BYTES) throw new EmailTooLargeError(true);
      return { raw: text, format: 'paste', ref: { kind: 'paste' } };
    },
  };
}

/**
 * The shape a mailbox connection will take (not built yet). Read-only by design:
 *  - Gmail: OAuth scope gmail.readonly; a message is fetched with users.messages.get?format=raw.
 *  - Outlook: Microsoft Graph Mail.Read; a message is fetched from /me/messages/{id}/$value.
 * Both return the RFC 822 message, so `source(id).load()` gives `format: 'eml'` and everything after
 * that is the same as an uploaded .eml. No send or modify scope is ever requested.
 */
export interface MailboxConnector {
  kind: Extract<EmailSourceKind, 'gmail' | 'outlook'>;
  /** Recent messages for the agent to pick from (headers only). */
  listRecent(opts: { query?: string; limit: number }): Promise<MailboxMessageSummary[]>;
  source(providerMessageId: string): EmailSource;
}

export interface MailboxMessageSummary {
  providerMessageId: string;
  providerThreadId?: string;
  from: string;
  subject: string;
  date: string;
  hasAttachments: boolean;
}
