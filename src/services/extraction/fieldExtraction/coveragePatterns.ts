import type { CoverageType } from '../../../types';
import type { TextLine } from './textLines';

/** Shared coverage-type vocabulary — used both for structured coverage tables and for a plain "Desired Coverage: X, Y" list. */
export const COVERAGE_TYPE_ALIASES: { match: RegExp; type: CoverageType }[] = [
  { match: /auto\s*liability|csl|combined single limit/i, type: 'auto_liability' },
  { match: /cargo/i, type: 'motor_truck_cargo' },
  { match: /physical\s*damage/i, type: 'physical_damage' },
  { match: /warehouse(?:\s*legal)?\s*liability/i, type: 'warehouse_legal_liability' },
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

export interface CurrentPolicyCoverageMatch {
  coverageType: CoverageType;
  currentLimit: string;
  matchedText: string;
  page?: number;
}

/** A coverage-type name directly followed by a dollar amount, with only ordinary single-space gaps — how OCR'd text usually renders a declarations-page row, since visual multi-space column gaps rarely survive OCR as literal repeated spaces. */
const INLINE_COVERAGE_AMOUNT = /^(auto\s*liability|csl|combined single limit|(?:motor truck )?cargo|physical\s*damage|warehouse(?:\s*legal)?\s*liability|general\s*liability)\s+\$?([\d,]+(?:\.\d+)?)\s*(?:csl)?$/i;

/**
 * Reads a current/expiring-policy coverage table rendered as one line per row. Two shapes are
 * recognized: "Commercial Auto Liability   $1,000,000 CSL   N/A" with columns separated by
 * two-or-more spaces (how pdfjs-dist renders a table's cell gaps as plain text, since PDFs carry no
 * real table markup), and "General Liability $1,000,000" with a single ordinary space (how the same
 * row typically comes back from OCR, which collapses visual column gaps to normal spacing). Only
 * lines whose coverage-type portion matches a known alias are used, so this can never guess a limit
 * off of an unrelated line (or the "Coverage / Limit / Deductible" header row itself).
 */
export function extractCurrentPolicyCoverageLines(lines: TextLine[]): CurrentPolicyCoverageMatch[] {
  const results: CurrentPolicyCoverageMatch[] = [];
  for (const line of lines) {
    const trimmed = line.text.trim();
    const columns = trimmed.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (columns.length >= 2) {
      const [label, limit] = columns;
      const alias = COVERAGE_TYPE_ALIASES.find((a) => a.match.test(label));
      if (alias) {
        results.push({ coverageType: alias.type, currentLimit: limit, matchedText: line.text, page: line.page });
        continue;
      }
    }
    const inline = trimmed.match(INLINE_COVERAGE_AMOUNT);
    if (inline) {
      const alias = COVERAGE_TYPE_ALIASES.find((a) => a.match.test(inline[1]));
      if (alias) {
        results.push({ coverageType: alias.type, currentLimit: `$${inline[2]}`, matchedText: line.text, page: line.page });
      }
    }
  }
  return results;
}
