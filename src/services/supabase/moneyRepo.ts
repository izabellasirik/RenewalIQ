import { supabase } from './client';
import type { MoneyEntry, MoneyFields, MoneyReceipt } from '../finance/money';
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

type Row = { id: string; kind: 'income' | 'expense'; entry_date: string; category: string; description: string; amount_cents: number | string; notes: string; receipts?: unknown; created_at: string; updated_at: string };
const BASE_COLUMNS = 'id, kind, entry_date, category, description, amount_cents, notes, created_at, updated_at';
/** Receipts need 0092; until it's run, entries load and save without them. */
let receiptsColumn = true;
const columns = () => (receiptsColumn ? `${BASE_COLUMNS}, receipts` : BASE_COLUMNS);
const missingReceipts = (e: { code?: string; message?: string } | null) => !!e && receiptsColumn && (e.code === '42703' || e.code === 'PGRST204') && /receipts/i.test(e.message ?? '');
export const MIGRATION_0092_MESSAGE = 'Attaching receipts needs database migration 0092_money_receipts.sql.';
const receiptsOf = (v: unknown): MoneyReceipt[] =>
  Array.isArray(v)
    ? v.filter((r): r is MoneyReceipt => !!r && typeof r === 'object' && typeof (r as MoneyReceipt).path === 'string' && typeof (r as MoneyReceipt).name === 'string')
    : [];
const fromRow = (r: Row): MoneyEntry => ({
  id: r.id,
  kind: r.kind,
  date: r.entry_date,
  category: r.category,
  description: r.description ?? '',
  amountCents: Number(r.amount_cents),
  notes: r.notes ?? '',
  receipts: receiptsOf(r.receipts),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toRow = (f: MoneyFields, receipts?: MoneyReceipt[]) => ({
  kind: f.kind, entry_date: f.date, category: f.category, description: f.description, amount_cents: f.amountCents, notes: f.notes,
  ...(receipts && receiptsColumn ? { receipts } : {}),
});

export async function fetchMoneyEntries(): Promise<RepoResult<MoneyEntry[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    let res = await supabase.from('agency_money_entries').select(columns()).order('entry_date', { ascending: false });
    if (missingReceipts(res.error)) {
      receiptsColumn = false;
      res = await supabase.from('agency_money_entries').select(columns()).order('entry_date', { ascending: false });
    }
    if (res.error) return fail(res.error, 'Could not load income and expenses.');
    return { ok: true, data: ((res.data ?? []) as unknown as Row[]).map(fromRow) };
  } catch (err) {
    return fail(err, 'Could not load income and expenses.');
  }
}

export async function addMoneyEntry(agencyId: string, fields: MoneyFields, receipts?: MoneyReceipt[]): Promise<RepoResult<MoneyEntry>> {
  if (!supabase) return NOT_CONFIGURED;
  if (receipts?.length && !receiptsColumn) return { ok: false, message: MIGRATION_0092_MESSAGE };
  try {
    const res = await supabase.from('agency_money_entries').insert({ agency_id: agencyId, ...toRow(fields, receipts) }).select(columns()).single();
    if (missingReceipts(res.error)) {
      receiptsColumn = false;
      return { ok: false, message: MIGRATION_0092_MESSAGE };
    }
    if (res.error) return fail(res.error, 'Could not save the entry.');
    return { ok: true, data: fromRow(res.data as unknown as Row) };
  } catch (err) {
    return fail(err, 'Could not save the entry.');
  }
}

export async function updateMoneyEntry(id: string, fields: MoneyFields, receipts?: MoneyReceipt[]): Promise<RepoResult<MoneyEntry>> {
  if (!supabase) return NOT_CONFIGURED;
  if (receipts?.length && !receiptsColumn) return { ok: false, message: MIGRATION_0092_MESSAGE };
  try {
    const res = await supabase.from('agency_money_entries').update(toRow(fields, receipts)).eq('id', id).select(columns()).maybeSingle();
    if (missingReceipts(res.error)) {
      receiptsColumn = false;
      return { ok: false, message: MIGRATION_0092_MESSAGE };
    }
    if (res.error) return fail(res.error, 'Could not save the entry.');
    if (!res.data) return { ok: false, message: 'That entry is gone or you can’t change it.' };
    return { ok: true, data: fromRow(res.data as unknown as Row) };
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

// ---------------------------------------------------------------------------
// Receipt files (0092): private bucket, a folder per agency, its admins only.
// ---------------------------------------------------------------------------
const RECEIPTS_BUCKET = 'agency-receipts';
/** A file name safe for a storage path (letters, digits, dot, dash, underscore). */
export const safeFileName = (name: string) => name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file';

export async function uploadReceipt(agencyId: string, file: File): Promise<RepoResult<MoneyReceipt>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const path = `${agencyId}/${crypto.randomUUID()}/${safeFileName(file.name)}`;
    const res = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (res.error) return { ok: false, message: /bucket not found/i.test(res.error.message) ? MIGRATION_0092_MESSAGE : `Could not upload ${file.name}: ${res.error.message}` };
    return { ok: true, data: { path, name: file.name.slice(0, 200), size: file.size, ...(file.type ? { type: file.type } : {}) } };
  } catch (err) {
    return { ok: false, message: `Could not upload ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
}

/** A short-lived link to open a receipt. */
export async function receiptUrl(path: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

/** Removes receipt files (after their entry or the receipt itself was removed). Never throws. */
export async function deleteReceiptFiles(paths: string[]): Promise<void> {
  if (!supabase || paths.length === 0) return;
  try {
    await supabase.storage.from(RECEIPTS_BUCKET).remove(paths);
  } catch {
    // left in the folder; harmless
  }
}
