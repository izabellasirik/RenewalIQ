import type { DocumentCategory, ExtractedFieldResult } from '../../types';

/**
 * What an uploaded document evidently is, read from its content (and name): the kinds of
 * requirement it could satisfy, the people it names, and any quarter it covers. Used to check a
 * client's upload against what was asked for (matchUpload.ts) — never to guess on its own.
 */
export type RequirementKind = 'mvr' | 'ifta' | 'loss_runs' | 'application' | 'unit_list' | 'driver_list' | 'driver_license' | 'vehicle_registration';

export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  mvr: 'an MVR',
  ifta: 'an IFTA return',
  loss_runs: 'a loss run',
  application: 'an application',
  unit_list: 'a vehicle schedule',
  driver_list: 'a driver list',
  driver_license: "a driver's license",
  vehicle_registration: 'a vehicle registration',
};

export interface DocumentSignals {
  kinds: RequirementKind[];
  /** People named in it, lower-case "first last" (drivers, the licensee, the MVR subject). */
  names: string[];
  /** Quarters it covers, e.g. "Q2" or "Q2 2026". */
  quarters: string[];
}

const CATEGORY_KIND: Partial<Record<DocumentCategory, RequirementKind>> = {
  loss_run: 'loss_runs',
  vehicle_schedule: 'unit_list',
  driver_schedule: 'driver_list',
  driver_license: 'driver_license',
  vehicle_registration: 'vehicle_registration',
  application: 'application',
};

const TEXT_KINDS: { kind: RequirementKind; re: RegExp }[] = [
  { kind: 'mvr', re: /\bmvr\b|motor\s+vehicle\s+(?:record|report)|driving\s+record|driver\s+record\s+abstract|record\s+of\s+convictions/i },
  { kind: 'ifta', re: /\bifta\b|international\s+fuel\s+tax|fuel\s+tax\s+(?:return|report)|motor\s+(?:carrier\s+)?fuel\s+tax/i },
  { kind: 'loss_runs', re: /\bloss[\s_-]*runs?\b|\bclaims?\s+history\b|\bloss\s+history\b|\bloss\s+experience\b/i },
  { kind: 'application', re: /\bacord\s*1[23]\d\b|\binsurance\s+application\b|\btrucking\s+application\b/i },
  { kind: 'unit_list', re: /\bvehicle\s+schedule\b|\bschedule\s+of\s+(?:covered\s+)?autos\b|\bunit\s+list\b|\bequipment\s+list\b/i },
  { kind: 'driver_list', re: /\bdriver\s+(?:list|schedule|roster)\b/i },
];

/** "SMITH, ALEX J" / "Alex J. Smith" → "alex smith". */
export function normalizePersonName(raw: string): string {
  let t = raw.replace(/[^A-Za-z,'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.includes(',')) {
    const [last, first] = t.split(',', 2).map((x) => x.trim());
    t = `${first} ${last}`;
  }
  const words = t
    .toLowerCase()
    .split(' ')
    .filter((w) => w.length > 1); // drop middle initials
  return words.length >= 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(' ');
}

/** "Name: SMITH, JOHN A" / "Driver Name - John Smith" — the label in any case, the name on the same line. */
const NAME_LABEL_RE = /\b(?:driver'?s?\s+name|name|licensee|subject|operator)\s*[:-][ \t]*([A-Za-z][A-Za-z'.-]*(?:,?[ \t]+[A-Za-z][A-Za-z'.-]*){1,3})/i;
/** Words that end a name on the line (the next label). */
const NAME_STOP_RE = /[ \t,]+(?:dob|date|birth|license|lic|dl|address|sex|state|class|exp|issued?|id|no|number)\b.*$/i;

function labeledNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(NAME_LABEL_RE);
    if (m) out.push(normalizePersonName(m[1].replace(NAME_STOP_RE, '')));
  }
  return out;
}
const QUARTER_RE = /\b(?:Q\s?([1-4])|([1-4])(?:st|nd|rd|th)\s+(?:qtr|quarter)|(?:qtr|quarter)\s*([1-4]))\b(?:[\s,/-]*(20\d\d))?/gi;

export function detectDocumentSignals(input: { text: string; fileName: string; category?: DocumentCategory; results?: Pick<ExtractedFieldResult, 'fieldPath' | 'value'>[] }): DocumentSignals {
  const { text, fileName, category, results = [] } = input;
  const haystack = `${fileName.replace(/[_.-]+/g, ' ')}\n${text}`;
  const kinds = new Set<RequirementKind>();
  const fromCategory = category ? CATEGORY_KIND[category] : undefined;
  if (fromCategory) kinds.add(fromCategory);
  for (const { kind, re } of TEXT_KINDS) if (re.test(haystack)) kinds.add(kind);
  if (results.some((r) => r.fieldPath === 'lossRun' || r.fieldPath === 'lossHistory')) kinds.add('loss_runs');
  // A driver's license on its own reads as a license, not an MVR, even though it says "driver".
  if (kinds.has('driver_license') && !/\bmvr\b|motor\s+vehicle\s+record|driving\s+record/i.test(haystack)) kinds.delete('mvr');

  const names = new Set<string>();
  for (const r of results) {
    if (r.fieldPath === 'drivers') {
      const n = (r.value as { name?: string }).name;
      if (n) names.add(normalizePersonName(n));
    }
  }
  for (const n of labeledNames(text)) names.add(n);

  const quarters = new Set<string>();
  for (const m of haystack.matchAll(QUARTER_RE)) {
    const q = m[1] ?? m[2] ?? m[3];
    quarters.add(m[4] ? `Q${q} ${m[4]}` : `Q${q}`);
  }
  return { kinds: [...kinds], names: [...names].filter((n) => n.includes(' ')), quarters: [...quarters] };
}
