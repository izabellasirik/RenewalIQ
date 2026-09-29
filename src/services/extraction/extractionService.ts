import type {
  RiskProfile,
  ExtractedFieldResult,
  FieldValue,
  CoverageType,
  LossEntry,
  VehicleEntry,
  DriverEntry,
  CoverageField,
  FieldSource,
  LossRun,
  ReviewFlag,
  ReviewCandidate,
} from '../../types';
import { emptyField } from '../../types';
import { CONFIDENCE_ORDER } from '../../utils/confidence';
import { generateId } from '../../utils/id';
import { normalizeDateKey } from '../workflow/dates';
import type { LossRunDraft } from './fieldExtraction/lossRunPatterns';

function isEqualScalar(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/** Two documents disagreeing only in case/whitespace ("General Freight" vs "general freight") corroborate each other, not conflict. */
function isEqualValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isEqualScalar(v, b[i]));
  }
  return isEqualScalar(a, b);
}

/** `list` plus `source` — once per document, and never the value's own primary source. */
function withSupport(list: FieldSource[] | undefined, source: FieldSource | undefined, primary: FieldSource | undefined): FieldSource[] | undefined {
  const out = (list ?? []).filter((s) => s.documentId !== primary?.documentId);
  if (source && source.documentId !== primary?.documentId && !out.some((s) => s.documentId === source.documentId)) out.push(source);
  return out.length ? out : undefined;
}

/**
 * Merges a newly-extracted value into an existing FieldValue. When two documents
 * disagree, the higher-confidence value wins as the primary and the loser is kept
 * as an alternate so the broker can see and resolve the conflict — nothing is
 * silently overwritten or silently dropped.
 */
export function mergeFieldValue<T>(
  existing: FieldValue<T> | undefined,
  result: ExtractedFieldResult
): FieldValue<T> {
  const incoming: FieldValue<T> = {
    value: result.value as T,
    confidence: result.confidence,
    source: result.source,
    isMissing: false,
    isConflicting: false,
    extractionMethod: result.extractionMethod ?? 'ai_extraction',
    lastUpdatedAt: new Date().toISOString(),
  };

  if (!existing || existing.isMissing || existing.value === null) {
    return incoming;
  }

  if (isEqualValue(existing.value, incoming.value)) {
    // Same value from a second document — corroborates it. When the second read is specifically a
    // vision-model read agreeing with an on-device-OCR read of the SAME image (or vice versa) —
    // two independent extraction mechanisms, not just two documents — that's stronger evidence
    // than either alone, so the confidence is boosted rather than just keeping the stronger of the
    // two. Any other pairing (e.g. two OCR reads from different documents) keeps today's behavior:
    // the stronger of the two confidences wins, never invented beyond what either read alone earned.
    //
    // confirmedByBroker is carried over from `existing` whenever it was already true — a fresh
    // extraction agreeing with a value the broker already explicitly confirmed doesn't un-confirm
    // it — but it is NEVER set here otherwise; corroboration between two AI sources is still an AI
    // result, never "broker confirmed" on its own.
    const methods = new Set([incoming.extractionMethod, existing.extractionMethod]);
    const isVisionOcrCorroboration = incoming.confidence !== 'low' && existing.confidence !== 'low' && methods.has('vision_extraction') && methods.has('image_ocr');
    //
    // Either way, every document stating the value is remembered (`support`), so removing one of
    // them later keeps a value another still supports.
    if (isVisionOcrCorroboration) {
      return {
        ...incoming,
        confidence: 'high',
        isConflicting: existing.isConflicting,
        alternateValues: existing.alternateValues,
        confirmedByBroker: existing.confirmedByBroker,
        support: withSupport(existing.support, existing.source, incoming.source),
      };
    }
    const stronger = CONFIDENCE_ORDER[incoming.confidence] < CONFIDENCE_ORDER[existing.confidence];
    return stronger
      ? {
          ...incoming,
          isConflicting: existing.isConflicting,
          alternateValues: existing.alternateValues,
          confirmedByBroker: existing.confirmedByBroker,
          support: withSupport(existing.support, existing.source, incoming.source),
        }
      : { ...existing, support: withSupport(existing.support, incoming.source, existing.source) };
  }

  // Genuine conflict: two documents disagree. Higher confidence becomes primary.
  const incomingWins = CONFIDENCE_ORDER[incoming.confidence] < CONFIDENCE_ORDER[existing.confidence];
  const primary = incomingWins ? incoming : existing;
  const loser = incomingWins ? existing : incoming;
  // The documents that supported the losing value become alternates too (each still says it).
  const loserSupport = incomingWins && loser.value !== null ? (existing.support ?? []).map((source) => ({ value: loser.value as T, source, extractionMethod: loser.extractionMethod })) : [];

  return {
    ...primary,
    support: incomingWins ? undefined : existing.support,
    isConflicting: true,
    alternateValues: [
      ...(existing.alternateValues ?? []),
      ...(loser.value !== null && loser.source ? [{ value: loser.value, source: loser.source, extractionMethod: loser.extractionMethod }] : []),
      ...loserSupport,
    ],
  };
}

export type FieldResolution<T> = { type: 'primary' } | { type: 'alternate'; index: number } | { type: 'manual'; value: T };

/**
 * Resolves a conflicting (or any) field per the broker's explicit choice — pick the current
 * primary, pick one of the alternates (swapping it in, preserving its own source/extractionMethod),
 * or type a brand-new value. In every case the field becomes 'manual' confidence and
 * isConflicting clears, but nothing is discarded: whichever options aren't chosen are kept in
 * alternateValues as history, so provenance survives resolution. This is the ONLY place
 * confirmedByBroker is ever set true — every branch here is reached exclusively from an explicit
 * broker action in the conflict-resolver UI (see FieldRow.tsx's ConflictResolver and
 * NewAccountPage.tsx's identity-resolution step), never automatically.
 */
/** The value being replaced, as alternates — one per document that stated it (its source and its support). */
function demote<T>(existing: FieldValue<T>): { value: T; source: FieldSource; extractionMethod?: FieldValue<T>['extractionMethod'] }[] {
  if (existing.value === null || !existing.source) return [];
  return [existing.source, ...(existing.support ?? [])].map((source) => ({ value: existing.value as T, source, extractionMethod: existing.extractionMethod }));
}

export function resolveFieldConflict<T>(existing: FieldValue<T>, resolution: FieldResolution<T>): FieldValue<T> {
  const now = new Date().toISOString();

  if (resolution.type === 'primary') {
    // A broker decision also settles any "check this" flag left by a removed document.
    return { ...existing, confidence: 'manual', isConflicting: false, confirmedByBroker: true, reviewFlag: undefined, lastUpdatedAt: now };
  }

  if (resolution.type === 'alternate') {
    const alternates = existing.alternateValues ?? [];
    const chosen = alternates[resolution.index];
    if (!chosen) return existing;
    const demotedPrimary = demote(existing);
    const remaining = [...alternates.slice(0, resolution.index), ...alternates.slice(resolution.index + 1), ...demotedPrimary];
    return {
      value: chosen.value,
      confidence: 'manual',
      isMissing: false,
      isConflicting: false,
      confirmedByBroker: true,
      source: chosen.source,
      extractionMethod: chosen.extractionMethod ?? 'ai_extraction',
      alternateValues: remaining.length > 0 ? remaining : undefined,
      lastUpdatedAt: now,
    };
  }

  // type === 'manual': a genuinely new, typed value — still keeps every prior option as history.
  // extractionMethod: 'manual_entry' already takes display priority as "Broker Edited" over
  // confirmedByBroker's "Broker Confirmed" (see fieldDataStatus) — set here anyway since it's
  // also, genuinely, broker-confirmed content, just additionally edited.
  const priorAlternates = existing.alternateValues ?? [];
  const demotedPrimary = demote(existing);
  const history = [...priorAlternates, ...demotedPrimary];
  return {
    value: resolution.value,
    confidence: 'manual',
    isMissing: resolution.value === null || (Array.isArray(resolution.value) && resolution.value.length === 0),
    isConflicting: false,
    confirmedByBroker: true,
    extractionMethod: 'manual_entry',
    alternateValues: history.length > 0 ? history : undefined,
    lastUpdatedAt: now,
  };
}

/** Loose equality for itemized-row scalar fields — ignores case/whitespace, same spirit as isEqualValue. */
function isEqualField(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * The existing row `entry` exactly re-states — same natural key (the field(s) that identify "the
 * same real-world thing") and every other field equal too. This is what makes re-uploading the same
 * schedule a no-op instead of silently doubling every derived total (fleet size, total insured
 * value, claim counts, ...). Rows that share a key but disagree on other fields are NOT deduped —
 * both are kept, same "don't silently pick one" principle the scalar-field merge follows.
 */
/** `ignore` lists bookkeeping fields that don't make a row different. */
function findDuplicateRow<T extends Record<string, unknown>>(existing: T[], entry: T, keyFields: (keyof T)[], ignore: string[] = []): T | undefined {
  const hasKey = keyFields.some((k) => entry[k] !== undefined && entry[k] !== '');
  if (!hasKey) return undefined;
  return existing.find((row) => {
    const sameKey = keyFields.every((k) => (entry[k] === undefined ? row[k] === undefined : isEqualField(row[k], entry[k])));
    if (!sameKey) return false;
    const allFields = (Object.keys(entry) as (keyof T)[]).filter((k) => !ignore.includes(k as string));
    return allFields.every((k) => isEqualField(row[k], entry[k]));
  });
}

const nameTokens = (n: string | undefined) => (n ?? '').toLowerCase().replace(/[^a-z\s,]/g, ' ').replace(/,/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const sameDateKey = (a: string | undefined, b: string | undefined) => !!a && !!b && (normalizeDateKey(a) ?? a) === (normalizeDateKey(b) ?? b);
/** Same first and last name (ignoring middle initials, order "Last, First", and case). */
function sameName(a: string | undefined, b: string | undefined): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const [xf, xl] = [x[0], x[x.length - 1]];
  const [yf, yl] = [y[0], y[y.length - 1]];
  return (xf === yf && xl === yl) || (xf === yl && xl === yf);
}
/**
 * Two reads of the same driver: the same license number (and names that don't disagree), or the
 * same name and date of birth. Different license numbers or DOBs are never the same driver.
 */
export function isSameDriver(a: Pick<DriverEntry, 'name' | 'dob' | 'licenseNumber'>, b: Pick<DriverEntry, 'name' | 'dob' | 'licenseNumber'>): boolean {
  const lic = (v?: string) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a.dob && b.dob && !sameDateKey(a.dob, b.dob)) return false;
  if (lic(a.licenseNumber) && lic(b.licenseNumber)) return lic(a.licenseNumber) === lic(b.licenseNumber) && (!a.name || !b.name || sameName(a.name, b.name));
  return sameName(a.name, b.name) && sameDateKey(a.dob, b.dob);
}

/** Row fields that are bookkeeping, not content — a re-statement differing only in these is the same row. */
const ROW_BOOKKEEPING = ['support', 'reviewFlag', 'isManual', 'lastUpdatedAt', 'notes', 'fieldConfidence', 'conflicts'];

/**
 * The coverage line for `type`, created if missing. A line a document creates records that
 * document (`sources`); a broker-added line has none and is never removed with a document.
 */
function touchCoverageLine(profile: RiskProfile, type: CoverageType, documentId: string | undefined) {
  let line = profile.coverage.find((c) => c.type === type);
  if (!line) {
    line = { type, requestedLimit: { value: null, confidence: 'low', isMissing: true, isConflicting: false }, ...(documentId ? { sources: [documentId] } : {}) };
    profile.coverage = [...profile.coverage, line];
  } else if (documentId && line.sources && !line.sources.includes(documentId)) {
    const updated = { ...line, sources: [...line.sources, documentId] };
    profile.coverage = profile.coverage.map((c) => (c === line ? updated : c));
    line = updated;
  }
  return line;
}

function setByPath(profile: RiskProfile, fieldPath: string, result: ExtractedFieldResult): void {
  if (fieldPath === 'lossRun') {
    const draft = result.value as LossRunDraft;
    profile.pendingLossRuns = [...(profile.pendingLossRuns ?? []).filter((d) => d.key !== draft.key), draft];
    return;
  }

  if (fieldPath === 'lossHistory') {
    const { lossRunKey, ...entry } = result.value as Omit<LossEntry, 'id' | 'source'>;
    const duplicateOf = findDuplicateRow(profile.lossHistory as unknown as Record<string, unknown>[], entry as Record<string, unknown>, ['lossDate', 'claimType', 'incurred'], ['lossRunId', 'lossRunKey', 'support', 'reviewFlag']);
    if (duplicateOf) {
      // The same claim again (e.g. the loss run re-uploaded): keep one, remember this document
      // supports it too, and let it join its loss-run record.
      profile.lossHistory = profile.lossHistory.map((l) =>
        l === (duplicateOf as unknown) ? { ...l, support: withSupport(l.support, result.source, l.source), ...(lossRunKey && !l.lossRunId ? { lossRunKey } : {}) } : l
      );
      return;
    }
    profile.lossHistory = [...profile.lossHistory, { ...entry, ...(lossRunKey ? { lossRunKey } : {}), id: generateId('loss'), source: result.source }];
    return;
  }

  if (fieldPath === 'vehicles') {
    const entry = result.value as Omit<VehicleEntry, 'id' | 'source'>;
    const dup = findDuplicateRow(profile.vehicles as unknown as Record<string, unknown>[], entry as Record<string, unknown>, ['vin'], ROW_BOOKKEEPING);
    if (dup) {
      profile.vehicles = profile.vehicles.map((v) => (v === (dup as unknown) ? { ...v, support: withSupport(v.support, result.source, v.source) } : v));
      return;
    }
    profile.vehicles = [...profile.vehicles, { ...entry, id: generateId('veh'), source: result.source }];
    return;
  }

  if (fieldPath === 'drivers') {
    const entry = result.value as Omit<DriverEntry, 'id' | 'source'>;
    const dup = findDuplicateRow(profile.drivers as unknown as Record<string, unknown>[], entry as Record<string, unknown>, ['name', 'dob'], ROW_BOOKKEEPING);
    if (dup) {
      profile.drivers = profile.drivers.map((d) => (d === (dup as unknown) ? { ...d, support: withSupport(d.support, result.source, d.source) } : d));
      return;
    }
    // The same person from another document (a license photo, then their MVR): the MVR's original
    // CDL issue date fills in that driver instead of starting a second row. Nothing else is
    // overwritten; two different CDL dates are kept as a conflict (so experience reads "—").
    const same = profile.drivers.find((d) => isSameDriver(d, entry));
    if (same && entry.cdlOriginalIssueDate) {
      const cdlSource = entry.cdlOriginalIssueSource ?? result.source;
      profile.drivers = profile.drivers.map((d) => {
        if (d !== same) return d;
        const support = withSupport(d.support, result.source, d.source);
        if (!d.cdlOriginalIssueDate) return { ...d, cdlOriginalIssueDate: entry.cdlOriginalIssueDate, cdlOriginalIssueSource: cdlSource, support };
        if (sameDateKey(d.cdlOriginalIssueDate, entry.cdlOriginalIssueDate)) return { ...d, support };
        return {
          ...d,
          support,
          conflicts: { ...(d.conflicts ?? {}), cdlOriginalIssueDate: [...(d.conflicts?.cdlOriginalIssueDate ?? []), { value: entry.cdlOriginalIssueDate, extractionMethod: result.extractionMethod ?? 'ai_extraction' }] },
        };
      });
      return;
    }
    profile.drivers = [...profile.drivers, { ...entry, id: generateId('drv'), source: result.source }];
    return;
  }

  if (fieldPath === 'coverageLine') {
    touchCoverageLine(profile, result.value as CoverageType, result.source?.documentId);
    return;
  }

  const parts = fieldPath.split('.');

  if (parts[0] === 'coverage') {
    const [, coverageType, sub] = parts as [string, CoverageType, 'currentLimit' | 'requestedLimit'];
    const line = touchCoverageLine(profile, coverageType, result.source?.documentId);
    line[sub] = mergeFieldValue(line[sub], result);
    return;
  }

  const [section, key] = parts as ['business' | 'transportation', string];
  const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
  bucket[key] = mergeFieldValue(bucket[key], result);
}

/** Merges a batch of extracted field results (from one document) into a risk profile draft, in place. */
export function mergeIntoRiskProfile(profile: RiskProfile, results: ExtractedFieldResult[]): RiskProfile {
  for (const result of results) {
    setByPath(profile, result.fieldPath, result);
  }
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Sets a field value from a manual broker edit — always treated as ground truth. Preserves whatever was there before (source, extracted alternates) as history rather than discarding it. */
export function applyManualEdit<T>(
  profile: RiskProfile,
  section: 'business' | 'transportation',
  key: string,
  value: T
): RiskProfile {
  const bucket = profile[section] as unknown as Record<string, FieldValue<T>>;
  const existing = bucket[key] ?? emptyField<T>();
  bucket[key] = resolveFieldConflict(existing, { type: 'manual', value });
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Applies a broker's explicit conflict resolution (pick primary / pick an alternate / type manually) to one field. */
export function applyFieldResolution<T>(
  profile: RiskProfile,
  section: 'business' | 'transportation',
  key: string,
  resolution: FieldResolution<T>
): RiskProfile {
  const bucket = profile[section] as unknown as Record<string, FieldValue<T>>;
  const existing = bucket[key] ?? emptyField<T>();
  bucket[key] = resolveFieldConflict(existing, resolution);
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/** Same as applyFieldResolution, for a coverage line's currentLimit/requestedLimit — the one other place a FieldValue can conflict. */
export function applyCoverageFieldResolution(
  profile: RiskProfile,
  coverageType: CoverageType,
  field: CoverageField,
  resolution: FieldResolution<string>
): RiskProfile {
  const line = profile.coverage.find((c) => c.type === coverageType);
  if (!line) return profile;
  const existing = line[field] ?? emptyField<string>();
  line[field] = resolveFieldConflict(existing, resolution);
  profile.updatedAt = new Date().toISOString();
  return profile;
}

/**
 * Adds/edits/deletes one row of an itemized collection (vehicles/drivers/lossHistory) — the same
 * three operations for all three arrays, since they share the same "row with an id" shape. Broker
 * additions/edits are always marked isManual so a later document deletion (see
 * removeDocumentFromRiskProfile) knows never to touch them — there's no source document to
 * invalidate them.
 */
export function addRecordEntry<T extends { id: string }>(list: T[], entry: Omit<T, 'id'>, idPrefix: string): T[] {
  const now = new Date().toISOString();
  return [...list, { ...entry, id: generateId(idPrefix), isManual: true, lastUpdatedAt: now } as unknown as T];
}

export function updateRecordEntry<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  const now = new Date().toISOString();
  // Editing a row is reviewing it: any "check this" flag from a removed document is settled.
  return list.map((item) => (item.id === id ? { ...item, ...patch, isManual: true, reviewFlag: undefined, lastUpdatedAt: now } : item));
}

export function deleteRecordEntry<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

/** What removing a document did — shown to the broker and written to Activity. */
export interface RollbackReport {
  /** Values/rows removed because the document was their only support. */
  removed: { fields: number; drivers: number; vehicles: number; losses: number; coverageLines: number; lossRuns: number };
  /** Values/rows kept because another document still supports them. */
  keptBySupport: number;
  /** Values/rows kept but flagged: the broker edited, confirmed or annotated them. */
  flagged: { kind: 'field' | 'driver' | 'vehicle' | 'loss' | 'lossRun'; label: string; reason: string }[];
}

const emptyReport = (): RollbackReport => ({ removed: { fields: 0, drivers: 0, vehicles: 0, losses: 0, coverageLines: 0, lossRuns: 0 }, keptBySupport: 0, flagged: [] });

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/**
 * Undoes one document's contribution to the risk profile (and the account's loss-run records),
 * touching nothing that doesn't come from it alone. Pure — returns new objects.
 *
 *  - Broker-typed values (manual entry) and broker-added rows/lines/records have no document and
 *    are never touched.
 *  - A value or row another document also states (`support`) stays, now credited to that document.
 *  - A conflicting alternate the document contributed is dropped; if it was the only
 *    disagreement, the field stops being a conflict.
 *  - A value that came only from this document falls back to the strongest remaining alternate
 *    (demoted to 'medium') or to missing — never a guessed value.
 *  - A row that came only from it is removed — unless the broker edited it or added notes to it,
 *    or confirmed a value it provided: then it is KEPT and flagged for review (`reviewFlag`),
 *    because undoing it automatically could throw away the broker's work.
 *  - A coverage line the document created goes away only when no other document supports it and
 *    none of its values remain.
 *  - A loss-run record from it is removed unless the broker edited it or kept claims still point
 *    to it (then flagged); fields it only filled in on another document's record are cleared.
 */
export function rollbackDocument(
  profile: RiskProfile,
  lossRuns: LossRun[],
  documentId: string,
  documentName: string,
  now = new Date().toISOString()
): { profile: RiskProfile; lossRuns: LossRun[]; report: RollbackReport } {
  const report = emptyReport();
  const flag = (reason: string): ReviewFlag => ({ documentId, documentName, reason, flaggedAt: now });
  const fromDoc = (s: FieldSource | undefined) => s?.documentId === documentId;
  const otherSupport = (list: FieldSource[] | undefined) => (list ?? []).filter((x) => x.documentId !== documentId);

  function field<T>(f: FieldValue<T> | undefined, label: string): FieldValue<T> | undefined {
    if (!f || f.isMissing) return f;
    const alternates = (f.alternateValues ?? []).filter((a) => !fromDoc(a.source));
    const support = otherSupport(f.support);
    const altChanged = alternates.length !== (f.alternateValues ?? []).length;
    const supportChanged = support.length !== (f.support ?? []).length;

    if (!fromDoc(f.source)) {
      if (!altChanged && !supportChanged) return f;
      return {
        ...f,
        alternateValues: alternates.length ? alternates : undefined,
        support: support.length ? support : undefined,
        // A broker-settled field stays settled; otherwise it's a conflict only while alternates remain.
        isConflicting: f.confidence === 'manual' ? f.isConflicting : alternates.some((a) => !isEqualValue(a.value, f.value)),
      };
    }

    // The value itself came from this document.
    if (support.length) {
      report.keptBySupport++;
      const [next, ...rest] = support;
      return { ...f, source: next, support: rest.length ? rest : undefined, alternateValues: alternates.length ? alternates : undefined, confidence: f.confidence === 'manual' ? 'manual' : 'medium', lastUpdatedAt: now };
    }
    if (f.confidence === 'manual') {
      // The broker confirmed this document's value — keep it, but ask them to look again.
      report.flagged.push({ kind: 'field', label, reason: 'You confirmed this value; it came from the removed document.' });
      return { ...f, alternateValues: alternates.length ? alternates : undefined, reviewFlag: flag('You confirmed this value; it came from the removed document.') };
    }
    if (alternates.length === 0) {
      report.removed.fields++;
      return emptyField<T>();
    }
    report.removed.fields++;
    const [promoted, ...rest] = alternates;
    return {
      value: promoted.value,
      confidence: 'medium',
      source: promoted.source,
      extractionMethod: promoted.extractionMethod ?? 'ai_extraction',
      isMissing: false,
      isConflicting: rest.some((alt) => !isEqualValue(alt.value, promoted.value)),
      alternateValues: rest.length > 0 ? rest : undefined,
      lastUpdatedAt: now,
    };
  }

  type Row = { id: string; source?: FieldSource; support?: FieldSource[]; isManual?: boolean; reviewFlag?: ReviewFlag; notes?: unknown[] };
  function rows<R extends Row>(list: R[], kind: 'driver' | 'vehicle' | 'loss', labelOf: (r: R) => string): R[] {
    const out: R[] = [];
    for (const r of list) {
      const support = otherSupport(r.support);
      if (!fromDoc(r.source)) {
        out.push(support.length !== (r.support ?? []).length ? { ...r, support: support.length ? support : undefined } : r);
        continue;
      }
      if (support.length) {
        report.keptBySupport++;
        const [next, ...rest] = support;
        out.push({ ...r, source: next, support: rest.length ? rest : undefined, lastUpdatedAt: now });
        continue;
      }
      const reason = r.isManual ? 'You edited this after it was read from the removed document.' : (r.notes?.length ?? 0) > 0 ? 'You added notes to it; it came from the removed document.' : null;
      if (reason) {
        report.flagged.push({ kind, label: labelOf(r), reason });
        out.push({ ...r, reviewFlag: flag(reason), lastUpdatedAt: now });
        continue;
      }
      report.removed[kind === 'driver' ? 'drivers' : kind === 'vehicle' ? 'vehicles' : 'losses']++;
    }
    return out;
  }

  const business = { ...profile.business } as unknown as Record<string, FieldValue<unknown>>;
  for (const key of Object.keys(business)) business[key] = field(business[key], humanize(key)) as FieldValue<unknown>;
  const transportation = { ...profile.transportation } as unknown as Record<string, FieldValue<unknown>>;
  for (const key of Object.keys(transportation)) transportation[key] = field(transportation[key], humanize(key)) as FieldValue<unknown>;

  const coverage = profile.coverage.flatMap((line) => {
    const label = humanize(line.type.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()));
    const next = {
      ...line,
      currentLimit: field(line.currentLimit, `${label} current limit`),
      requestedLimit: field(line.requestedLimit, `${label} requested limit`) ?? line.requestedLimit,
      ...(line.deductible ? { deductible: field(line.deductible, `${label} deductible`) } : {}),
    };
    if (!line.sources?.includes(documentId)) return [next];
    const sources = line.sources.filter((d) => d !== documentId);
    const hasValue = [next.currentLimit, next.requestedLimit, next.deductible].some((f) => f && !f.isMissing && f.value !== null);
    if (sources.length === 0 && !hasValue) {
      report.removed.coverageLines++;
      return [];
    }
    return [{ ...next, sources }];
  });

  const drivers = rows(profile.drivers, 'driver', (d) => `Driver ${d.name ?? '(no name)'}`).map((d) => {
    // An original CDL date this document filled in on a driver from another document goes with it.
    if (d.cdlOriginalIssueSource?.documentId !== documentId) return d;
    const { cdlOriginalIssueDate: _date, cdlOriginalIssueSource: _src, ...rest } = d;
    report.removed.fields++;
    return { ...rest, lastUpdatedAt: now } as DriverEntry;
  });
  const vehicles = rows(profile.vehicles, 'vehicle', (v) => `Vehicle ${[v.year, v.make, v.model].filter(Boolean).join(' ') || v.vin || '(no VIN)'}`);
  const lossHistory = rows(profile.lossHistory, 'loss', (l) => `Claim ${l.lossDate || ''} ${l.claimType || ''}`.trim());

  // Loss-run records.
  const keptRunIds = new Set(lossHistory.map((l) => l.lossRunId).filter(Boolean));
  const nextRuns: LossRun[] = [];
  for (const run of lossRuns) {
    const supporting = (run.supportingDocumentIds ?? []).filter((d) => d !== documentId);
    // Fields this document only filled in on someone else's record.
    const filled = Object.entries(run.fieldSources ?? {}).filter(([, d]) => d === documentId).map(([k]) => k);
    if (run.documentId !== documentId) {
      if (!filled.length && supporting.length === (run.supportingDocumentIds ?? []).length) {
        nextRuns.push(run);
        continue;
      }
      // updatedAt moves so this version wins when copies from different devices are merged.
      const cleared: LossRun = { ...run, supportingDocumentIds: supporting.length ? supporting : undefined, updatedAt: now };
      const fieldSources = { ...run.fieldSources };
      for (const k of filled) {
        delete fieldSources[k];
        if (!run.editedByBroker) delete (cleared as unknown as Record<string, unknown>)[k];
      }
      cleared.fieldSources = Object.keys(fieldSources).length ? fieldSources : undefined;
      if (filled.length && run.editedByBroker) {
        const reason = 'You edited this record; some of its details came from the removed document.';
        report.flagged.push({ kind: 'lossRun', label: `Loss run ${run.carrier}`, reason });
        cleared.reviewFlag = flag(reason);
      }
      nextRuns.push(cleared);
      continue;
    }
    if (supporting.length) {
      report.keptBySupport++;
      const [next, ...rest] = supporting;
      nextRuns.push({ ...run, documentId: next, supportingDocumentIds: rest.length ? rest : undefined, updatedAt: now });
      continue;
    }
    const reason = run.editedByBroker ? 'You edited this record; it came from the removed document.' : keptRunIds.has(run.id) ? 'Claims you kept still point to this record.' : null;
    if (reason) {
      report.flagged.push({ kind: 'lossRun', label: `Loss run ${run.carrier}`, reason });
      nextRuns.push({ ...run, reviewFlag: flag(reason), updatedAt: now });
      continue;
    }
    report.removed.lossRuns++;
  }
  const removedRunIds = new Set(lossRuns.filter((r) => !nextRuns.some((n) => n.id === r.id)).map((r) => r.id));

  return {
    profile: {
      ...profile,
      business: business as unknown as RiskProfile['business'],
      transportation: transportation as unknown as RiskProfile['transportation'],
      coverage,
      drivers,
      vehicles,
      lossHistory: lossHistory.map((l) => (l.lossRunId && removedRunIds.has(l.lossRunId) ? { ...l, lossRunId: undefined } : l)),
      pendingLossRuns: profile.pendingLossRuns?.filter((d) => d.documentId !== documentId),
      updatedAt: now,
    },
    lossRuns: nextRuns,
    report,
  };
}

/** Removes a deleted document's influence from the risk profile — see rollbackDocument. */
export function removeDocumentFromRiskProfile(profile: RiskProfile, documentId: string): RiskProfile {
  return rollbackDocument(profile, [], documentId, '').profile;
}

/**
 * Best-effort, read-only summary of what a document's removal would affect — shown in the delete
 * confirmation so the broker knows before confirming. Same rules as rollbackDocument.
 */
export function previewDocumentRemovalImpact(profile: RiskProfile, documentId: string, lossRuns: LossRun[] = []): { fields: number; vehicles: number; drivers: number; losses: number; flagged: number } {
  const { removed, flagged } = rollbackDocument(profile, lossRuns, documentId, '').report;
  return { fields: removed.fields, vehicles: removed.vehicles, drivers: removed.drivers, losses: removed.losses, flagged: flagged.length };
}

/**
 * The broker applies something that was held for review (see gateExtraction): as read, or as they
 * corrected it. It goes in credited to its document, like any other read value — and as confirmed
 * by the broker. A corrected row is the broker's (isManual), so removing the document later keeps it
 * and asks; a corrected field is a manual entry. Pure.
 */
export function applyReviewCandidate(profile: RiskProfile, candidate: ReviewCandidate, corrected?: unknown): RiskProfile {
  const edited = corrected !== undefined;
  const result: ExtractedFieldResult = {
    fieldPath: candidate.fieldPath,
    value: edited ? corrected : candidate.value,
    confidence: 'high',
    source: candidate.source,
    extractionMethod: candidate.extractionMethod,
  };
  if (candidate.fieldPath === 'drivers' || candidate.fieldPath === 'vehicles' || candidate.fieldPath === 'lossHistory') {
    const key = candidate.fieldPath;
    const before = new Set((profile[key] as { id: string }[]).map((r) => r.id));
    const next = mergeIntoRiskProfile({ ...profile }, [result]);
    if (!edited) return next;
    const now = new Date().toISOString();
    return { ...next, [key]: (next[key] as { id: string }[]).map((r) => (before.has(r.id) ? r : { ...r, isManual: true, lastUpdatedAt: now })) } as RiskProfile;
  }
  const [section, key] = candidate.fieldPath.split('.');
  if (edited && (section === 'business' || section === 'transportation')) return applyManualEdit({ ...profile }, section, key, corrected);
  const next = mergeIntoRiskProfile({ ...profile }, [result]);
  // Applying it is the broker vouching for it.
  if (section === 'business' || section === 'transportation') {
    const bucket = next[section] as unknown as Record<string, FieldValue<unknown>>;
    const f = bucket[key];
    if (f && isEqualValue(f.value, result.value)) bucket[key] = { ...f, confirmedByBroker: true };
  }
  return next;
}
