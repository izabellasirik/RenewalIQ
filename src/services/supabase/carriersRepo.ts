import { supabase } from './client';
import type { AgencyCarrier, CarrierCriteria, RuleStrictness } from '../appetite/agencyCarriers';
import type { MarketType } from '../../types';

/**
 * The agency's own carriers and appetite (0023_agency_carriers.sql). Every member can read them;
 * only an agency admin can add, edit or archive — the database enforces it, and stamps the agency
 * and who/when itself. There is no delete: carriers are archived.
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sync is not configured in this environment.' };
const MIGRATION_MESSAGE = 'Carrier appetite needs database migration 0023_agency_carriers.sql.';

function fail(err: { message?: string; code?: string } | unknown, fallback: string): RepoResult<never> {
  const e = err as { message?: string; code?: string };
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
  };
}

/** All of the agency's carriers, archived included (RLS returns only the caller's agency). */
export async function fetchAgencyCarriers(): Promise<RepoResult<AgencyCarrier[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('agency_carriers').select('*').order('name');
    if (error) return fail(error, 'Could not load carriers.');
    return { ok: true, data: (data as CarrierRow[]).map(fromRow) };
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
