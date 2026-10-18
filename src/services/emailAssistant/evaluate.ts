import { parseEmailInput } from './parseEmail';
import { referenceDateFor } from './rulesExtractor';
import { isHighRisk, safetyChecks } from './safetyChecks';
import type { DocumentStance, EmailExtraction, EmailExtractor, EmailIntent } from './types';

/**
 * Scores an extractor against labelled synthetic emails — so the fixed rules used today can later
 * be compared with an AI extractor on exactly the same emails, by the same measures. Pure: no
 * network, no account data.
 */
export interface LabelledEmail {
  id: string;
  raw: string;
  source: 'paste' | 'eml';
  expected: {
    intent: EmailIntent;
    /** requirementKey → stance, for every document that matters. */
    documents: Record<string, DocumentStance>;
    /** Earliest deadline, YYYY-MM-DD, or null. */
    deadline: string | null;
    suspicious: boolean;
  };
  /** Relative dates count from here when the email has no Date. */
  today: string;
}

export interface CaseScore {
  id: string;
  intentCorrect: boolean;
  /** Requested documents: found correctly / missed / wrongly added. */
  truePositives: number;
  falseNegatives: string[];
  falsePositives: string[];
  stanceErrors: string[];
  deadlineCorrect: boolean;
  suspiciousCorrect: boolean;
}

export interface CorpusScore {
  extractor: string;
  cases: CaseScore[];
  intentAccuracy: number;
  documentPrecision: number;
  documentRecall: number;
  deadlineAccuracy: number;
  suspiciousAccuracy: number;
}

export function scoreCase(c: LabelledEmail, actual: EmailExtraction, suspicious: boolean): CaseScore {
  const expectedRequested = Object.entries(c.expected.documents).filter(([, s]) => s === 'requested').map(([k]) => k);
  const actualRequested = actual.documents.filter((d) => d.stance === 'requested').map((d) => d.requirementKey);
  const stanceErrors = Object.entries(c.expected.documents)
    .filter(([k, s]) => {
      const got = actual.documents.find((d) => d.requirementKey === k)?.stance ?? 'absent';
      return s !== 'requested' && got !== s && !(s === 'mentioned' && got === 'absent');
    })
    .map(([k]) => k);
  return {
    id: c.id,
    intentCorrect: actual.intent === c.expected.intent,
    truePositives: actualRequested.filter((k) => expectedRequested.includes(k)).length,
    falseNegatives: expectedRequested.filter((k) => !actualRequested.includes(k)),
    falsePositives: actualRequested.filter((k) => !expectedRequested.includes(k)),
    stanceErrors,
    deadlineCorrect: (actual.deadlines[0]?.date ?? null) === c.expected.deadline,
    suspiciousCorrect: suspicious === c.expected.suspicious,
  };
}

export async function evaluateExtractor(extractor: EmailExtractor, corpus: LabelledEmail[]): Promise<CorpusScore> {
  const cases: CaseScore[] = [];
  for (const c of corpus) {
    const email = parseEmailInput(c.raw, c.source);
    const actual = await extractor.extract(email, { referenceDate: referenceDateFor(email, c.today) });
    cases.push(scoreCase(c, actual, isHighRisk(safetyChecks(email))));
  }
  const tp = cases.reduce((s, c) => s + c.truePositives, 0);
  const fp = cases.reduce((s, c) => s + c.falsePositives.length, 0);
  const fn = cases.reduce((s, c) => s + c.falseNegatives.length, 0);
  const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);
  return {
    extractor: `${extractor.id}@${extractor.version}`,
    cases,
    intentAccuracy: ratio(cases.filter((c) => c.intentCorrect).length, cases.length),
    documentPrecision: ratio(tp, tp + fp),
    documentRecall: ratio(tp, tp + fn),
    deadlineAccuracy: ratio(cases.filter((c) => c.deadlineCorrect).length, cases.length),
    suspiciousAccuracy: ratio(cases.filter((c) => c.suspiciousCorrect).length, cases.length),
  };
}
