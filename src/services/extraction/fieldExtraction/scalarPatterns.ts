import type { Confidence } from '../../../types';
import { parseCount, parseMoney } from './money';
import { parseStateList, parseStateFromPhrase } from '../../../utils/usStates';

export type ScalarCoerce = (raw: string) => unknown | null;

export interface ScalarPatternGroup {
  confidence: Confidence;
  /** Each regex must have exactly one capture group holding the raw value. */
  patterns: RegExp[];
}

export interface ScalarFieldPattern {
  fieldPath: string;
  /** Turns the raw captured text into the typed value RiskProfile expects. Return null to reject the match (e.g. unparseable number) — never guess a replacement. */
  coerce: ScalarCoerce;
  /** Tried in order; the first group with a match on any line wins for this field. */
  groups: ScalarPatternGroup[];
}

function asStringList(raw: string): string[] | null {
  const items = raw
    .split(/,|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function asCoverageLimit(raw: string): string {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US')}` : raw.trim();
}

function asOperatingRadius(raw: string): string {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? `${trimmed} miles` : trimmed;
}

/**
 * Regulatory identifiers (DOT/MC numbers) are never inferred or guessed — this is the single
 * format check every identifier coerce runs through, on top of the regex that captured the text in
 * the first place. Digits-only, within a plausible length: rejects anything an OCR/fuzzy match
 * could produce that isn't a clean number (e.g. a stray alphanumeric fragment).
 */
function isValidIdentifier(raw: string, minLength: number, maxLength: number): boolean {
  const trimmed = raw.trim();
  return new RegExp(`^\\d{${minLength},${maxLength}}$`).test(trimmed);
}

/**
 * Deterministic label/regex patterns for scalar RiskProfile fields, applied line-by-line over a
 * document's raw text. "high"-confidence groups match explicit "Label: value" formatting; "medium"
 * groups are looser prose fallbacks for unstructured documents like emails. A field with no match
 * anywhere simply isn't returned — the caller/merge layer treats that as missing, never guessed.
 */
export const SCALAR_FIELD_PATTERNS: ScalarFieldPattern[] = [
  {
    fieldPath: 'business.namedInsured',
    coerce: (raw) => raw.trim() || null,
    groups: [
      {
        confidence: 'high',
        patterns: [
          /named insured\s*:\s*(.+)/i,
          /business name\s*:\s*(.+)/i,
          /insured'?s? name\s*:\s*(.+)/i,
          /company name\s*:\s*(.+)/i,
          /applicant(?:'s)? name\s*:\s*(.+)/i,
          /^applicant\s*:\s*(.+)/i,
          /^company\s*:\s*(.+)/i,
          /^insured\s*:\s*(.+)/i,
          /^client\s*:\s*(.+)/i,
        ],
      },
    ],
  },
  {
    fieldPath: 'business.legalEntity',
    coerce: (raw) => raw.trim() || null,
    groups: [
      {
        confidence: 'high',
        patterns: [
          /legal entity(?:\s*type)?\s*:\s*(.+)/i,
          /entity type\s*:\s*(.+)/i,
          /form of business\s*:\s*(.+)/i,
          /(?:type of|business) organization\s*:\s*(.+)/i,
          /business (?:structure|type)\s*:\s*(.+)/i,
        ],
      },
    ],
  },
  {
    fieldPath: 'business.address',
    coerce: (raw) => raw.trim() || null,
    groups: [
      {
        confidence: 'high',
        patterns: [/(?:mailing|business|physical|principal)\s+address\s*:\s*(.+)/i, /^address\s*:\s*(.+)/i, /(?:business|company)\s+location\s*:\s*(.+)/i],
      },
    ],
  },
  {
    fieldPath: 'business.state',
    coerce: parseStateFromPhrase,
    groups: [
      {
        confidence: 'high',
        patterns: [
          /(?:domicile|mailing|home|principal|operating)\s+state\s*:\s*(.+)/i,
          /state of (?:domicile|incorporation|formation)\s*:\s*(.+)/i,
          /^state\s*:\s*(.+)/i,
        ],
      },
    ],
  },
  {
    fieldPath: 'business.yearsInBusiness',
    coerce: parseCount,
    groups: [
      { confidence: 'high', patterns: [/years?\s+in\s+business\s*:\s*(\d+)/i, /(?:time|years)\s+operating\s*:\s*(\d+)/i, /business age(?: \(years\))?\s*:\s*(\d+)/i] },
      { confidence: 'medium', patterns: [/(?:in business|operating)\s+for\s+(\d+)\s+years?/i, /(\d+)\s+years?\s+in\s+business/i] },
    ],
  },
  {
    fieldPath: 'business.annualRevenue',
    coerce: parseMoney,
    groups: [
      {
        confidence: 'high',
        patterns: [/(?:annual revenue|gross receipts|revenue|gross sales|annual sales|total revenue|yearly revenue)\s*:\s*\$?([\d,.]+\s*(?:million|mm|m|thousand|k)?)/i],
      },
      { confidence: 'medium', patterns: [/(?:revenue|receipts|sales)\s+(?:of|around|roughly|approximately|was|were)?\s*\$?([\d,.]+\s*(?:million|mm|m|thousand|k)?)/i] },
    ],
  },
  {
    fieldPath: 'business.descriptionOfOperations',
    coerce: (raw) => raw.trim() || null,
    groups: [
      {
        confidence: 'high',
        patterns: [
          /description of operations\s*:\s*(.+)/i,
          /nature of operations\s*:\s*(.+)/i,
          /nature of business\s*:\s*(.+)/i,
          /(?:type|description) of business\s*:\s*(.+)/i,
          /business description\s*:\s*(.+)/i,
        ],
      },
      { confidence: 'medium', patterns: [/^operations\s*:\s*(.+)/i] },
    ],
  },
  {
    fieldPath: 'transportation.dotNumber',
    // Identifier fields are never inferred: the coerce step re-validates the captured text is
    // digits-only within a plausible DOT-number length, on top of the regex already requiring it,
    // so a fuzzy/OCR-like fragment can never slip through even if a pattern above is loosened later.
    coerce: (raw) => (isValidIdentifier(raw, 5, 8) ? raw.trim() : null),
    groups: [
      {
        confidence: 'high',
        patterns: [/us\s*dot\s*(?:number|#|no\.?)?\s*:\s*(\d{5,8})/i, /dot\s*(?:number|#|no\.?)\s*:\s*(\d{5,8})/i, /dot\s*id\s*:\s*(\d{5,8})/i],
      },
      { confidence: 'medium', patterns: [/\bdot\s*(?:number|no\.?|#)?\s*(?:is)?\s*[:#]?\s*(\d{6,8})\b/i] },
    ],
  },
  {
    fieldPath: 'transportation.mcNumber',
    // Same defense-in-depth as dotNumber above — only ever accepts a digits-only match from a
    // parsed source field, never a guess (e.g. prose like "will send it later" has no digits to match).
    coerce: (raw) => (isValidIdentifier(raw, 4, 8) ? raw.trim() : null),
    groups: [
      { confidence: 'high', patterns: [/mc\s*(?:number|#|no\.?)\s*:\s*(\d{4,8})/i] },
      { confidence: 'medium', patterns: [/\bmc\s*(?:number|no\.?|#)?\s*(?:is)?\s*[:#]?\s*(\d{4,8})\b/i] },
    ],
  },
  {
    fieldPath: 'transportation.fleetSize',
    coerce: parseCount,
    groups: [
      { confidence: 'high', patterns: [/(?:fleet size|number of power units|power units)\s*:\s*(\d+)/i] },
      { confidence: 'medium', patterns: [/we\s+(?:currently\s+)?(?:run|operate|have)\s+(\d+)\s+(?:trucks|tractors|power units|vehicles)/i, /(\d+)\s+(?:power units|trucks|tractors)\b/i] },
    ],
  },
  {
    fieldPath: 'transportation.vehicleTypes',
    coerce: asStringList,
    groups: [{ confidence: 'high', patterns: [/vehicle types?\s*:\s*(.+)/i] }],
  },
  {
    fieldPath: 'transportation.statesOfOperation',
    coerce: (raw) => {
      const codes = parseStateList(raw);
      return codes.length > 0 ? codes : null;
    },
    groups: [
      {
        confidence: 'high',
        patterns: [
          /states?\s+of\s+operation\s*:\s*(.+)/i,
          /operating\s+states?\s*:\s*(.+)/i,
          /states?\s+operated\s*:\s*(.+)/i,
          /states?\s+(?:traveled|serviced)\s*:\s*(.+)/i,
          /^states\s*:\s*(.+)/i,
        ],
      },
      {
        confidence: 'medium',
        patterns: [/(?:haul(?:ing)?|operat(?:e|ing)|run(?:ning)?|travel(?:ing)?)\b[^.]*?\b(?:throughout|across|in|through)\s+([A-Z]{2}(?:\s*,\s*[A-Z]{2})*(?:\s*,?\s*and\s+[A-Z]{2})?)/],
      },
    ],
  },
  {
    fieldPath: 'transportation.operatingRadius',
    coerce: asOperatingRadius,
    groups: [
      { confidence: 'high', patterns: [/(?:operating )?radius\s*:\s*(.+)/i] },
      { confidence: 'medium', patterns: [/(\d+)\s*[- ]?mile\s+radius/i] },
    ],
  },
  {
    fieldPath: 'transportation.commoditiesHauled',
    coerce: asStringList,
    groups: [
      { confidence: 'high', patterns: [/commodit(?:y|ies)(?: hauled)?\s*:\s*(.+)/i, /cargo\s*:\s*(.+)/i] },
      { confidence: 'medium', patterns: [/haul(?:ing)?\s+([a-z][a-z ,]*?)(?:\s+throughout|\s+across|\s+in\s+[A-Z]{2}|[.,]|$)/i] },
    ],
  },
  {
    fieldPath: 'transportation.driverCount',
    coerce: parseCount,
    groups: [
      { confidence: 'high', patterns: [/(?:number of drivers|driver count|total drivers)\s*:\s*(\d+)/i] },
      { confidence: 'medium', patterns: [/(\d+)\s+drivers\b/i] },
    ],
  },
  {
    fieldPath: 'transportation.minDriverAge',
    coerce: parseCount,
    groups: [{ confidence: 'high', patterns: [/min(?:imum)?\s+driver\s+age\s*:\s*(\d+)/i] }],
  },
  {
    fieldPath: 'transportation.minDriverExperienceYears',
    coerce: parseCount,
    groups: [{ confidence: 'high', patterns: [/min(?:imum)?\s+(?:driver\s+)?experience(?:\s*\(years\))?\s*:\s*(\d+)/i, /min(?:imum)?\s+years?\s+(?:of\s+)?experience\s*:\s*(\d+)/i] }],
  },
  {
    fieldPath: 'coverage.auto_liability.requestedLimit',
    coerce: asCoverageLimit,
    groups: [{ confidence: 'high', patterns: [/auto liability(?:\s+limit)?(?:\s+requested)?\s*:\s*\$?([\d,]+)/i, /(?:combined single limit|csl)\s*:\s*\$?([\d,]+)/i] }],
  },
  {
    fieldPath: 'coverage.motor_truck_cargo.requestedLimit',
    coerce: asCoverageLimit,
    groups: [{ confidence: 'high', patterns: [/(?:motor truck )?cargo(?:\s+limit)?(?:\s+requested)?\s*:\s*\$?([\d,]+)/i] }],
  },
  {
    fieldPath: 'coverage.physical_damage.requestedLimit',
    coerce: asCoverageLimit,
    groups: [{ confidence: 'high', patterns: [/physical damage(?:\s+limit)?(?:\s+requested)?\s*:\s*\$?([\d,]+)/i] }],
  },
  {
    fieldPath: 'coverage.general_liability.requestedLimit',
    coerce: asCoverageLimit,
    groups: [{ confidence: 'high', patterns: [/general liability(?:\s+limit)?(?:\s+requested)?\s*:\s*\$?([\d,]+)/i] }],
  },
];
