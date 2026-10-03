import type { MissingItem, MissingItemStatus } from '../../types';

/**
 * Logical identity of a checklist requirement, so one document is one row per account no matter
 * who asked for it or how it was typed. "Application", "application ", "Signed Application" and
 * the checklist template's Application all map to `application`; "Current MVR — John Smith" and
 * the per-driver template item "MVR — John Smith" both map to `mvr|john smith`, while David
 * Smith's MVR stays `mvr|david smith`.
 *
 * Deliberately conservative: known trucking document types are recognized through an alias list,
 * and anything unrecognized falls back to its normalized full text — two differently-worded
 * unknown items stay separate rather than being merged by a guess.
 */

/** Canonical requirement types. `perEntity` types (one per driver/vehicle) keep the text after the dash as part of the identity. */
const CANONICAL: { key: string; perEntity?: boolean; aliases: string[] }[] = [
  { key: 'application', aliases: ['application', 'app', 'insurance application', 'trucking application', 'acord application', 'acord 125', 'acord 127', 'supplemental application', 'supplemental app'] },
  { key: 'loss_runs', aliases: ['loss run', 'loss runs', 'loss run report', 'loss history', 'currently valued loss run', 'loss experience'] },
  { key: 'mvr', perEntity: true, aliases: ['mvr', 'motor vehicle record', 'motor vehicle report', 'driving record', 'driver mvr'] },
  { key: 'ifta', aliases: ['ifta', 'ifta return', 'ifta report', 'ifta filing', 'ifta quarterly return', 'ifta mileage'] },
  { key: 'unit_list', aliases: ['unit list', 'vehicle list', 'vehicle schedule', 'equipment list', 'equipment schedule', 'schedule of vehicle', 'auto schedule', 'truck list', 'power unit list'] },
  { key: 'driver_list', aliases: ['driver list', 'driver schedule', 'schedule of driver', 'roster of driver', 'driver roster'] },
];

/** Words that describe freshness/form, not which document it is ("Current MVR" = "MVR"). */
const NOISE_WORDS = new Set(['current', 'updated', 'update', 'latest', 'recent', 'new', 'signed', 'completed', 'complete', 'copy', 'of', 'the', 'a', 'an', 'please', 'provide', 'for', 'all']);

const SEPARATOR = /\s+[—–-]\s+|\s*[—–:]\s*/;

/** Lowercase, strip punctuation, collapse whitespace, naive singular ("runs" → "run", "MVRs" → "mvr"). */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function normalizePhrase(text: string): string {
  return normalizeWords(text).join(' ');
}

function stripNoise(text: string): string {
  return normalizeWords(text)
    .filter((w) => !NOISE_WORDS.has(w))
    .join(' ');
}

const ALIAS_INDEX: { alias: string; canonical: (typeof CANONICAL)[number] }[] = CANONICAL.flatMap((c) =>
  c.aliases.map((a) => ({ alias: stripNoise(a), canonical: c }))
).sort((a, b) => b.alias.length - a.alias.length);

function matchCanonical(base: string): (typeof CANONICAL)[number] | undefined {
  const cleaned = stripNoise(base);
  if (!cleaned) return undefined;
  // Exact alias, or the alias as a whole-word prefix ("ifta last 4 quarter", "loss run 5 year"),
  // or — for per-driver documents — a suffix ("john smith mvr"). Very short aliases ("app") only
  // match exactly, so "app fee receipt" isn't mistaken for the application.
  return ALIAS_INDEX.find(
    ({ alias, canonical }) =>
      cleaned === alias || (alias.length >= 4 && cleaned.startsWith(`${alias} `)) || (canonical.perEntity === true && alias.length >= 3 && (cleaned.startsWith(`${alias} `) || cleaned.endsWith(` ${alias}`)))
  )?.canonical;
}

/** Entity part of a per-entity requirement: "all drivers"/empty → "all", else the normalized name. */
function normalizeEntity(qualifier: string | undefined): string {
  const q = normalizePhrase(qualifier ?? '').replace(/^(for|driver|of)\s+/, '');
  if (!q || q === 'all driver' || q === 'all' || q === 'every driver' || q === 'each driver') return 'all';
  return q;
}

/** The stable identity for a requirement label (+ its checklist template key, when it came from one). */
export function requirementKey(item: Pick<MissingItem, 'label'> & { templateKey?: string }): string {
  const label = item.label ?? '';
  const [rawBase, ...rest] = label.split(SEPARATOR);
  const qualifier = rest.join(' ');

  const templateBase = item.templateKey?.split(':')[0];
  const canonical = (templateBase && CANONICAL.find((c) => c.key === templateBase)) || matchCanonical(rawBase) || matchCanonical(label);
  if (canonical) {
    // MVR text often puts the name first ("John Smith MVR") or with no dash ("MVR John Smith").
    if (canonical.perEntity) {
      let entity = qualifier;
      if (!entity) {
        const aliasWords = new Set(canonical.aliases.flatMap((a) => normalizeWords(a)));
        entity = normalizeWords(rawBase)
          .filter((w) => !aliasWords.has(w) && !NOISE_WORDS.has(w))
          .join(' ');
      }
      return `${canonical.key}|${normalizeEntity(entity)}`;
    }
    return canonical.key;
  }
  return `text|${normalizePhrase(label)}`;
}

/** Carriers (quote ids) waiting on an item, including the legacy single-carrier field. */
export function carriersFor(item: MissingItem): string[] {
  const ids = [...(item.neededByQuoteIds ?? [])];
  if (item.neededByQuoteId && !ids.includes(item.neededByQuoteId)) ids.push(item.neededByQuoteId);
  return ids;
}

/** When the item was sent to one carrier, if it has been. */
export function forwardedAt(item: MissingItem, quoteId: string): string | undefined {
  return item.forwardedTo?.[quoteId] ?? (item.neededByQuoteId === quoteId ? item.forwardedToCarrierAt : undefined);
}

/** Folds the legacy single-carrier fields into neededByQuoteIds / forwardedTo. */
export function upgradeMissingItem(item: MissingItem): MissingItem {
  const { neededByQuoteId, forwardedToCarrierAt, ...rest } = item;
  const neededByQuoteIds = carriersFor(item);
  const forwardedTo = { ...(item.forwardedTo ?? {}) };
  if (neededByQuoteId && forwardedToCarrierAt && !forwardedTo[neededByQuoteId]) forwardedTo[neededByQuoteId] = forwardedToCarrierAt;
  return {
    ...rest,
    ...(neededByQuoteIds.length ? { neededByQuoteIds } : { neededByQuoteIds: undefined }),
    ...(Object.keys(forwardedTo).length ? { forwardedTo } : { forwardedTo: undefined }),
  };
}

const STATUS_PROGRESS: Record<MissingItemStatus, number> = { waived: 0, missing: 1, requested: 2, received: 3 };

function minDefined(values: (string | undefined)[]): string | undefined {
  const defined = values.filter((v): v is string => !!v);
  return defined.length ? defined.sort()[0] : undefined;
}

/**
 * Merges several rows for the same logical requirement into one, keeping everything:
 * every carrier link and per-carrier send date, the most advanced status (waived only if every
 * row was waived), the earliest request / received dates with their contact, the soonest
 * follow-up, the first linked document, and all distinct notes.
 */
export function mergeDuplicateItems(group: MissingItem[]): MissingItem {
  const rows = group.map(upgradeMissingItem);
  // Canonical row: the checklist template's own row if there is one, else the oldest.
  const primary = [...rows].sort((a, b) => Number(!!b.templateKey) - Number(!!a.templateKey) || (a.createdAt < b.createdAt ? -1 : 1))[0];
  if (rows.length === 1) return primary;

  const status = rows.reduce<MissingItemStatus>((best, r) => (STATUS_PROGRESS[r.status] > STATUS_PROGRESS[best] ? r.status : best), 'waived');
  const neededByQuoteIds = [...new Set(rows.flatMap((r) => r.neededByQuoteIds ?? []))];
  const forwardedTo: Record<string, string> = {};
  for (const r of rows) for (const [q, at] of Object.entries(r.forwardedTo ?? {})) if (!forwardedTo[q] || at < forwardedTo[q]) forwardedTo[q] = at;

  const requested = rows.filter((r) => r.requestedAt).sort((a, b) => (a.requestedAt! < b.requestedAt! ? -1 : 1))[0];
  const notes = [...new Set(rows.map((r) => r.notes?.trim()).filter((n): n is string => !!n))];

  return {
    ...primary,
    status,
    templateKey: primary.templateKey ?? rows.find((r) => r.templateKey)?.templateKey,
    neededByQuoteIds: neededByQuoteIds.length ? neededByQuoteIds : undefined,
    forwardedTo: Object.keys(forwardedTo).length ? forwardedTo : undefined,
    requestedAt: requested?.requestedAt,
    requestedFromContactId: requested?.requestedFromContactId ?? rows.find((r) => r.requestedFromContactId)?.requestedFromContactId,
    followUpDate: status === 'requested' ? minDefined(rows.filter((r) => r.status === 'requested').map((r) => r.followUpDate)) : primary.followUpDate,
    receivedAt: status === 'received' ? minDefined(rows.map((r) => r.receivedAt)) : undefined,
    documentId: primary.documentId ?? rows.find((r) => r.documentId)?.documentId,
    notes: notes.length ? notes.join('\n') : undefined,
    createdAt: minDefined(rows.map((r) => r.createdAt)) ?? primary.createdAt,
    updatedAt: rows.map((r) => r.updatedAt).sort().at(-1) ?? primary.updatedAt,
  };
}

/**
 * One row per logical requirement, legacy fields upgraded. Idempotent and order-preserving (the
 * merged row takes the position of the first duplicate) — safe to run on every load.
 */
export function normalizeMissingItems(items: MissingItem[]): MissingItem[] {
  const groups = new Map<string, MissingItem[]>();
  for (const item of items) {
    const key = requirementKey(item);
    const g = groups.get(key);
    if (g) g.push(item);
    else groups.set(key, [item]);
  }
  const needsWork = items.some((i) => i.neededByQuoteId !== undefined || i.forwardedToCarrierAt !== undefined) || groups.size !== items.length;
  if (!needsWork) return items;
  return [...groups.values()].map(mergeDuplicateItems);
}

/** The existing item for this requirement, if any. */
export function findRequirement(items: MissingItem[], candidate: { label: string; templateKey?: string }): MissingItem | undefined {
  const key = requirementKey(candidate);
  return items.find((i) => requirementKey(i) === key);
}
