import type { MissingItemType } from '../../types';
import { requirementKey } from '../workflow/requirementKey';
import { addBusinessDays, addDays, parseDateKey, toLocalDateKey } from '../workflow/dates';
import type { ParsedEmail } from './parseEmail';
import type { DocumentStance, EmailExtraction, EmailExtractor, EmailIntent, ExtractedDeadline, ExtractedDocument, ExtractionContext } from './types';

/**
 * Fixed rules — no AI. Reads only the newest message of the thread (quoted history is ignored), so
 * a request quoted from an earlier email is never extracted again. Deterministic: the same email
 * always gives the same result.
 */

interface DocRule {
  /** The document type's name for an AI reader (EMAIL_DOC_TYPES). */
  id: EmailDocType;
  label: string;
  type: MissingItemType;
  templateKey?: string;
  pattern: RegExp;
  perDriver?: boolean;
}

const DOC_RULES: DocRule[] = [
  { id: 'loss_runs', label: 'Loss Runs', type: 'document', templateKey: 'loss_runs', pattern: /\bloss[\s-]?runs?\b|\bloss (?:history|experience)\b|\bcurrently valued losses\b/i },
  { id: 'mvr', label: 'MVR', type: 'document', templateKey: 'mvr', perDriver: true, pattern: /\bMVRs?\b|\bmotor vehicle (?:records?|reports?)\b|\bdriving records?\b/i },
  { id: 'ifta', label: 'IFTA — last 4 quarters', type: 'document', templateKey: 'ifta', pattern: /\bIFTA\b/i },
  { id: 'unit_list', label: 'Unit List', type: 'document', templateKey: 'unit_list', pattern: /\b(?:unit|vehicle|equipment|truck|power unit) (?:list|schedule)s?\b|\blist of (?:units|vehicles|trucks|equipment)\b/i },
  { id: 'driver_list', label: 'Driver List', type: 'document', templateKey: 'driver_list', pattern: /\bdriver (?:list|schedule|roster)s?\b|\blist of (?:all )?drivers\b/i },
  { id: 'application', label: 'Application', type: 'document', templateKey: 'application', pattern: /\b(?:acord (?:12[57] )?|trucking |supplemental |commercial auto )?application\b/i },
  { id: 'dec_page', label: 'Declarations page (current policy)', type: 'document', pattern: /\b(?:prior|current|expiring) dec(?:laration)?s?(?: pages?)?\b|\bdec(?:laration)?s? pages?\b/i },
  { id: 'cdl', label: 'CDL copies', type: 'document', pattern: /\bCDLs?\b|\bcommercial driver'?s? licen[cs]es?\b|\bdriver'?s'? licen[cs]es?\b/i },
  { id: 'w9', label: 'W-9', type: 'document', pattern: /\bW-?9\b/i },
  { id: 'safety_program', label: 'Safety program', type: 'document', pattern: /\bsafety (?:program|manual|policy)\b/i },
  { id: 'lease_agreement', label: 'Lease agreement', type: 'document', pattern: /\blease agreements?\b|\bleasing agreements?\b/i },
  { id: 'financials', label: 'Financial statements', type: 'document', pattern: /\bfinancial statements?\b|\bfinancials\b/i },
  { id: 'registrations', label: 'Vehicle registrations', type: 'document', pattern: /\b(?:vehicle |truck )?registrations?\b/i },
];

/** Kept equal to EMAIL_DOC_TYPES in supabase/functions/extract-document-vision/email.ts (a unit test checks). */
export const EMAIL_DOC_TYPES = ['loss_runs', 'mvr', 'ifta', 'unit_list', 'driver_list', 'application', 'dec_page', 'cdl', 'w9', 'safety_program', 'lease_agreement', 'financials', 'registrations'] as const;
export type EmailDocType = (typeof EMAIL_DOC_TYPES)[number];

/** The checklist label and template of a document type, so an AI answer lands on the same requirement the rules would. */
export function documentForType(type: EmailDocType, driverName?: string): Pick<ExtractedDocument, 'requirementKey' | 'label' | 'type' | 'templateKey'> {
  const rule = DOC_RULES.find((r) => r.id === type)!;
  const name = driverName?.trim();
  if (rule.perDriver && name) {
    const label = `MVR — ${name}`;
    return { requirementKey: requirementKey({ label }), label, type: rule.type };
  }
  const label = rule.perDriver ? `${rule.label}s — all drivers` : rule.label;
  return { requirementKey: requirementKey({ label, templateKey: rule.templateKey }), label, type: rule.type, templateKey: rule.templateKey };
}

const REQUEST_CUE =
  /\b(?:please (?:send|provide|forward|submit|share|attach|get|email)|(?:we|i|underwriting|they|the carrier) (?:will |would |still )?(?:need|require)s?|needs?|needed|required?|requesting|request(?:ed)?|missing|outstanding|subject to|subjectivit(?:y|ies)|can you (?:send|provide|get)|could you (?:send|provide|get)|send (?:us|over|me)|provide|still waiting (?:on|for)|awaiting|prior to (?:binding|quoting|bind)|before (?:we|i) can)\b/i;
const PROVIDED_CUE = /\b(?:attached|attaching|enclosed|here (?:is|are)|please find|sent (?:you|over)|i'?ve sent|i have sent|uploaded|i(?:'ve| have) (?:uploaded|attached|included))\b/i;
const HAVE_CUE =
  /\b(?:no need|not needed|don'?t need|do not need|no longer need(?:ed)?|already (?:have|received|got|on file|sent)|we have (?:the|your)|(?:we |i )?received (?:the|your)|thanks? (?:you )?for (?:the|sending)|got (?:the|your)|is on file|are on file|waive[ds]?)\b/i;
/** A line that opens a list ("Please send the following:", "Attached are:"). */
const LIST_OPENER = /:\s*$/;
const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const toNum = (s: string) => WORD_NUM[s.toLowerCase()] ?? Number(s);

function instructionsFor(rule: DocRule, sentence: string): string | undefined {
  const parts: string[] = [];
  if (rule.templateKey === 'loss_runs') {
    const years = /\b(?:last |past |prior )?(\d{1,2}|three|four|five|six|seven|ten)[\s-]*(?:full )?(?:years?|yrs?)\b/i.exec(sentence);
    if (years) parts.push(`last ${toNum(years[1])} years`);
    if (/\bcurrently valued\b/i.test(sentence)) parts.push('currently valued');
    const within = /\bvalued within (?:the )?(?:last |past )?(\d{1,3}) days\b/i.exec(sentence);
    if (within) parts.push(`valued within ${within[1]} days`);
  }
  if (rule.templateKey === 'ifta') {
    const q = /\b(?:last |past )?(\d|two|three|four|eight)\s*quarters\b/i.exec(sentence);
    if (q) parts.push(`last ${toNum(q[1])} quarters`);
  }
  const dated = /\bdated within (?:the )?(?:last |past )?(\d{1,3}) days\b/i.exec(sentence);
  if (dated) parts.push(`dated within the last ${dated[1]} days`);
  if (/\bsigned\b/i.test(sentence) && rule.templateKey === 'application') parts.push('signed and dated');
  // Nothing the label already says ("IFTA — last 4 quarters" needs no "last 4 quarters" again).
  const extra = parts.filter((p) => !rule.label.toLowerCase().includes(p.toLowerCase()));
  return extra.length ? extra.join(', ') : undefined;
}

const NAME = "[A-Z][a-z]+(?: [A-Z]\\.)?(?: [A-Z][a-zA-Z'’-]+)+";
const NAME_LIST = new RegExp(`\\b(?:MVRs?|motor vehicle (?:records?|reports?)|driving records?)\\s+(?:for|on)\\s+(${NAME}(?:(?:,\\s*|\\s+and\\s+|,\\s*and\\s+)${NAME})*)`);
const POSSESSIVE = new RegExp(`\\b(${NAME})['’]s\\s+(?:MVR|motor vehicle record|driving record)\\b`, 'g');
/** Words that start capitalized phrases but aren't driver names. */
const NOT_A_NAME = /^(Please|Thanks|Thank|The|All|Each|Every|Our|Your|Current|Updated|New|Driver|Drivers)\b/;

function driverNames(sentence: string): string[] {
  const names: string[] = [];
  const list = NAME_LIST.exec(sentence);
  if (list) names.push(...list[1].split(/\s*,\s*and\s+|\s*,\s*|\s+and\s+/));
  for (const m of sentence.matchAll(POSSESSIVE)) names.push(m[1]);
  return [...new Set(names.map((n) => n.trim()).filter((n) => n && !NOT_A_NAME.test(n)))];
}

function stanceOf(clause: string, inherited: DocumentStance | null): DocumentStance {
  if (HAVE_CUE.test(clause)) return 'already_have';
  if (PROVIDED_CUE.test(clause)) return 'provided';
  if (REQUEST_CUE.test(clause)) return 'requested';
  return inherited ?? 'mentioned';
}

/** Sentences, then clauses ("We received the loss runs but still need the IFTA" → two). */
function clausesOf(text: string): { clause: string; listStance: DocumentStance | null }[] {
  const out: { clause: string; listStance: DocumentStance | null }[] = [];
  let listStance: DocumentStance | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      listStance = null;
      continue;
    }
    const isBullet = BULLET.test(line);
    if (!isBullet && listStance && !LIST_OPENER.test(line)) listStance = null;
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
    for (const sentence of sentences) {
      for (const clause of sentence.split(/\s*;\s*|,?\s+\b(?:but|however|although|though|while)\b\s+/i)) {
        if (clause.trim()) out.push({ clause: clause.trim(), listStance: isBullet ? listStance : null });
      }
    }
    if (LIST_OPENER.test(line)) listStance = stanceOf(line, null) === 'mentioned' ? null : stanceOf(line, null);
  }
  return out;
}

const STANCE_RANK: Record<DocumentStance, number> = { requested: 3, provided: 2, already_have: 1, mentioned: 0 };
const shorten = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}…` : s);

function extractDocuments(newText: string, subject: string): ExtractedDocument[] {
  const found = new Map<string, ExtractedDocument>();
  const put = (doc: ExtractedDocument) => {
    const prev = found.get(doc.requirementKey);
    if (!prev || STANCE_RANK[doc.stance] > STANCE_RANK[prev.stance]) found.set(doc.requirementKey, { ...doc, instructions: doc.instructions ?? prev?.instructions });
    else if (!prev.instructions && doc.instructions && doc.stance === prev.stance) found.set(doc.requirementKey, { ...prev, instructions: doc.instructions });
  };
  const scan = (clause: string, stance: DocumentStance) => {
    for (const rule of DOC_RULES) {
      if (!rule.pattern.test(clause)) continue;
      // "application" inside a phrase about something else ("application fee", "app of …") isn't the document.
      if (rule.templateKey === 'application' && /\bapplication (?:fee|process|portal|status|was|has been)\b/i.test(clause)) continue;
      const instructions = stance === 'requested' ? instructionsFor(rule, clause) : undefined;
      const names = rule.perDriver ? driverNames(clause) : [];
      if (names.length) {
        for (const n of names) {
          const label = `MVR — ${n}`;
          put({ requirementKey: requirementKey({ label }), label, type: rule.type, instructions, stance, evidence: shorten(clause) });
        }
      } else {
        const label = rule.perDriver ? `${rule.label}s — all drivers` : rule.label;
        put({ requirementKey: requirementKey({ label, templateKey: rule.templateKey }), label, type: rule.type, templateKey: rule.templateKey, instructions, stance, evidence: shorten(clause) });
      }
    }
  };
  for (const { clause, listStance } of clausesOf(newText)) scan(clause, stanceOf(clause, listStance));
  // The subject counts only for a fresh email; a "RE:"/"FW:" subject repeats an earlier message.
  const reply = /^\s*(re|fw|fwd|aw|sv)\s*:/i.test(subject);
  const cleanSubject = subject.replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, '');
  if (cleanSubject) scan(cleanSubject, reply ? 'mentioned' : stanceOf(cleanSubject, null));
  // An "MVRs — all drivers" alongside named-driver MVRs from the same email is the same ask.
  const named = [...found.values()].some((d) => d.requirementKey.startsWith('mvr|') && d.requirementKey !== 'mvr|all');
  if (named) found.delete('mvr|all');
  return [...found.values()];
}

// ── deadlines ───────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_WORD = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?';
const MONTH_DATE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|\\d{4}-\\d{2}-\\d{2}';
/** "Friday, October 23" names the date itself — the weekday is only decoration. */
const DATE_WORD = `(?:(?:${WEEKDAY_WORD}),?\\s+(?:the\\s+)?(?:${MONTH_DATE})|${MONTH_DATE}|${WEEKDAY_WORD}|today|tomorrow|end of (?:the )?(?:day|week|month))`;
const DEADLINE = new RegExp(
  `\\b(?:by|before|no later than|due(?: by| on)?|deadline(?: is|:)?|needed by|prior to|until)\\s+(?:(?:the\\s+)?(?:end of day|eod|cob|close of business)\\s+(?:on\\s+)?)?(?:(?:this|next)\\s+)?(${DATE_WORD})`,
  'gi'
);
const WITHIN = /\bwithin\s+(\d{1,2}|one|two|three|four|five|seven|ten)\s+(business\s+|working\s+)?days?\b/gi;

function resolveDate(word: string, ref: Date, nextWeek: boolean): string | null {
  const raw = word.toLowerCase().replace(/\.$/, '').trim();
  const withoutWeekday = raw.replace(new RegExp(`^${WEEKDAY_WORD},?\\s+(?:the\\s+)?`), '');
  const w = withoutWeekday !== raw && /\d/.test(withoutWeekday) ? withoutWeekday : raw;
  if (w === 'today' || w === 'end of day' || w === 'end of the day') return toLocalDateKey(ref);
  if (w === 'tomorrow') return addDays(toLocalDateKey(ref), 1);
  if (/^end of (the )?week$/.test(w)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return toLocalDateKey(d);
  }
  if (/^end of (the )?month$/.test(w)) return toLocalDateKey(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  const wd = WEEKDAYS.findIndex((p) => w.startsWith(p));
  if (wd >= 0 && /^[a-z]+$/.test(w)) {
    const d = new Date(ref);
    let diff = (wd - d.getDay() + 7) % 7;
    if (nextWeek) diff += 7;
    d.setDate(d.getDate() + diff);
    return toLocalDateKey(d);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (iso) return parseDateKey(w) ? w : null;
  const pick = (month: number, day: number, year?: number) => {
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let y = year ?? ref.getFullYear();
    let d = new Date(y, month, day);
    if (d.getMonth() !== month) return null;
    // No year given and the date is well in the past: it means next year ("by 1/15" written in December).
    if (year === undefined && d.getTime() < ref.getTime() - 60 * 86400000) {
      y += 1;
      d = new Date(y, month, day);
    }
    return toLocalDateKey(d);
  };
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
  if (us) return pick(Number(us[1]) - 1, Number(us[2]), us[3] ? (us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])) : undefined);
  const named = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(w);
  if (named) {
    const m = MONTHS.indexOf(named[1].slice(0, 3));
    if (m >= 0) return pick(m, Number(named[2]), named[3] ? Number(named[3]) : undefined);
  }
  return null;
}

function extractDeadlines(text: string, referenceDate: string): ExtractedDeadline[] {
  const ref = parseDateKey(referenceDate) ?? new Date();
  const out = new Map<string, ExtractedDeadline>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    for (const m of sentence.matchAll(DEADLINE)) {
      // "effective 11/1" is the policy date, not a deadline.
      const before = sentence.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
      if (/\beffective\s*(?:date\s*)?(?:of\s*|on\s*)?$/i.test(before)) continue;
      const nextWeek = /\bnext\s+$/i.test(m[0].slice(0, m[0].length - m[1].length));
      const date = resolveDate(m[1], ref, nextWeek);
      if (date && !out.has(date)) out.set(date, { date, evidence: shorten(sentence.trim()) });
    }
    for (const m of sentence.matchAll(WITHIN)) {
      const n = toNum(m[1]);
      const date = m[2] ? addBusinessDays(ref, n) : addDays(toLocalDateKey(ref), n);
      if (!out.has(date)) out.set(date, { date, evidence: shorten(sentence.trim()) });
    }
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ── intent, role, identifiers ───────────────────────────────────────────────────────────────────

const DECLINE = /\b(?:declin(?:e|ed|ing)(?: to (?:quote|offer|write))?|unable to (?:offer|quote|provide (?:a )?quote|write)|(?:is |are )?not (?:a )?(?:good )?fit|outside (?:of )?(?:our )?appetite|(?:we(?:'ll| will)? )?pass(?:ing)? on this|cannot (?:offer|quote))\b/i;
const QUOTE = /\b(?:(?:quote|indication|proposal) (?:is |are )?(?:attached|enclosed|below)|pleased to (?:offer|quote|provide)|(?:total |annual )?premium (?:of|is|:)\s*\$|quoted (?:at|premium)|bindable quote|here is (?:the|our) quote)\b/i;
const STATUS = /\b(?:any update|status (?:update|of|on)|checking in|just following up|where (?:are|do) we stand|wanted to follow up)\b/i;
const CARRIER_WORDS = /\b(?:underwrit(?:er|ing)|MGA|program manager|(?:we|i) (?:have )?(?:received|reviewed) (?:the |your )?submission|submission (?:for|on)|subjectivit(?:y|ies)|bindable|binding|our appetite|quote (?:ref|request|number))\b/i;
const CLIENT_WORDS = /\b(?:my (?:trucks?|drivers?|company|business|insurance|policy)|our (?:trucks?|drivers?|fleet|trailers?)|you asked (?:for|me)|you needed|here (?:is|are) the)\b/i;

export function extractIdentifiers(text: string): EmailExtraction['identifiers'] {
  const dot = new Set<string>();
  const mc = new Set<string>();
  for (const m of text.matchAll(/\b(?:US\s?-?DOT|DOT)\s*(?:#|no\.?|number)?\s*:?\s*(\d{5,8})\b/gi)) dot.add(m[1].replace(/^0+/, ''));
  for (const m of text.matchAll(/\bMC\s*(?:#|no\.?|number)?\s*:?\s*-?\s*(\d{4,8})\b/gi)) mc.add(m[1].replace(/^0+/, ''));
  return { dotNumbers: [...dot], mcNumbers: [...mc] };
}

export function extractWithRules(email: ParsedEmail, ctx: ExtractionContext): EmailExtraction {
  const body = email.newText;
  const documents = extractDocuments(body, email.subject);
  const whole = `${email.subject}\n${body}`;
  const requested = documents.some((d) => d.stance === 'requested');
  const provided = documents.some((d) => d.stance === 'provided') || (email.attachments.length > 0 && PROVIDED_CUE.test(whole));
  let intent: EmailIntent = 'other';
  if (DECLINE.test(whole)) intent = 'decline';
  else if (QUOTE.test(whole)) intent = 'quote';
  else if (requested) intent = 'document_request';
  else if (provided) intent = 'documents_sent';
  else if (STATUS.test(whole)) intent = 'status_question';
  const carrier = CARRIER_WORDS.test(whole);
  const client = CLIENT_WORDS.test(whole);
  return {
    extractor: { id: RULES_EXTRACTOR.id, version: RULES_EXTRACTOR.version },
    intent,
    senderRoleGuess: carrier && !client ? 'carrier' : client && !carrier ? 'client' : 'unknown',
    documents,
    deadlines: extractDeadlines(body, ctx.referenceDate),
    urgent: /\b(?:asap|as soon as possible|urgent(?:ly)?|right away|time[- ]sensitive)\b/i.test(whole),
    identifiers: extractIdentifiers(whole),
  };
}

export const RULES_EXTRACTOR: EmailExtractor = {
  id: 'rules',
  version: '1',
  extract: async (email, ctx) => extractWithRules(email, ctx),
};

/** Relative dates count from the email's own date when it has one. */
export function referenceDateFor(email: ParsedEmail, today: string): string {
  return email.date ? toLocalDateKey(new Date(email.date)) : today;
}
