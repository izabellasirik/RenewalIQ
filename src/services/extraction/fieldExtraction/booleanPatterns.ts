import type { Confidence } from '../../../types';

const TRUTHY_TOKENS = new Set(['yes', 'y', 'true', 'installed']);
const FALSY_TOKENS = new Set(['no', 'n', 'false', 'not installed', 'none']);

export interface BooleanFieldPattern {
  fieldPath: string;
  /** "Label: yes/no" style — capture group is the token. High confidence, explicit. */
  labeledPatterns: RegExp[];
  /** Mentions that imply the field is true without an explicit label, e.g. "dashcams installed on all trucks". Medium confidence. */
  truthyMentionPatterns: RegExp[];
  /** Mentions that imply the field is false. Medium confidence. */
  falsyMentionPatterns: RegExp[];
}

export const BOOLEAN_FIELD_PATTERNS: BooleanFieldPattern[] = [
  {
    fieldPath: 'transportation.telematics',
    labeledPatterns: [/telematics\s*:\s*(yes|no|y|n|installed|not installed|none)/i],
    truthyMentionPatterns: [/telematics\s+(?:is|are)?\s*installed/i, /(?:have|has|with)\s+telematics/i, /telematics\s+devices?\s+(?:on|in)/i],
    falsyMentionPatterns: [/no\s+telematics/i, /without\s+telematics/i],
  },
  {
    fieldPath: 'transportation.dashcams',
    labeledPatterns: [/dash\s*-?cams?\s*:\s*(yes|no|y|n|installed|not installed|none)/i],
    truthyMentionPatterns: [/dash\s*-?cams?\s+(?:is|are)?\s*installed/i, /(?:have|has|with)\s+dash\s*-?cams?/i],
    falsyMentionPatterns: [/no\s+dash\s*-?cams?/i, /without\s+dash\s*-?cams?/i],
  },
];

export interface BooleanMatch {
  fieldPath: string;
  value: boolean;
  confidence: Confidence;
  matchedText: string;
  page?: number;
}

function tokenToBoolean(token: string): boolean | null {
  const t = token.toLowerCase().trim();
  if (TRUTHY_TOKENS.has(t)) return true;
  if (FALSY_TOKENS.has(t)) return false;
  return null;
}

export function extractBooleanFields(lines: { text: string; page?: number }[], fullText: string): BooleanMatch[] {
  const results: BooleanMatch[] = [];

  for (const def of BOOLEAN_FIELD_PATTERNS) {
    let found: BooleanMatch | null = null;

    for (const line of lines) {
      for (const pattern of def.labeledPatterns) {
        const m = line.text.match(pattern);
        if (!m) continue;
        const value = tokenToBoolean(m[1]);
        if (value === null) continue;
        found = { fieldPath: def.fieldPath, value, confidence: 'high', matchedText: line.text, page: line.page };
        break;
      }
      if (found) break;
    }

    if (!found) {
      const truthy = def.truthyMentionPatterns.find((p) => p.test(fullText));
      const falsy = def.falsyMentionPatterns.find((p) => p.test(fullText));
      if (falsy) {
        const m = fullText.match(falsy);
        found = { fieldPath: def.fieldPath, value: false, confidence: 'medium', matchedText: m?.[0] ?? '' };
      } else if (truthy) {
        const m = fullText.match(truthy);
        found = { fieldPath: def.fieldPath, value: true, confidence: 'medium', matchedText: m?.[0] ?? '' };
      }
    }

    if (found) results.push(found);
  }

  return results;
}
