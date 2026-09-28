import type { LossRun } from '../../../types';
import type { TextLine } from './textLines';
import { normalizeDateKey } from '../../workflow/dates';
import { parseAmount } from './tableMappers';

/**
 * Reads a loss run's own summary — who issued it, when it was valued, and for each policy on it:
 * the policy number, the policy period, the totals it states, or that there were no losses — so a
 * loss run becomes a loss-run record with its claims linked, not just loose claims.
 *
 * A report often covers several policy terms (one section per policy number/period); each section
 * becomes its own record, and each claim belongs to the section it's printed under. Nothing is
 * guessed: a value that isn't printed stays empty for the broker to fill in.
 */

export type LossRunDraft = Omit<LossRun, 'id' | 'createdAt' | 'updatedAt'> & {
  /** Links claims to this record until it gets an id (see LossEntry.lossRunKey handling in the store). */
  key: string;
};

const DATE = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})`;
const PERIOD_RE = new RegExp(String.raw`(?:policy\s*)?(?:period|term|dates?|effective|coverage)?\s*(?:from)?\s*[:\-]?\s*${DATE}\s*(?:-|–|—|to|thru|through)\s*${DATE}`, 'i');
/** "Policy Period: 01/15/2025  01/15/2026" — with the label, two dates are enough (OCR often drops the dash). */
const PERIOD_LABELED_RE = new RegExp(String.raw`\b(?:policy\s*(?:period|term)|coverage\s*period|term|period)\s*[:\-]?\s*${DATE}\s*(?:-|–|—|to|thru|through)?\s*${DATE}`, 'i');
const EFFECTIVE_RE = new RegExp(String.raw`\b(?:effective|eff\.?|inception)(?:\s*date)?\s*[:\-]?\s*${DATE}`, 'i');
const EXPIRATION_RE = new RegExp(String.raw`\b(?:expiration|expiry|exp\.?)(?:\s*date)?\s*[:\-]?\s*${DATE}`, 'i');
const REPORT_DATE_RE = new RegExp(
  String.raw`\b(?:valuation|valued|evaluation|evaluated|as\s+of|run|report|printed|print|prepared|produced|loss\s+run)(?:\s+(?:date|on|as\s+of))?\s*[:\-]?\s*${DATE}`,
  'i'
);
const POLICY_RE = /\bpol(?:icy|\.)?\s*(?:number|no\.?|num|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/ ]{2,30}[A-Z0-9])/i;
const POLICY_BARE_RE = /^\s*policy\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/ ]{2,30}[A-Z0-9])/i;
const NO_LOSSES_RE = /\bno\s+(?:losses|claims|loss\s+activity|reported\s+(?:losses|claims)|claims?\s+(?:reported|activity))\b|\bloss[-\s]free\b|\bzero\s+claims\b/i;
const CARRIER_LABEL_RE = /^(?:insurance\s+)?(?:carrier|insurer|writing\s+company|issuing\s+company|underwriting\s+company|insurance\s+company|company)(?:\s+name)?\s*[:\-]\s*(.+)$/i;
const LEGAL_NAME_RE = /\b(?:insurance|casualty|assurance|indemnity|mutual|underwriters|surety|fire\s+&\s+marine)\b/i;
const LEGAL_SUFFIX_RE = /\b(?:company|co\.?|corporation|corp\.?|group|inc\.?|exchange|association|llc)\b/i;
const NOT_CARRIER_RE = /\b(?:agency|agent|broker|brokerage|insured|named|prepared\s+for|producer)\b/i;
/** Carriers commonly writing trucking business — only used when the report doesn't print a legal company name. */
const KNOWN_CARRIERS = [
  'Progressive', 'Great West Casualty', 'Northland', 'National Interstate', 'Travelers', 'Canal Insurance', 'Sentry', 'Old Republic', 'Berkshire Hathaway',
  'Zurich', 'Liberty Mutual', 'Nationwide', 'The Hartford', 'Cincinnati', 'Carolina Casualty', 'Lancer', 'Hallmark', 'Crum & Forster', 'Markel', 'Hudson',
  'Starr', 'Knight Specialty', 'Sompo', 'AmTrust', 'Selective', 'Chubb', 'CNA', 'Occidental', 'Prime Insurance', 'Spinnaker', 'Accredited', 'Branch',
  'Artisan', 'Integon', 'Clear Blue', 'Cover Whale', 'Hanover', 'Westfield', 'Harco', 'Protective', 'American Inter-Fidelity', 'Baldwin', 'Kingsway',
];

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Co)\b/g, (m) => m.toUpperCase()) : s);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const iso = (raw: string | undefined) => (raw ? (normalizeDateKey(raw.replace(/\.(?=\s)/, '')) ?? undefined) : undefined);

/** Is this document a loss run at all? */
export function looksLikeLossRun(text: string, hasLossRows: boolean): boolean {
  if (/\bloss\s*runs?\b|\bloss\s+(?:history|experience)\s+report\b|\bclaims?\s+(?:history|experience|summary)\b|\bloss\s+summary\b|\bvaluation\s+date\b|\bvalued\s+as\s+of\b/i.test(text)) return true;
  return hasLossRows && /\bpolicy\b/i.test(text);
}

function findCarrier(lines: TextLine[]): string | undefined {
  for (const l of lines) {
    const m = l.text.match(CARRIER_LABEL_RE);
    if (m && m[1] && !NOT_CARRIER_RE.test(m[1])) return titleCase(clean(m[1]).replace(/\s{2,}.*/, ''));
  }
  const top = lines.slice(0, 15);
  for (const l of top) {
    const t = clean(l.text);
    if (t.length > 80 || NOT_CARRIER_RE.test(t) || t.includes(':')) continue;
    if (LEGAL_NAME_RE.test(t) && LEGAL_SUFFIX_RE.test(t)) return titleCase(t);
  }
  for (const l of top) {
    const hit = KNOWN_CARRIERS.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}\\b`, 'i').test(l.text));
    if (hit && !NOT_CARRIER_RE.test(l.text)) return hit;
  }
  return undefined;
}

function policyNumberIn(text: string): string | undefined {
  const m = text.match(POLICY_RE) ?? text.match(POLICY_BARE_RE);
  if (!m) return undefined;
  const value = m[1].split(/\s{2,}|\s+(?=(?:policy|term|period|effective|eff|line|insured|named|dates?)\b)/i)[0].trim();
  return /\d/.test(value) ? value.toUpperCase() : undefined;
}

interface Section {
  start: number;
  policyNumber?: string;
  coverageStart?: string;
  coverageEnd?: string;
  lines: TextLine[];
}

export interface LossRowPosition {
  /** Position of the claim in the document (TextLine.index, or its order for documents without layout). */
  position: number | undefined;
}

export interface StatedTotals {
  position: number;
  claims?: number;
  paid?: number;
  reserve?: number;
  incurred?: number;
}

/** "Total Paid: $X", "Total Claims: 3", "Totals: 3 claims" — labeled amounts only. */
export function labeledTotals(lines: TextLine[], pos: (l: TextLine, i: number) => number): StatedTotals[] {
  const out: StatedTotals[] = [];
  lines.forEach((l, i) => {
    const t = l.text;
    if (!/\btotal|number\s+of\s+claims|claim\s+count/i.test(t)) return;
    const s: StatedTotals = { position: pos(l, i) };
    const count = t.match(/(?:total\s+(?:number\s+of\s+)?claims|number\s+of\s+claims|claim\s+count)\s*[:\-]?\s*(\d+)/i) ?? t.match(/\b(\d+)\s+claims?\b/i);
    if (count) s.claims = Number(count[1]);
    const amt = (re: RegExp) => {
      const m = t.match(re);
      return m ? (parseAmount(m[1]) ?? undefined) : undefined;
    };
    s.paid = amt(/total\s+(?:net\s+)?paid\s*[:\-]?\s*(\(?\$?[\d,]+(?:\.\d+)?\)?)/i);
    s.reserve = amt(/total\s+(?:outstanding|reserves?)\s*[:\-]?\s*(\(?\$?[\d,]+(?:\.\d+)?\)?)/i);
    s.incurred = amt(/total\s+incurred\s*[:\-]?\s*(\(?\$?[\d,]+(?:\.\d+)?\)?)/i);
    if (s.claims !== undefined || s.paid !== undefined || s.reserve !== undefined || s.incurred !== undefined) out.push(s);
  });
  return out;
}

/**
 * The loss-run records in a document. `lines` are the document's text lines without table rows
 * (a claim row's dates aren't a policy period). `claimPositions` are where each extracted claim
 * sits; the result says which record each one belongs to (same order), so the caller can link them.
 */
export function extractLossRunDrafts(
  lines: TextLine[],
  opts: { documentId: string; claimPositions: (number | undefined)[]; statedTotals: StatedTotals[] }
): { drafts: LossRunDraft[]; claimKeys: (string | undefined)[] } {
  const pos = (l: TextLine, i: number) => l.index ?? i;
  const carrier = findCarrier(lines);
  let reportDate: string | undefined;
  for (const l of lines) {
    const m = l.text.match(REPORT_DATE_RE);
    if (m) {
      reportDate = iso(m[1]);
      if (reportDate) break;
    }
  }

  // Sections: each policy number starts one; the period/effective dates just after it belong to it.
  const sections: Section[] = [];
  lines.forEach((l, i) => {
    const p = pos(l, i);
    const policyNumber = policyNumberIn(l.text);
    const current = sections[sections.length - 1];
    if (policyNumber && (!current || current.policyNumber)) sections.push({ start: p, policyNumber, lines: [l] });
    else if (policyNumber && current) {
      current.policyNumber = policyNumber;
      current.lines.push(l);
    }
    else if (current) current.lines.push(l);
    else if (!sections.length) sections.push({ start: -Infinity, lines: [l] });
  });
  // A heading-only first section (report title, carrier) with no policy of its own folds into the next.
  if (sections.length > 1 && !sections[0].policyNumber) {
    const [head, next, ...rest] = sections;
    sections.splice(0, sections.length, { ...next, start: head.start, lines: [...head.lines, ...next.lines] }, ...rest);
  }
  for (const s of sections) {
    for (const l of s.lines) {
      const period = l.text.match(PERIOD_RE) ?? l.text.match(PERIOD_LABELED_RE);
      if (period && !s.coverageStart) {
        s.coverageStart = iso(period[1]);
        s.coverageEnd = iso(period[2]);
      }
      const eff = l.text.match(EFFECTIVE_RE);
      if (eff && !s.coverageStart) s.coverageStart = iso(eff[1]);
      const exp = l.text.match(EXPIRATION_RE);
      if (exp && !s.coverageEnd) s.coverageEnd = iso(exp[1]);
    }
  }

  const sectionAt = (p: number | undefined) => {
    if (p === undefined) return sections.length ? 0 : -1;
    let k = -1;
    sections.forEach((s, i) => {
      if (s.start <= p) k = i;
    });
    return k === -1 ? 0 : k;
  };

  // Merge sections that are the same policy term (a header repeated on every page).
  const keyOf = (s: Section) => `${s.policyNumber ?? ''}|${s.coverageStart ?? ''}`;
  const draftsByKey = new Map<string, LossRunDraft>();
  const sectionKey = sections.map((s, i) => {
    const k = keyOf(s) === '|' ? `#${i}` : keyOf(s);
    if (!draftsByKey.has(k)) {
      draftsByKey.set(k, {
        key: `${opts.documentId}:${draftsByKey.size}`,
        carrier: carrier ?? 'Carrier not listed',
        ...(s.policyNumber ? { policyNumber: s.policyNumber } : {}),
        ...(reportDate ? { reportDate } : {}),
        ...(s.coverageStart ? { coverageStart: s.coverageStart } : {}),
        ...(s.coverageEnd ? { coverageEnd: s.coverageEnd } : {}),
        documentId: opts.documentId,
      });
    }
    return k;
  });

  const claimKeys = opts.claimPositions.map((p) => {
    const k = sectionAt(p);
    return k === -1 ? undefined : draftsByKey.get(sectionKey[k])!.key;
  });

  sections.forEach((s, i) => {
    const draft = draftsByKey.get(sectionKey[i])!;
    const hasClaims = claimKeys.includes(draft.key);
    if (!hasClaims && s.lines.some((l) => NO_LOSSES_RE.test(l.text))) {
      draft.claimCount = 0;
      draft.totalPaid = 0;
      draft.totalReserve = 0;
      draft.totalIncurred = 0;
    }
  });
  for (const t of opts.statedTotals) {
    const k = sectionAt(t.position);
    if (k === -1) continue;
    const draft = draftsByKey.get(sectionKey[k])!;
    if (t.claims !== undefined) draft.claimCount = t.claims;
    if (t.paid !== undefined) draft.totalPaid = t.paid;
    if (t.reserve !== undefined) draft.totalReserve = t.reserve;
    if (t.incurred !== undefined) draft.totalIncurred = t.incurred;
  }

  // A section with nothing of its own (no policy, no claims, no statement) isn't a record.
  const drafts = [...draftsByKey.values()].filter(
    (d) => d.policyNumber || d.claimCount !== undefined || d.totalIncurred !== undefined || claimKeys.includes(d.key)
  );
  return { drafts, claimKeys: claimKeys.map((k) => (k && drafts.some((d) => d.key === k) ? k : undefined)) };
}
