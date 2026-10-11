import { supabase } from './client';
import type { AgencyCarrier, CarrierCriteria, RuleStrictness } from '../appetite/agencyCarriers';
import type { CarrierRule, MarketAccess, MarketContact, MarketType } from '../../types';

/**
 * The agency's own carriers and appetite (0023_agency_carriers.sql). Every member can read them;
 * only an agency admin can add, edit or archive — the database enforces it, and stamps the agency
 * and who/when itself. There is no delete: carriers are archived.
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sync is not configured in this environment.' };
const MIGRATION_MESSAGE = 'Carrier appetite needs database migration 0023_agency_carriers.sql.';
const MIGRATION_0049_MESSAGE = 'Market access and underwriting rules need database migration 0049_carrier_access_and_rules.sql.';
const missing0049 = (e: { message?: string; code?: string }) => /agency_carrier_rules|agency_carrier_imports|import_agency_carrier_directory|access_status|portal_url|contacts/.test(e?.message ?? '') || e?.code === 'PGRST202';

function fail(err: { message?: string; code?: string } | unknown, fallback: string): RepoResult<never> {
  const e = err as { message?: string; code?: string };
  if ((e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === '42703' || e?.code === 'PGRST204' || e?.code === 'PGRST202') && missing0049(e)) return { ok: false, message: MIGRATION_0049_MESSAGE };
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /agency_carriers/.test(e?.message ?? '')) return { ok: false, message: MIGRATION_MESSAGE };
  if (e?.code === '42501') return { ok: false, message: 'Only an agency admin can change carrier appetite.' };
  return { ok: false, message: e?.message ?? fallback };
}

interface CarrierRow {
  id: string;
  base_record_id: string | null;
  name: string;
  market_type: MarketType;
  available_through: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  criteria: CarrierCriteria | null;
  rule_strictness: RuleStrictness;
  notes: string | null;
  source: AgencyCarrier['source'];
  last_verified_at: string | null;
  updated_at: string;
  archived_at: string | null;
  external_ref?: string | null;
  // 0049 (absent before it is applied)
  access_route?: MarketAccess['route'];
  access_status?: MarketAccess['status'];
  mga_name?: string | null;
  wholesaler_name?: string | null;
  paper_carrier?: string | null;
  portal_name?: string | null;
  portal_url?: string | null;
  submission_email?: string | null;
  producer_code?: string | null;
  appointment_status?: string | null;
  appointment_notes?: string | null;
  contacts?: MarketContact[] | null;
  access_source?: string | null;
  access_source_date?: string | null;
  access_verified_at?: string | null;
  access_notes?: string | null;
}

function accessFromRow(r: CarrierRow): MarketAccess | null {
  if (r.access_status === undefined) return null; // before 0049
  return {
    route: r.access_route ?? null,
    status: r.access_status ?? null,
    mga: r.mga_name ?? null,
    wholesaler: r.wholesaler_name ?? null,
    paper: r.paper_carrier ?? null,
    portalName: r.portal_name ?? null,
    portalUrl: r.portal_url ?? null,
    submissionEmail: r.submission_email ?? null,
    producerCode: r.producer_code ?? null,
    appointment: r.appointment_status ?? null,
    appointmentNotes: r.appointment_notes ?? null,
    contacts: Array.isArray(r.contacts) ? r.contacts : [],
    source: r.access_source ?? null,
    sourceDate: r.access_source_date ?? null,
    verifiedAt: r.access_verified_at ?? null,
    notes: r.access_notes ?? null,
  };
}

interface RuleRow {
  id: string;
  carrier_id: string;
  external_ref: string | null;
  coverage: CarrierRule['coverage'];
  category: CarrierRule['category'];
  operator: CarrierRule['operator'];
  value: unknown;
  answer: CarrierRule['answer'];
  strength: CarrierRule['strength'];
  conditions: CarrierRule['conditions'] | null;
  conditions_text: string | null;
  source: string | null;
  source_date: string | null;
  last_verified_at: string | null;
  verified_by: string | null;
  notes: string | null;
  archived_at: string | null;
}

function ruleFromRow(r: RuleRow): CarrierRule {
  return {
    id: r.id,
    ref: r.external_ref,
    coverage: r.coverage,
    category: r.category,
    operator: r.operator,
    value: r.value,
    answer: r.answer,
    strength: r.strength,
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
    conditionsText: r.conditions_text,
    source: r.source,
    sourceDate: r.source_date,
    lastVerifiedAt: r.last_verified_at,
    verifiedBy: r.verified_by,
    notes: r.notes,
    archivedAt: r.archived_at,
  };
}

function fromRow(r: CarrierRow): AgencyCarrier {
  return {
    id: r.id,
    baseRecordId: r.base_record_id,
    name: r.name,
    marketType: r.market_type,
    availableThrough: r.available_through,
    website: r.website,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    criteria: r.criteria ?? {},
    strictness: r.rule_strictness,
    notes: r.notes,
    source: r.source,
    lastVerifiedAt: r.last_verified_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
    access: accessFromRow(r),
    externalRef: r.external_ref ?? null,
  };
}

/** All of the agency's carriers, archived included, with their underwriting rules (RLS returns only the caller's agency). */
export async function fetchAgencyCarriers(): Promise<RepoResult<AgencyCarrier[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const [carriers, rules] = await Promise.all([
      supabase.from('agency_carriers').select('*').order('name'),
      supabase.from('agency_carrier_rules').select('*').is('archived_at', null).order('created_at'),
    ]);
    if (carriers.error) return fail(carriers.error, 'Could not load carriers.');
    // Before 0049 there are no rules — markets match exactly as before.
    const byCarrier = new Map<string, CarrierRule[]>();
    for (const r of rules.error ? [] : ((rules.data ?? []) as RuleRow[])) byCarrier.set(r.carrier_id, [...(byCarrier.get(r.carrier_id) ?? []), ruleFromRow(r)]);
    return { ok: true, data: (carriers.data as CarrierRow[]).map((row) => ({ ...fromRow(row), rules: byCarrier.get(row.id) ?? [] })) };
  } catch (err) {
    return fail(err, 'Could not load carriers.');
  }
}

export type CarrierInput = Pick<AgencyCarrier, 'baseRecordId' | 'name' | 'marketType' | 'availableThrough' | 'website' | 'contactName' | 'contactEmail' | 'contactPhone' | 'criteria' | 'strictness' | 'notes'>;

const blank = (s: string | null) => (s && s.trim() ? s.trim() : null);

/** Adds a carrier (no id) or saves changes to one. Saving counts as verifying the appetite today. */
export async function saveAgencyCarrier(input: CarrierInput, id?: string): Promise<RepoResult<AgencyCarrier>> {
  if (!supabase) return NOT_CONFIGURED;
  const row = {
    name: input.name.trim(),
    market_type: input.marketType,
    available_through: blank(input.availableThrough),
    website: blank(input.website),
    contact_name: blank(input.contactName),
    contact_email: blank(input.contactEmail),
    contact_phone: blank(input.contactPhone),
    criteria: input.criteria,
    rule_strictness: input.strictness,
    notes: blank(input.notes),
    last_verified_at: new Date().toISOString(),
  };
  try {
    const q = id
      ? supabase.from('agency_carriers').update(row).eq('id', id).select('*')
      : supabase.from('agency_carriers').insert({ ...row, base_record_id: input.baseRecordId, source: 'manual' }).select('*');
    const { data, error } = await q;
    if (error) return fail(error, 'Could not save the carrier.');
    // A refused update returns no rows rather than an error.
    if (!data || data.length === 0) return { ok: false, message: 'Only an agency admin can change carrier appetite.' };
    return { ok: true, data: fromRow(data[0] as CarrierRow) };
  } catch (err) {
    return fail(err, 'Could not save the carrier.');
  }
}

/** Archive (hidden from Market Finder) or restore. The database stamps who/when. */
export async function setAgencyCarrierArchived(id: string, archived: boolean): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('agency_carriers')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id');
    if (error) return fail(error, 'Could not update the carrier.');
    if (!data || data.length === 0) return { ok: false, message: 'Only an agency admin can change carrier appetite.' };
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not update the carrier.');
  }
}

// ------------------------------------------------------------------------------------------------
// Carrier 101 / 102 (0049). Admin-only, enforced by the database.
// ------------------------------------------------------------------------------------------------

const t = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Saves a market's access details (Carrier 101). Its appetite criteria are not touched. */
export async function saveMarketAccess(carrierId: string, a: MarketAccess): Promise<RepoResult<AgencyCarrier>> {
  if (!supabase) return NOT_CONFIGURED;
  const row = {
    access_route: a.route,
    access_status: a.status,
    mga_name: t(a.mga),
    wholesaler_name: t(a.wholesaler),
    paper_carrier: t(a.paper),
    portal_name: t(a.portalName),
    portal_url: t(a.portalUrl),
    submission_email: t(a.submissionEmail),
    producer_code: t(a.producerCode),
    appointment_status: t(a.appointment),
    appointment_notes: t(a.appointmentNotes),
    contacts: a.contacts.filter((c) => Object.values(c).some((v) => typeof v === 'string' && v.trim())),
    access_source: t(a.source),
    access_source_date: t(a.sourceDate),
    access_verified_at: t(a.verifiedAt),
    access_notes: t(a.notes),
  };
  try {
    const { data, error } = await supabase.from('agency_carriers').update(row).eq('id', carrierId).select('*');
    if (error) return fail(error, 'Could not save the market access.');
    if (!data || data.length === 0) return { ok: false, message: 'Only an agency admin can change market access.' };
    return { ok: true, data: fromRow(data[0] as CarrierRow) };
  } catch (err) {
    return fail(err, 'Could not save the market access.');
  }
}

export type RuleInput = Omit<CarrierRule, 'id' | 'archivedAt'>;

/** Adds (no id) or changes one underwriting rule (Carrier 102). */
export async function saveCarrierRule(carrierId: string, input: RuleInput, id?: string): Promise<RepoResult<CarrierRule>> {
  if (!supabase) return NOT_CONFIGURED;
  const row = {
    coverage: input.coverage,
    category: input.category,
    operator: input.operator,
    value: input.value ?? null,
    answer: input.answer,
    strength: input.strength,
    conditions: input.conditions ?? [],
    conditions_text: t(input.conditionsText),
    source: t(input.source),
    source_date: t(input.sourceDate),
    last_verified_at: t(input.lastVerifiedAt),
    verified_by: t(input.verifiedBy),
    notes: t(input.notes),
  };
  try {
    const q = id
      ? supabase.from('agency_carrier_rules').update(row).eq('id', id).select('*')
      : supabase.from('agency_carrier_rules').insert({ ...row, carrier_id: carrierId }).select('*');
    const { data, error } = await q;
    if (error) return fail(error, 'Could not save the rule.');
    if (!data || data.length === 0) return { ok: false, message: 'Only an agency admin can change underwriting rules.' };
    return { ok: true, data: ruleFromRow(data[0] as RuleRow) };
  } catch (err) {
    return fail(err, 'Could not save the rule.');
  }
}

/** Removes a rule from matching (kept as a record). */
export async function archiveCarrierRule(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('agency_carrier_rules').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) return fail(error, 'Could not remove the rule.');
    if (!data || data.length === 0) return { ok: false, message: 'Only an agency admin can change underwriting rules.' };
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not remove the rule.');
  }
}

export interface ImportCounts {
  marketsAdded: number;
  marketsUpdated: number;
  rulesAdded: number;
  rulesUpdated: number;
  dryRun: boolean;
}

/** The reviewed directory import (Carrier 101 + 102). dryRun: the exact counts, nothing saved. */
export async function importCarrierDirectory(payload: { fileName: string; markets: unknown[] }, dryRun: boolean): Promise<RepoResult<ImportCounts>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('import_agency_carrier_directory', { p_payload: payload, p_dry_run: dryRun });
    if (error) return fail(error, 'Could not import the directory.');
    return { ok: true, data: data as ImportCounts };
  } catch (err) {
    return fail(err, 'Could not import the directory.');
  }
}
