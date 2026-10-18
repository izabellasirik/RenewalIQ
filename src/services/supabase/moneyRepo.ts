import { supabase } from './client';
import type { MoneyEntry, MoneyFields } from '../finance/money';
import type { RepoResult } from './commissionRepo';

/**
 * The agency's income and expenses (0059). The database shows and lets change them only for the
 * agency's admins; it stamps who created / changed each one and when.
 */

export const MIGRATION_0059_MESSAGE = 'Income and expenses need database migration 0059_agency_income_expenses.sql.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const isMissing = (e: { code?: string; message?: string }) => e.code === '42P01' || e.code === 'PGRST205' || /agency_money_entries/i.test(e.message ?? '');
const fail = (e: { code?: string; message?: string } | unknown, fallback: string): RepoResult<never> => {
  const err = e as { code?: string; message?: string };
  if (err && isMissing(err)) return { ok: false, message: MIGRATION_0059_MESSAGE, missingMigration: true };
  return { ok: false, message: err?.message ?? fallback };
};

type Row = { id: string; kind: 'income' | 'expense'; entry_date: string; category: string; description: string; amount_cents: number | string; notes: string; created_at: string; updated_at: string };
const COLUMNS = 'id, kind, entry_date, category, description, amount_cents, notes, created_at, updated_at';
const fromRow = (r: Row): MoneyEntry => ({
  id: r.id,
  kind: r.kind,
  date: r.entry_date,
  category: r.category,
  description: r.description ?? '',
  amountCents: Number(r.amount_cents),
  notes: r.notes ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toRow = (f: MoneyFields) => ({ kind: f.kind, entry_date: f.date, category: f.category, description: f.description, amount_cents: f.amountCents, notes: f.notes });

export async function fetchMoneyEntries(): Promise<RepoResult<MoneyEntry[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_money_entries').select(COLUMNS).order('entry_date', { ascending: false });
    if (res.error) return fail(res.error, 'Could not load income and expenses.');
    return { ok: true, data: ((res.data ?? []) as Row[]).map(fromRow) };
  } catch (err) {
    return fail(err, 'Could not load income and expenses.');
  }
}

export async function addMoneyEntry(agencyId: string, fields: MoneyFields): Promise<RepoResult<MoneyEntry>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_money_entries').insert({ agency_id: agencyId, ...toRow(fields) }).select(COLUMNS).single();
    if (res.error) return fail(res.error, 'Could not save the entry.');
    return { ok: true, data: fromRow(res.data as Row) };
  } catch (err) {
    return fail(err, 'Could not save the entry.');
  }
}

export async function updateMoneyEntry(id: string, fields: MoneyFields): Promise<RepoResult<MoneyEntry>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_money_entries').update(toRow(fields)).eq('id', id).select(COLUMNS).maybeSingle();
    if (res.error) return fail(res.error, 'Could not save the entry.');
    if (!res.data) return { ok: false, message: 'That entry is gone or you can’t change it.' };
    return { ok: true, data: fromRow(res.data as Row) };
  } catch (err) {
    return fail(err, 'Could not save the entry.');
  }
}

export async function deleteMoneyEntry(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_money_entries').delete().eq('id', id);
    if (res.error) return fail(res.error, 'Could not delete the entry.');
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not delete the entry.');
  }
}
