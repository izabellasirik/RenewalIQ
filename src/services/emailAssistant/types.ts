import type { MissingItemType } from '../../types';
import type { ParsedEmail } from './parseEmail';

/**
 * The extraction contract. The prototype ships one implementation (fixed rules, rulesExtractor.ts);
 * any later one — an AI model, say — implements the same interface, so both can be run over the
 * same synthetic emails and scored side by side (evaluate.ts). Matching the account, checking the
 * checklist and suggesting actions never depend on which extractor ran.
 */
export interface EmailExtractor {
  id: string;
  version: string;
  extract(email: ParsedEmail, ctx: ExtractionContext): Promise<EmailExtraction>;
}

export interface ExtractionContext {
  /** YYYY-MM-DD that relative dates ("by Friday", "within 5 days") count from — the email's date, else today. */
  referenceDate: string;
}

export type EmailIntent = 'document_request' | 'documents_sent' | 'quote' | 'decline' | 'status_question' | 'other';

export const INTENT_LABELS: Record<EmailIntent, string> = {
  document_request: 'Asks for documents',
  documents_sent: 'Sends documents',
  quote: 'Quote',
  decline: 'Decline',
  status_question: 'Asks for a status update',
  other: 'Other',
};

/**
 * How the email talks about a document:
 *  requested     — asks for it ("please send 5 years of loss runs");
 *  provided      — says it's attached/sent ("attached are the MVRs") — never proof it arrived;
 *  already_have  — says it isn't needed or is already on file;
 *  mentioned     — named without a request (e.g. only in a "RE:" subject).
 */
export type DocumentStance = 'requested' | 'provided' | 'already_have' | 'mentioned';

export interface ExtractedDocument {
  /** Same identity the checklist uses (services/workflow/requirementKey.ts). */
  requirementKey: string;
  label: string;
  type: MissingItemType;
  /** Checklist template entry, when the document is one (application, loss_runs, mvr, ifta, unit_list, driver_list). */
  templateKey?: string;
  /** What the email says about the document ("5 years, currently valued") — goes to the client as instructions. */
  instructions?: string;
  stance: DocumentStance;
  /** The sentence it was found in (plain text, shortened). */
  evidence: string;
}

export interface ExtractedDeadline {
  /** YYYY-MM-DD */
  date: string;
  evidence: string;
}

export interface EmailExtraction {
  extractor: { id: string; version: string };
  intent: EmailIntent;
  /** A guess from wording alone; the account match (a known contact) overrides it. */
  senderRoleGuess: 'carrier' | 'client' | 'unknown';
  documents: ExtractedDocument[];
  /** Earliest first. */
  deadlines: ExtractedDeadline[];
  urgent: boolean;
  identifiers: { dotNumbers: string[]; mcNumbers: string[] };
}
