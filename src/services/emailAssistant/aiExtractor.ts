import { supabase } from '../supabase/client';
import type { ParsedEmail } from './parseEmail';
import { EMAIL_DOC_TYPES, documentForType, extractWithRules, type EmailDocType } from './rulesExtractor';
import { evidenceInText } from './classify';
import type { DocumentStance, EmailExtraction, EmailIntent, ExtractedDocument, ExtractionContext } from './types';

/**
 * The hybrid read: the fixed rules first, and the AI only when the rules' answer looks uncertain
 * (hybridNeedsAi). The AI goes through the same server function as document reading, which holds
 * the API key, picks the configured model and records usage; this file never sees a key. Before
 * anything leaves the browser, account and card numbers, SSNs, dates of birth and license numbers
 * are masked and the sender's address is cut to its domain. If the AI is off, unavailable or
 * answers badly, the rules' answer stands. Every document the AI reports must quote words that
 * are really in the email, or it is dropped.
 */

export const EMAIL_AI_VERSION = 'e1';

export interface AiAnswer {
  extraction: unknown;
  model: string | null;
  fromCache: boolean;
}

/** Calls the AI reader. Injected so tests use a fake; the app uses invokeEmailAi. */
export type EmailAiClient = (emailText: string, context: { accountId?: string }) => Promise<AiAnswer>;

export interface ReadOutcome {
  extraction: EmailExtraction;
  method: 'rules' | 'hybrid';
  /** Why the rules looked uncertain (empty: the AI wasn't needed). */
  rulesDoubts: string[];
  ai?: { model: string | null; fromCache: boolean; dropped: number; suspicious: string[]; instructionsToSoftware: boolean; unclear: string[] };
  /** Why the AI wasn't used although the rules were unsure. */
  aiSkipped?: string;
}

// ── masking ─────────────────────────────────────────────────────────────────────────────────────

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Numbers the AI never needs to see. USDOT / MC numbers stay — they identify the account. */
export function maskSensitive(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[removed]')
    .replace(/\b(ssn|social security(?: number| no\.?)?|ss#)\s*[:#]?\s*\d[\d -]{7,10}\d\b/gi, '$1 [removed]')
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? '[removed]' : m))
    .replace(/\b((?:bank |checking |savings )?(?:account|acct)|routing|aba)(\s*(?:number|no\.?|#))?\s*[:#]?\s*\d[\d -]{4,20}\d\b/gi, '$1$2 [removed]')
    .replace(/\b((?:driver'?s? )?licen[cs]e|dl|cdl)(\s*(?:number|no\.?|#))\s*[:#]?\s*[A-Z0-9][A-Z0-9 -]{3,18}[A-Z0-9]\b/gi, '$1$2 [removed]')
    .replace(/\b(dob|d\.o\.b\.|date of birth)\s*[:#]?\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/gi, '$1 [removed]')
    .replace(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, '[address]@$1');
}

/** What the AI is shown: the same quote-stripped newest message the rules read, masked. */
export function emailForModel(email: ParsedEmail, referenceDate: string): string {
  const domain = email.from.address?.split('@')[1] ?? '';
  return maskSensitive(
    [
      `Email date: ${email.date ? email.date.slice(0, 10) : `(none — use ${referenceDate})`}`,
      `From: ${email.from.name ? `${email.from.name} ` : ''}${domain ? `<[address]@${domain}>` : '(unknown)'}`,
      `Subject: ${email.subject}`,
      email.attachments.length ? `Attachments: ${email.attachments.map((a) => a.name).join(', ')}` : 'Attachments: none',
      '',
      email.newText.slice(0, 30_000),
    ].join('\n')
  );
}

// ── when the AI is needed ───────────────────────────────────────────────────────────────────────

/**
 * Signs the rules may have read the email wrong: a document named without a clear stance, a
 * question, a condition or a "but" around a document, deadline words with no date found, or
 * request wording with no document found.
 */
export function hybridNeedsAi(email: ParsedEmail, rules: EmailExtraction): string[] {
  const text = `${email.subject}\n${email.newText}`;
  const reasons: string[] = [];
  if (rules.documents.some((d) => d.stance === 'mentioned') && !/^\s*(re|fw|fwd)\s*:/i.test(email.subject)) reasons.push('A document is named without a clear request or delivery.');
  if (rules.documents.length && /\?/.test(email.newText)) reasons.push('There’s a question about a document.');
  if (rules.documents.length && /\b(if|may|might|depending|possibly|unless)\b/i.test(email.newText)) reasons.push('The request is conditional.');
  if (rules.documents.length && /\b(but|though|however)\b/i.test(email.newText)) reasons.push('The request has a “but”.');
  if (!rules.deadlines.length && /\b(by|before|within|due|deadline|eod|expires?|asap|end of)\b/i.test(email.newText)) reasons.push('Deadline words, but no date was read.');
  if (!rules.documents.length && /\b(need|send|provide|still|missing|outstanding|resend)\b/i.test(text)) reasons.push('Request wording, but no document was read.');
  return reasons;
}

// ── the AI's answer ─────────────────────────────────────────────────────────────────────────────

const INTENTS: EmailIntent[] = ['document_request', 'documents_sent', 'quote', 'decline', 'status_question', 'other'];
const STANCES: DocumentStance[] = ['requested', 'provided', 'already_have', 'mentioned'];
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 10) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, max) : []);

/** Checks the AI's answer field by field; anything malformed is dropped, never trusted. */
export function parseAiAnswer(raw: unknown, email: ParsedEmail): { extraction: Omit<EmailExtraction, 'extractor'>; dropped: number; suspicious: string[]; instructionsToSoftware: boolean; unclear: string[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!INTENTS.includes(r.intent as EmailIntent) || !Array.isArray(r.documents)) return null;
  let dropped = 0;
  const documents: ExtractedDocument[] = [];
  for (const d of r.documents.slice(0, 40)) {
    const doc = d as Record<string, unknown>;
    const type = doc.type as EmailDocType | 'other';
    const stance = doc.stance as DocumentStance;
    const evidence = str(doc.evidence, 400);
    if (!STANCES.includes(stance) || !evidence || !evidenceInText(evidence, email) || (type !== 'other' && !EMAIL_DOC_TYPES.includes(type))) {
      dropped++;
      continue;
    }
    let base: Pick<ExtractedDocument, 'requirementKey' | 'label' | 'type' | 'templateKey'>;
    if (type === 'other') {
      const name = str(doc.other_name, 80);
      if (!name || !evidenceInText(name, email)) {
        dropped++;
        continue;
      }
      base = { requirementKey: `other|${name.toLowerCase()}`, label: name, type: 'document' };
    } else {
      const driver = str(doc.driver_name, 80);
      base = documentForType(type, driver && evidenceInText(driver, email) ? driver : undefined);
    }
    if (documents.some((x) => x.requirementKey === base.requirementKey)) continue;
    const instructions = str(doc.instructions, 200);
    documents.push({ ...base, stance, instructions: stance === 'requested' && instructions ? instructions : undefined, evidence: evidence.slice(0, 220) });
  }
  const deadline = str(r.deadline, 10);
  const deadlineEvidence = str(r.deadline_evidence, 300);
  // Only numbers that are really written in the email.
  const digits = `${email.subject}\n${email.newText}`.replace(/[^\d\n ]/g, ' ');
  const inText = (n: string) => n.length >= 4 && new RegExp(`(^|\\D)0*${n}(\\D|$)`).test(digits);
  const ids = (v: unknown) => strList(v).map((x) => x.replace(/\D/g, '').replace(/^0+/, '')).filter(inText);
  return {
    extraction: {
      intent: r.intent as EmailIntent,
      senderRoleGuess: r.sender_role === 'carrier' || r.sender_role === 'client' ? r.sender_role : 'unknown',
      documents,
      deadlines: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? [{ date: deadline, evidence: deadlineEvidence }] : [],
      urgent: r.urgent === true,
      identifiers: { dotNumbers: ids(r.dot_numbers), mcNumbers: ids(r.mc_numbers) },
    },
    dropped,
    suspicious: strList(r.suspicious_reasons, 5),
    instructionsToSoftware: r.instructions_to_software_found === true,
    unclear: strList(r.unclear, 5),
  };
}

/**
 * Rules first; the AI only for the doubts the rules raise, and only when `ai` is given. The AI's
 * documents replace the rules' (they're what it was asked to settle); a document the rules found
 * that the AI didn't name stays, but only as "mentioned" — it never turns into a request on its own.
 */
export async function readEmail(email: ParsedEmail, ctx: ExtractionContext & { accountId?: string }, ai: EmailAiClient | null): Promise<ReadOutcome> {
  const rules = extractWithRules(email, ctx);
  const rulesDoubts = hybridNeedsAi(email, rules);
  if (!rulesDoubts.length) return { extraction: rules, method: 'rules', rulesDoubts };
  if (!ai) return { extraction: rules, method: 'rules', rulesDoubts, aiSkipped: 'AI reading is off — read by the fixed rules only.' };
  let answer: AiAnswer;
  try {
    answer = await ai(emailForModel(email, ctx.referenceDate), { accountId: ctx.accountId });
  } catch (e) {
    return { extraction: rules, method: 'rules', rulesDoubts, aiSkipped: `AI reading wasn’t available (${e instanceof Error ? e.message : 'no answer'}) — read by the fixed rules only.` };
  }
  const parsed = parseAiAnswer(answer.extraction, email);
  if (!parsed) return { extraction: rules, method: 'rules', rulesDoubts, aiSkipped: 'The AI’s answer couldn’t be used — read by the fixed rules only.' };

  const a = parsed.extraction;
  const keys = new Set(a.documents.map((d) => d.requirementKey));
  const documents = [...a.documents, ...rules.documents.filter((d) => !keys.has(d.requirementKey)).map((d) => ({ ...d, stance: 'mentioned' as const, instructions: undefined }))];
  const deadlines = [...a.deadlines, ...rules.deadlines.filter((d) => !a.deadlines.some((x) => x.date === d.date))].sort((x, y) => (x.date < y.date ? -1 : 1));
  const union = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  return {
    extraction: {
      extractor: { id: 'hybrid', version: `rules@${rules.extractor.version}+ai@${EMAIL_AI_VERSION}` },
      intent: a.intent,
      senderRoleGuess: a.senderRoleGuess,
      documents,
      deadlines,
      urgent: rules.urgent || a.urgent,
      identifiers: { dotNumbers: union(rules.identifiers.dotNumbers, a.identifiers.dotNumbers), mcNumbers: union(rules.identifiers.mcNumbers, a.identifiers.mcNumbers) },
    },
    method: 'hybrid',
    rulesDoubts,
    ai: { model: answer.model, fromCache: answer.fromCache, dropped: parsed.dropped, suspicious: parsed.suspicious, instructionsToSoftware: parsed.instructionsToSoftware, unclear: parsed.unclear },
  };
}

/** The app's AI client: the extract-document-vision function's "email" mode. */
export const invokeEmailAi: EmailAiClient = async (emailText, context) => {
  if (!supabase) throw new Error('not signed in to the cloud');
  const { data, error } = await supabase.functions.invoke('extract-document-vision', { body: { mode: 'email', emailText, context: context.accountId ? { accountId: context.accountId } : {} } });
  if (error) throw new Error('the AI function didn’t answer');
  const d = data as { extraction?: unknown; model?: unknown; fromCache?: unknown } | null;
  if (!d || !('extraction' in d)) throw new Error('the AI function needs updating');
  return { extraction: d.extraction, model: typeof d.model === 'string' ? d.model : null, fromCache: d.fromCache === true };
};
