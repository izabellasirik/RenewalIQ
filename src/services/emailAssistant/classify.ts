import { addDays, formatShortDate, parseDateKey } from '../workflow/dates';
import type { ParsedEmail } from './parseEmail';
import type { AccountMatch } from './matchAccount';
import type { AttachmentReview } from './attachments';
import type { EmailExtraction, ExtractedDeadline } from './types';

/**
 * What kind of email this is, how sure Renewal IQ is, and why — plus the deadline check: a deadline
 * is kept only when the words it came from are really in the email and name a date. Nothing here
 * invents a date: an email that only sounds urgent gets no deadline, and says so.
 */

export type EmailCategory = 'carrier_request' | 'client_response' | 'document_delivery' | 'unrelated';

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  carrier_request: 'Carrier request',
  client_response: 'Client response',
  document_delivery: 'Document delivery',
  unrelated: 'Unrelated',
};

export interface Classification {
  category: EmailCategory;
  /** 0–1. */
  confidence: number;
  level: 'high' | 'medium' | 'low';
  /** Why it was put in this category. */
  reasons: string[];
  /** What makes it less certain — the agent should check these. */
  uncertain: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** The quoted evidence is really in the email (the rules shorten long sentences with "…"). */
export function evidenceInText(evidence: string, email: Pick<ParsedEmail, 'subject' | 'newText'>): boolean {
  const e = norm(evidence).replace(/…$/, '').trim();
  if (e.length < 3) return false;
  return norm(`${email.subject}\n${email.newText}`).includes(e);
}

const DATE_CUE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\btoday\b|\btomorrow\b|\b(?:eod|cob|end of (?:the )?(?:day|week|month))\b|\bwithin\s+\w+\s+(?:business\s+|working\s+)?days?\b/i;
const URGENT_OR_DEADLINE_WORDS = /\b(?:asap|as soon as possible|urgent(?:ly)?|right away|time[- ]sensitive|deadline|due|soon|quickly|promptly)\b/i;

export interface DeadlineCheck {
  deadlines: ExtractedDeadline[];
  /** Deadlines thrown out, and why (an AI answer whose words aren't in the email, say). */
  dropped: { date: string; evidence: string; why: string }[];
  /** For the agent: no date given, or the deadline already passed. */
  note?: string;
}

export function guardDeadlines(email: Pick<ParsedEmail, 'subject' | 'newText'>, extraction: Pick<EmailExtraction, 'deadlines' | 'urgent'>, referenceDate: string, today: string): DeadlineCheck {
  const kept: ExtractedDeadline[] = [];
  const dropped: DeadlineCheck['dropped'] = [];
  const earliest = addDays(referenceDate, -30);
  const latest = addDays(referenceDate, 400);
  for (const d of extraction.deadlines) {
    const why = !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !parseDateKey(d.date)
      ? 'not a valid date'
      : !d.evidence.trim() || !evidenceInText(d.evidence, email)
        ? 'its wording isn’t in the email'
        : !DATE_CUE.test(d.evidence)
          ? 'its wording names no date'
          : d.date < earliest || d.date > latest
            ? 'too far from the email’s date to be right'
            : null;
    if (why) dropped.push({ ...d, why });
    else if (!kept.some((k) => k.date === d.date)) kept.push(d);
  }
  kept.sort((a, b) => (a.date < b.date ? -1 : 1));
  let note: string | undefined;
  if (!kept.length) {
    note = extraction.urgent || URGENT_OR_DEADLINE_WORDS.test(`${email.subject}\n${email.newText}`)
      ? 'The email sounds time-sensitive but gives no date, so no deadline was set. Ask the sender if you need one.'
      : 'No deadline in the email.';
  } else if (kept[0].date < today) {
    note = `The deadline (${formatShortDate(kept[0].date)}) has already passed.`;
  }
  return { deadlines: kept, dropped, note };
}

export interface ClassifyInput {
  email: ParsedEmail;
  extraction: EmailExtraction;
  match: AccountMatch;
  /** Who the sender is to the chosen account (a contact = client; a market = carrier). */
  senderRole: 'carrier' | 'client' | 'unknown';
  attachments: AttachmentReview[];
  /** Why the rules may have read it wrong (see hybridNeedsAi). */
  rulesDoubts?: string[];
}

const level = (c: number): Classification['level'] => (c >= 0.8 ? 'high' : c >= 0.6 ? 'medium' : 'low');
const clamp = (c: number) => Math.round(Math.max(0.05, Math.min(0.98, c)) * 100) / 100;

export function classifyEmail(input: ClassifyInput): Classification {
  const { extraction, match, senderRole } = input;
  const requested = extraction.documents.filter((d) => d.stance === 'requested');
  const provided = extraction.documents.filter((d) => d.stance === 'provided');
  const files = input.attachments.filter((a) => a.status !== 'blocked' && a.status !== 'unreadable');
  const reasons: string[] = [];
  const uncertain: string[] = [...(input.rulesDoubts ?? [])];
  const insurance = extraction.documents.length > 0 || extraction.deadlines.length > 0 || extraction.intent !== 'other' || extraction.identifiers.dotNumbers.length > 0 || extraction.identifiers.mcNumbers.length > 0;

  let category: EmailCategory;
  let confidence: number;

  if (!insurance && match.status === 'none' && senderRole === 'unknown') {
    category = 'unrelated';
    confidence = files.length ? 0.7 : 0.9;
    reasons.push('Names no documents, deadlines, quote or decline, and matches no account.');
    if (files.length) uncertain.push('It has attachments — open them only if you expected them.');
  } else if (senderRole === 'client') {
    if (files.length || provided.length) {
      category = 'document_delivery';
      confidence = files.length && provided.length ? 0.92 : 0.78;
      reasons.push(`From a contact on the account, ${files.length ? `with ${files.length} attachment${files.length === 1 ? '' : 's'}` : `saying ${provided.map((d) => d.label).join(', ')} ${provided.length === 1 ? 'was' : 'were'} sent`}.`);
      if (!files.length) uncertain.push('Says documents were sent, but nothing is attached here.');
    } else {
      category = 'client_response';
      confidence = extraction.documents.length || extraction.intent !== 'other' ? 0.85 : 0.7;
      reasons.push('From a contact on the account, with no documents attached.');
    }
  } else if (requested.length || extraction.intent === 'quote' || extraction.intent === 'decline' || extraction.intent === 'status_question') {
    category = 'carrier_request';
    confidence = senderRole === 'carrier' ? 0.9 : 0.68;
    if (requested.length) reasons.push(`Asks for ${requested.map((d) => d.label).join(', ')}.`);
    else reasons.push(extraction.intent === 'quote' ? 'Reads like a quote.' : extraction.intent === 'decline' ? 'Reads like a decline.' : 'Asks for an update.');
    if (senderRole === 'carrier') reasons.push('The sender is one of the account’s markets.');
    else uncertain.push('The sender isn’t a contact or a market on the account.');
  } else if (files.length || provided.length) {
    category = 'document_delivery';
    confidence = senderRole === 'carrier' ? 0.85 : 0.65;
    reasons.push(files.length ? `Has ${files.length} attachment${files.length === 1 ? '' : 's'} and asks for nothing.` : 'Says documents were sent and asks for nothing.');
    if (senderRole !== 'carrier') uncertain.push('The sender isn’t a known contact — check who sent the files.');
  } else if (!insurance) {
    category = 'unrelated';
    confidence = 0.6;
    reasons.push('Names no documents, deadlines, quote or decline.');
    uncertain.push(`It does mention the account (${match.reason})`);
  } else {
    category = 'client_response';
    confidence = 0.45;
    reasons.push('Mentions the account but asks for nothing and sends nothing.');
    uncertain.push('The sender isn’t a known contact.');
  }

  if (category !== 'unrelated' && (match.status === 'ambiguous' || match.status === 'none')) {
    confidence -= 0.15;
    uncertain.push(match.status === 'ambiguous' ? 'More than one account could fit.' : 'No account was matched automatically.');
  }
  if (input.rulesDoubts?.length) confidence -= 0.1;
  const c = clamp(confidence);
  return { category, confidence: c, level: level(c), reasons, uncertain: [...new Set(uncertain)] };
}
