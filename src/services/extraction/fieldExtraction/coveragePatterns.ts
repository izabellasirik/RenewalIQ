import type { CoverageType } from '../../../types';
import type { TextLine } from './textLines';

/** Shared coverage-type vocabulary — used both for structured coverage tables and for a plain "Desired Coverage: X, Y" list. */
export const COVERAGE_TYPE_ALIASES: { match: RegExp; type: CoverageType }[] = [
  { match: /auto\s*liability|csl|combined single limit/i, type: 'auto_liability' },
  { match: /cargo/i, type: 'motor_truck_cargo' },
  { match: /physical\s*damage/i, type: 'physical_damage' },
  { match: /general\s*liability/i, type: 'general_liability' },
];

const DESIRED_COVERAGE_LABEL_PATTERNS = [
  /desired coverage\s*:\s*(.+)/i,
  /requested coverage\s*:\s*(.+)/i,
  /coverages?\s+requested\s*:\s*(.+)/i,
  /coverage\s+requested\s*:\s*(.+)/i,
  /coverage\s*:\s*(.+)/i,
];

/** Finds every distinct CoverageType mentioned anywhere in raw text — used to split a comma-separated list of desired lines. */
function findCoverageTypes(raw: string): CoverageType[] {
  const found: CoverageType[] = [];
  for (const alias of COVERAGE_TYPE_ALIASES) {
    if (alias.match.test(raw) && !found.includes(alias.type)) found.push(alias.type);
  }
  return found;
}

export interface DesiredCoverageMatch {
  coverageTypes: CoverageType[];
  matchedText: string;
  page?: number;
}

/**
 * Scans lines for a plain "Desired/Requested Coverage: Auto Liability, Cargo, Physical Damage"
 * style label — a list of coverage lines the client wants with no dollar amount at all. This is
 * distinct from the per-type "Auto Liability: $1,000,000" patterns (which already handle the
 * amount-included case) — here the goal is only to make sure the coverage LINE exists so the
 * broker can fill in the limit, never to invent one.
 */
export function extractDesiredCoverageLine(lines: TextLine[]): DesiredCoverageMatch | null {
  for (const pattern of DESIRED_COVERAGE_LABEL_PATTERNS) {
    for (const line of lines) {
      const m = line.text.match(pattern);
      if (!m || !m[1]) continue;
      const coverageTypes = findCoverageTypes(m[1]);
      if (coverageTypes.length > 0) return { coverageTypes, matchedText: line.text, page: line.page };
    }
  }
  return null;
}
