import type { AccessRoute, AccessStatus, CarrierRule, CoverageType, MarketContact, RuleAnswer, RuleCategory, RuleOperator, RulePredicate, RuleStrength } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import type { AgencyCarrier } from './agencyCarriers';

/**
 * The agency's reviewed directory import (Carrier 101 markets + Carrier 102 rules), from one CSV the
 * agency keeps in a spreadsheet — or the same content as JSON. Everything is validated here for the
 * preview, and again by the database (import_agency_carrier_directory, 0049) when it is saved.
 *
 * One row per record, `record_type` says which:
 *   market   market_ref, market, market_type, access_route, access_status, wholesaler, mga, paper,
 *            portal_name, portal_url, submission_email, producer_code, appointment, appointment_notes,
 *            contact_* (one contact), source, source_date, verified_at, notes, documented_status,
 *            base_record_id (link to a built-in market), link_to (link to one of the agency's markets)
 *   contact  market_ref, contact_name, contact_role, contact_email, contact_phone, coverage, notes
 *   rule     market_ref, rule_ref, coverage, category, operator, value, answer, strength,
 *            conditions ("fleet_size gt 10 AND state any_of NY|NJ"), conditions_text, source,
 *            source_date, verified_at, verified_by, notes
 * Lists use "|" (or ";"); a range is "1-10". Credentials are never imported.
 */

export interface ImportRule {
  ref: string;
  coverage: CoverageType | null;
  category: RuleCategory;
  operator: RuleOperator;
  value: unknown;
  answer: RuleAnswer;
  strength: RuleStrength;
  conditions: RulePredicate[];
  conditionsText: string | null;
  source: string | null;
  sourceDate: string | null;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
  notes: string | null;
  /** The source's verification wording, kept as written (not a RenewalIQ verification). */
  documentedStatus: string | null;
}

export interface ImportMarket {
  ref: string;
  name: string;
  marketType: 'direct' | 'mga';
  accessRoute: AccessRoute | null;
  accessStatus: AccessStatus | null;
  wholesaler: string | null;
  mga: string | null;
  paper: string | null;
  portalName: string | null;
  portalUrl: string | null;
  submissionEmail: string | null;
  producerCode: string | null;
  appointment: string | null;
  appointmentNotes: string | null;
  contacts: MarketContact[];
  source: string | null;
  sourceDate: string | null;
  verifiedAt: string | null;
  notes: string | null;
  /** The access status exactly as the source states it. */
  documentedStatus: string | null;
  /** Link to a built-in market (its id): this market becomes the agency's version of it. Same program only. */
  baseRecordId?: string | null;
  /** Link to one of the agency's own markets (its id) whose name differs. Same program only. */
  linkTo?: string | null;
  rules: ImportRule[];
}

/** A built-in market the import can link to (from data/carriers.ts). */
export interface BuiltInRef {
  id: string;
  marketName: string;
  parentCompany: string;
  programName?: string;
}

/** What an imported market is (or could be) linked to. */
export interface LinkTarget {
  kind: 'built-in' | 'agency';
  id: string;
  name: string;
  /** The program, when the market is one program of a carrier (programs are never merged). */
  program?: string;
}

export interface PreviewMarket {
  market: ImportMarket;
  /** 'new', or the existing market it updates (by import reference, chosen link, built-in version, else name). */
  action: 'new' | 'update';
  existingName?: string;
  /** The market it is linked to: an existing agency market it updates, or the built-in it becomes the agency's version of. */
  linkedTo?: LinkTarget;
  /** Not linked, but looks like these markets — the admin decides (link, or keep separate if it's another program). */
  possibleDuplicates: LinkTarget[];
  verifiedHardNos: number;
  unverifiedRules: number;
}

export interface ImportPlan {
  markets: ImportMarket[];
  preview: PreviewMarket[];
  errors: string[];
  warnings: string[];
  /** Errors and warnings from reading the file, before linking (kept so a link change can re-plan). */
  readErrors: string[];
  readWarnings: string[];
}

const CATEGORIES: RuleCategory[] = ['state', 'commodity', 'operation_type', 'radius_miles', 'fleet_size', 'years_in_business', 'driver_age', 'driver_experience', 'vehicle_type', 'operation_class', 'vehicle_age', 'claims_3y', 'telematics', 'dashcam', 'dot_number', 'coverage_offered', 'other'];
const OPERATORS: RuleOperator[] = ['any_of', 'lt', 'lte', 'gt', 'gte', 'between', 'is_true', 'is_false', 'missing', 'offered', 'text'];
const NUMERIC: RuleOperator[] = ['lt', 'lte', 'gt', 'gte'];
const CREDENTIAL_HEADER = /pass(word)?|credential|secret|login|username|pin\b|token/i;

/** RFC 4180-ish: quotes, doubled quotes, commas and newlines inside quotes. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);
const key = (v: string) => v.trim().toLowerCase().replace(/[\s/-]+/g, '_');

function date(v: string | null, field: string, where: string, errors: string[]): string | null {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const out = iso ? v : us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : null;
  if (!out || Number.isNaN(Date.parse(out))) { errors.push(`${where}: ${field} "${v}" is not a date (use YYYY-MM-DD).`); return null; }
  return out;
}

function enumOf<T extends string>(v: string | null, allowed: readonly T[], aliases: Record<string, T>, field: string, where: string, errors: string[], required = false): T | null {
  if (!v) { if (required) errors.push(`${where}: ${field} is required.`); return null; }
  const k = key(v);
  const hit = (allowed as readonly string[]).includes(k) ? (k as T) : aliases[k];
  if (!hit) errors.push(`${where}: ${field} "${v}" — use one of ${allowed.join(', ')}.`);
  return hit ?? null;
}

const COVERAGE_ALIASES: Record<string, CoverageType> = Object.fromEntries(
  (Object.entries(COVERAGE_LABELS) as [CoverageType, string][]).flatMap(([k, label]) => [[key(label), k], [k, k]]).concat([['al', 'auto_liability'], ['mtc', 'motor_truck_cargo'], ['cargo', 'motor_truck_cargo'], ['apd', 'physical_damage'], ['pd', 'physical_damage'], ['gl', 'general_liability'], ['ntl', 'non_trucking_liability'], ['ti', 'trailer_interchange']])
);
const COVERAGES = Object.keys(COVERAGE_LABELS) as CoverageType[];

function ruleValue(op: RuleOperator, raw: string | null, where: string, errors: string[]): unknown {
  if (op === 'any_of') {
    const list = (raw ?? '').split(/[|;]/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) errors.push(`${where}: any_of needs a list of values.`);
    return list;
  }
  if (NUMERIC.includes(op)) {
    const n = Number(raw);
    if (raw === null || !Number.isFinite(n)) errors.push(`${where}: ${op} needs a number.`);
    return n;
  }
  if (op === 'between') {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|\||;|to)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw ?? '');
    if (!m) { errors.push(`${where}: between needs a range like 1-10.`); return null; }
    return [Number(m[1]), Number(m[2])];
  }
  if (op === 'text') return raw;
  return null;
}

function predicate(text: string, where: string, errors: string[]): RulePredicate | null {
  const m = /^\s*(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(text);
  if (!m) { errors.push(`${where}: condition "${text}" — write it as "category operator value".`); return null; }
  const category = enumOf(m[1], CATEGORIES, {}, 'condition category', where, errors, true);
  const operator = enumOf(m[2], OPERATORS, {}, 'condition operator', where, errors, true);
  if (!category || !operator) return null;
  return { category, operator, value: ruleValue(operator, clean(m[3]), where, errors) };
}

/** Rows (first = headers) → validated markets + preview against the agency's existing markets. */
export function planImport(rows: string[][], existing: AgencyCarrier[], builtIns: BuiltInRef[] = []): ImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length < 2) return emptyPlan(['The file has no rows.'], warnings);
  const headers = rows[0].map(key);
  const credential = rows[0].filter((h) => CREDENTIAL_HEADER.test(h));
  if (credential.length) {
    return emptyPlan([`Remove the column${credential.length > 1 ? 's' : ''} ${credential.map((h) => `"${h}"`).join(', ')} — passwords and logins are never imported or stored.`], warnings);
  }
  if (!headers.includes('record_type') || !headers.includes('market_ref')) return emptyPlan(['The file needs record_type and market_ref columns (download the template).'], warnings);

  const markets = new Map<string, ImportMarket>();
  const pendingContacts: [string, MarketContact, string][] = [];
  const pendingRules: [string, ImportRule, string][] = [];
  rows.slice(1).forEach((cells, i) => {
    const where = `Row ${i + 2}`;
    const get = (h: string) => clean(cells[headers.indexOf(h)]);
    const type = (get('record_type') ?? '').toLowerCase();
    const ref = get('market_ref');
    if (!ref) { errors.push(`${where}: market_ref is required.`); return; }
    if (type === 'market') {
      const name = get('market');
      if (!name) { errors.push(`${where}: market name is required.`); return; }
      if (markets.has(ref)) { errors.push(`${where}: market_ref "${ref}" is used twice.`); return; }
      const portalUrl = get('portal_url');
      if (portalUrl && !/^https?:\/\/\S+$/i.test(portalUrl)) errors.push(`${where}: portal_url must start with https://.`);
      const email = get('submission_email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`${where}: submission_email "${email}" is not an email address.`);
      const contact: MarketContact = { name: get('contact_name') ?? undefined, role: get('contact_role') ?? undefined, email: get('contact_email') ?? undefined, phone: get('contact_phone') ?? undefined };
      markets.set(ref, {
        ref,
        name,
        marketType: key(get('market_type') ?? '') === 'mga' ? 'mga' : 'direct',
        accessRoute: enumOf(get('access_route'), ['direct', 'indirect'] as const, { intermediary: 'indirect', through_intermediary: 'indirect', wholesale: 'indirect', mga: 'indirect' }, 'access_route', where, errors),
        accessStatus: enumOf(get('access_status'), ['ready', 'partial', 'not_ready', 'inactive'] as const, { notready: 'not_ready' }, 'access_status', where, errors),
        wholesaler: get('wholesaler'),
        mga: get('mga'),
        paper: get('paper'),
        portalName: get('portal_name'),
        portalUrl,
        submissionEmail: email,
        producerCode: get('producer_code'),
        appointment: get('appointment'),
        appointmentNotes: get('appointment_notes'),
        contacts: Object.values(contact).some(Boolean) ? [contact] : [],
        source: get('source'),
        sourceDate: date(get('source_date'), 'source_date', where, errors),
        verifiedAt: date(get('verified_at'), 'verified_at', where, errors),
        notes: get('notes'),
        documentedStatus: get('documented_status'),
        baseRecordId: get('base_record_id'),
        linkTo: get('link_to'),
        rules: [],
      });
    } else if (type === 'contact') {
      pendingContacts.push([ref, { name: get('contact_name') ?? undefined, role: get('contact_role') ?? undefined, email: get('contact_email') ?? undefined, phone: get('contact_phone') ?? undefined, coverage: get('coverage') ?? undefined, notes: get('notes') ?? undefined }, where]);
    } else if (type === 'rule') {
      const ruleRef = get('rule_ref');
      if (!ruleRef) errors.push(`${where}: rule_ref is required.`);
      const category = enumOf(get('category'), CATEGORIES, { commodities: 'commodity', states: 'state', fleet: 'fleet_size', radius: 'radius_miles', coverage: 'coverage_offered' }, 'category', where, errors, true);
      const operator = enumOf(get('operator'), OPERATORS, { in: 'any_of', is: 'any_of', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }, 'operator', where, errors, true);
      const answer = enumOf(get('answer'), ['yes', 'no', 'referral', 'unknown'] as const, { refer: 'referral', y: 'yes', n: 'no', '?': 'unknown' }, 'answer', where, errors, true);
      const strength = enumOf(get('strength') ?? 'soft', ['hard', 'soft', 'info'] as const, { informational: 'info', information: 'info' }, 'strength', where, errors);
      const coverage = get('coverage') ? enumOf(get('coverage'), COVERAGES, COVERAGE_ALIASES, 'coverage', where, errors) : null;
      if (!category || !operator || !answer || !ruleRef) return;
      const conditions = (get('conditions') ?? '').split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean).map((c) => predicate(c, where, errors)).filter((p): p is RulePredicate => !!p);
      const verifiedAt = date(get('verified_at'), 'verified_at', where, errors);
      if (strength === 'hard' && answer === 'no' && !verifiedAt) warnings.push(`${where}: a hard NO without verified_at is treated as "underwriter review", not a decline, until it is verified.`);
      pendingRules.push([ref, {
        ref: ruleRef, coverage, category, operator, value: ruleValue(operator, get('value'), where, errors), answer, strength: strength ?? 'soft', conditions,
        conditionsText: get('conditions_text'), source: get('source'), sourceDate: date(get('source_date'), 'source_date', where, errors), lastVerifiedAt: verifiedAt, verifiedBy: get('verified_by'), notes: get('notes'), documentedStatus: get('documented_status'),
      }, where]);
    } else {
      errors.push(`${where}: record_type "${get('record_type') ?? ''}" — use market, contact or rule.`);
    }
  });
  for (const [ref, c, where] of pendingContacts) {
    const m = markets.get(ref);
    if (!m) errors.push(`${where}: contact for unknown market_ref "${ref}".`);
    else m.contacts.push(c);
  }
  for (const [ref, r, where] of pendingRules) {
    const m = markets.get(ref);
    if (!m) { errors.push(`${where}: rule for unknown market_ref "${ref}".`); continue; }
    if (m.rules.some((x) => x.ref === r.ref)) { errors.push(`${where}: rule_ref "${r.ref}" is used twice for ${m.name}.`); continue; }
    m.rules.push(r);
  }

  return finishPlan([...markets.values()], existing, builtIns, errors, warnings);
}

const emptyPlan = (errors: string[], warnings: string[]): ImportPlan => ({ markets: [], preview: [], errors, warnings, readErrors: errors, readWarnings: warnings });

// Words that say what kind of company it is, not which one — ignored when looking for duplicates.
const GENERIC = new Set(['rrg', 'a', 'insurance', 'ins', 'company', 'co', 'inc', 'mutual', 'the', 'of', 'and', 'group', 'specialty', 'underwriters', 'underwriting', 'agency', 'mga', 'program', 'programs', 'services', 'commercial', 'auto', 'liability', 'trucking', 'transportation', 'risk', 'retention', 'casualty', 'fleet', 'general', 'national', 'partners', 'brokers', 'administration', 'solutions', 'american', 'us', 'usa']);
/** The words that name the company: "Prime Insurance via Prime UA" → prime (the route after "via" is not the market). */
function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/\bvia\b.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
}
const shareWord = (a: string[], b: string[]) => a.some((w) => b.includes(w));

/** Matching, links and possible duplicates for already-read markets (also used when the admin changes a link). */
export function finishPlan(list: ImportMarket[], existing: AgencyCarrier[], builtIns: BuiltInRef[], readErrors: string[], readWarnings: string[]): ImportPlan {
  const errors = [...readErrors];
  const warnings = [...readWarnings];
  const live = existing.filter((c) => !c.archivedAt);
  const builtIn = new Map(builtIns.map((b) => [b.id, b]));
  const claimed = new Map<string, string>(); // target → the import market linking to it
  const preview = list.map<PreviewMarket>((m) => {
    if (m.baseRecordId && builtIns.length && !builtIn.has(m.baseRecordId)) errors.push(`${m.name}: built-in market "${m.baseRecordId}" doesn't exist.`);
    if (m.linkTo && !existing.some((c) => c.id === m.linkTo)) errors.push(`${m.name}: the market to link to isn't one of your agency's markets.`);
    const hit =
      existing.find((c) => c.externalRef === m.ref) ??
      (m.linkTo ? existing.find((c) => c.id === m.linkTo) : undefined) ??
      (m.baseRecordId ? existing.find((c) => c.baseRecordId === m.baseRecordId) : undefined) ??
      live.find((c) => c.name.trim().toLowerCase() === m.name.trim().toLowerCase());
    let linkedTo: LinkTarget | undefined;
    if (hit) {
      linkedTo = { kind: 'agency', id: hit.id, name: hit.name, program: hit.baseRecordId ? builtIn.get(hit.baseRecordId)?.programName : undefined };
      if (hit.externalRef && hit.externalRef !== m.ref) errors.push(`${m.name}: "${hit.name}" is already linked to import reference ${hit.externalRef} — two imported markets are never merged.`);
      if (hit.archivedAt) warnings.push(`${m.name}: links to "${hit.name}", which your agency archived — it stays hidden from Market Finder until restored.`);
      if (m.baseRecordId && hit.baseRecordId !== m.baseRecordId) warnings.push(`${m.name}: "${hit.name}" is already in your list${hit.baseRecordId ? ' as the version of another built-in' : ' as its own market'} — the built-in link can't be changed on re-import, so it stays as it is.`);
    } else if (m.baseRecordId && builtIn.has(m.baseRecordId)) {
      const b = builtIn.get(m.baseRecordId)!;
      linkedTo = { kind: 'built-in', id: b.id, name: b.marketName, program: b.programName };
    }
    if (linkedTo) {
      const key = `${linkedTo.kind}:${linkedTo.id}`;
      if (claimed.has(key)) errors.push(`${m.name} and ${claimed.get(key)} both link to "${linkedTo.name}" — keep them separate or link only one.`);
      else claimed.set(key, m.name);
    }
    const words = nameWords(m.name);
    const possibleDuplicates: LinkTarget[] = linkedTo
      ? []
      : [
          ...live.filter((c) => shareWord(words, nameWords(c.name))).map<LinkTarget>((c) => ({ kind: 'agency', id: c.id, name: c.name, program: c.baseRecordId ? builtIn.get(c.baseRecordId)?.programName : undefined })),
          ...builtIns
            .filter((b) => !existing.some((c) => c.baseRecordId === b.id) && (shareWord(words, nameWords(b.marketName)) || shareWord(words, nameWords(b.parentCompany))))
            .map<LinkTarget>((b) => ({ kind: 'built-in', id: b.id, name: b.marketName, program: b.programName })),
        ];
    return {
      market: m,
      action: hit ? 'update' : 'new',
      existingName: hit?.name,
      linkedTo,
      possibleDuplicates,
      verifiedHardNos: m.rules.filter((r) => r.answer === 'no' && r.strength === 'hard' && r.lastVerifiedAt).length,
      unverifiedRules: m.rules.filter((r) => !r.lastVerifiedAt).length,
    };
  });
  for (const p of preview) if (!p.market.accessStatus) warnings.push(`${p.market.name}: no access_status — shown as "Access not on file".`);
  // Many unverified hard NOs read as one line, so the warnings that need a decision stay visible.
  const UNVERIFIED_NO = /: a hard NO without verified_at is treated as "underwriter review"/;
  const unverifiedNos = warnings.filter((w) => UNVERIFIED_NO.test(w));
  const shown = unverifiedNos.length > 3 ? [...warnings.filter((w) => !UNVERIFIED_NO.test(w)), `${unverifiedNos.length} rules (${unverifiedNos.slice(0, 3).map((w) => w.split(':')[0]).join(', ')}, …): a hard NO without verified_at is treated as "underwriter review", not a decline, until it is verified.`] : warnings;
  const dupes = preview.filter((p) => p.possibleDuplicates.length).length;
  if (dupes) shown.unshift(`${dupes} market${dupes === 1 ? '' : 's'} may already exist under another name — choose "Link to" or keep separate (different programs stay separate).`);
  return { markets: list, preview, errors, warnings: shown, readErrors, readWarnings };
}

/** The admin's link choice for one market (null = keep separate), re-planned. */
export function relinkPlan(plan: ImportPlan, ref: string, target: LinkTarget | null, existing: AgencyCarrier[], builtIns: BuiltInRef[]): ImportPlan {
  const markets = plan.markets.map((m) => (m.ref !== ref ? m : { ...m, baseRecordId: target?.kind === 'built-in' ? target.id : null, linkTo: target?.kind === 'agency' ? target.id : null }));
  return finishPlan(markets, existing, builtIns, plan.readErrors, plan.readWarnings);
}

/** The same plan from a JSON file ({ markets: [...] } in the import shape). */
export function planImportJson(text: string, existing: AgencyCarrier[], builtIns: BuiltInRef[] = []): ImportPlan {
  let data: { markets?: Partial<ImportMarket>[] };
  try {
    data = JSON.parse(text);
  } catch {
    return emptyPlan(['The file is not valid JSON.'], []);
  }
  const header = ['record_type', 'market_ref', 'market', 'market_type', 'access_route', 'access_status', 'wholesaler', 'mga', 'paper', 'portal_name', 'portal_url', 'submission_email', 'producer_code', 'appointment', 'appointment_notes', 'source', 'source_date', 'verified_at', 'notes', 'rule_ref', 'coverage', 'category', 'operator', 'value', 'answer', 'strength', 'conditions', 'conditions_text', 'verified_by', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'documented_status', 'base_record_id', 'link_to'];
  if (JSON.stringify(data).match(CREDENTIAL_HEADER)) {
    const keys = Object.keys(data.markets?.[0] ?? {}).filter((k) => CREDENTIAL_HEADER.test(k));
    if (keys.length) return emptyPlan([`Remove ${keys.join(', ')} — passwords and logins are never imported or stored.`], []);
  }
  const rows: string[][] = [header];
  const at = (h: string) => header.indexOf(h);
  const row = (vals: Record<string, unknown>) => { const r = header.map(() => ''); for (const [k, v] of Object.entries(vals)) if (at(k) >= 0 && v !== null && v !== undefined) r[at(k)] = Array.isArray(v) ? v.join('|') : String(v); return r; };
  for (const m of data.markets ?? []) {
    rows.push(row({ record_type: 'market', market_ref: m.ref, market: m.name, market_type: m.marketType, access_route: m.accessRoute, access_status: m.accessStatus, wholesaler: m.wholesaler, mga: m.mga, paper: m.paper, portal_name: m.portalName, portal_url: m.portalUrl, submission_email: m.submissionEmail, producer_code: m.producerCode, appointment: m.appointment, appointment_notes: m.appointmentNotes, source: m.source, source_date: m.sourceDate, verified_at: m.verifiedAt, notes: m.notes, documented_status: m.documentedStatus, base_record_id: m.baseRecordId, link_to: m.linkTo }));
    for (const c of m.contacts ?? []) rows.push(row({ record_type: 'contact', market_ref: m.ref, contact_name: c.name, contact_role: c.role, contact_email: c.email, contact_phone: c.phone, coverage: c.coverage, notes: c.notes }));
    for (const r of m.rules ?? []) {
      const value = Array.isArray(r.value) && r.operator === 'between' ? `${r.value[0]}-${r.value[1]}` : r.value;
      const conditions = (r.conditions ?? []).map((c) => `${c.category} ${c.operator}${c.value !== undefined && c.value !== null ? ` ${Array.isArray(c.value) ? (c.operator === 'between' ? `${c.value[0]}-${c.value[1]}` : c.value.join('|')) : c.value}` : ''}`).join(' AND ');
      rows.push(row({ record_type: 'rule', market_ref: m.ref, rule_ref: r.ref, coverage: r.coverage, category: r.category, operator: r.operator, value, answer: r.answer, strength: r.strength, conditions, conditions_text: r.conditionsText, source: r.source, source_date: r.sourceDate, verified_at: r.lastVerifiedAt, verified_by: r.verifiedBy, notes: r.notes, documented_status: r.documentedStatus }));
    }
  }
  return planImport(rows, existing, builtIns);
}

/** For the rule editor: a value typed in a form, read the same way as in the import. */
export function parseRuleValue(operator: RuleOperator, raw: string): { value: unknown; error: string | null } {
  const errors: string[] = [];
  const value = ruleValue(operator, clean(raw), 'Value', errors);
  return { value, error: errors[0] ?? null };
}

/** For the rule editor: "fleet_size gt 10 AND state any_of NY|NJ". */
export function parseConditions(text: string): { conditions: RulePredicate[]; error: string | null } {
  const errors: string[] = [];
  const conditions = text.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean).map((c) => predicate(c, 'Condition', errors)).filter((p): p is RulePredicate => !!p);
  return { conditions, error: errors[0] ?? null };
}

/** Back to text for editing. */
export function valueToText(operator: RuleOperator, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (operator === 'between' && Array.isArray(value)) return `${value[0]}-${value[1]}`;
  if (Array.isArray(value)) return value.join('|');
  return String(value);
}
export function conditionsToText(conditions: RulePredicate[]): string {
  return conditions.map((c) => `${c.category} ${c.operator}${c.value === null || c.value === undefined ? '' : ` ${valueToText(c.operator, c.value)}`}`).join(' AND ');
}

export const RULE_CATEGORIES = CATEGORIES;
export const RULE_OPERATORS = OPERATORS;

/** What the database import takes. */
export function importPayload(fileName: string, markets: ImportMarket[]) {
  return { fileName, markets };
}

/** A blank template with synthetic example rows (no real market data). */
export const IMPORT_TEMPLATE_CSV = [
  'record_type,market_ref,market,market_type,access_route,access_status,wholesaler,mga,paper,portal_name,portal_url,submission_email,producer_code,appointment,appointment_notes,contact_name,contact_role,contact_email,contact_phone,rule_ref,coverage,category,operator,value,answer,strength,conditions,conditions_text,source,source_date,verified_at,verified_by,notes',
  'market,EX-001,Example Program,mga,indirect,ready,Example Wholesale,Example MGA,Example Paper Insurance Co,Example Portal,https://portal.example.com,submissions@example.com,,Appointed through wholesaler,,Sample Underwriter,Underwriter,uw@example.com,555-0100,,,,,,,,,,Agency cheat sheet,2026-10-08,2026-10-08,,Example notes',
  'contact,EX-001,,,,,,,,,,,,,,Sample Service Rep,Service,service@example.com,555-0101,,,,,,,,,,,,,,',
  'rule,EX-001,,,,,,,,,,,,,,,,,,R1,Motor Truck Cargo,commodity,any_of,hazmat|explosives,no,hard,,,Agency cheat sheet,2026-10-08,2026-10-08,Account manager,',
  'rule,EX-001,,,,,,,,,,,,,,,,,,R2,,fleet_size,between,1-25,yes,soft,,,Agency cheat sheet,2026-10-08,,,Target fleet size',
  'rule,EX-001,,,,,,,,,,,,,,,,,,R3,,telematics,is_false,,no,hard,fleet_size gt 10,,Agency cheat sheet,2026-10-08,2026-10-08,Account manager,',
  'rule,EX-001,,,,,,,,,,,,,,,,,,R4,,other,text,Loss runs for 5 years,unknown,info,,,Agency cheat sheet,2026-10-08,,,',
].join('\n');

/** Rule fields the editor and the import share. */
export type RuleDraft = Omit<CarrierRule, 'id' | 'archivedAt'>;
