import { supabase } from './client';
import type { RepoResult } from './commissionRepo';
import type { CancellationRow, EndorsementRow, ParsedQqReport, QqReportKind } from '../reports/qqReports';

/** Uploaded QQCatalyst reports (0093): the agency's admins only, read and delete (never edited). */

export const MIGRATION_0093_MESSAGE = 'Endorsement reports need database migration 0093_qq_reports.sql.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const fail = (e: { code?: string; message?: string } | null | undefined, fallback: string): RepoResult<never> =>
  e && (e.code === '42P01' || e.code === 'PGRST205' || /agency_qq_reports/i.test(e.message ?? ''))
    ? { ok: false, message: MIGRATION_0093_MESSAGE, missingMigration: true }
    : { ok: false, message: e?.message ?? fallback };

export type QqReport = { id: string; fileName: string; uploadedAt: string; title: string; period: string } & (
  | { kind: 'endorsements'; rows: EndorsementRow[] }
  | { kind: 'cancellations'; rows: CancellationRow[] }
);

type Row = { id: string; kind: QqReportKind; title: string; period: string; file_name: string; rows: unknown; uploaded_at: string };
const COLUMNS = 'id, kind, title, period, file_name, rows, uploaded_at';
const fromRow = (r: Row): QqReport =>
  ({ id: r.id, kind: r.kind, title: r.title, period: r.period, fileName: r.file_name, uploadedAt: r.uploaded_at, rows: Array.isArray(r.rows) ? r.rows : [] }) as QqReport;

export async function fetchQqReports(): Promise<RepoResult<QqReport[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_qq_reports').select(COLUMNS).order('uploaded_at', { ascending: false });
    if (res.error) return fail(res.error, 'Could not load the reports.');
    return { ok: true, data: ((res.data ?? []) as Row[]).map(fromRow) };
  } catch (err) {
    return fail(err as { message?: string }, 'Could not load the reports.');
  }
}

export async function addQqReport(agencyId: string, fileName: string, report: ParsedQqReport): Promise<RepoResult<QqReport>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase
      .from('agency_qq_reports')
      .insert({ agency_id: agencyId, kind: report.kind, title: report.title.slice(0, 200), period: report.period.slice(0, 300), file_name: fileName.slice(0, 300), rows: report.rows })
      .select(COLUMNS)
      .single();
    if (res.error) return fail(res.error, 'Could not save the report.');
    return { ok: true, data: fromRow(res.data as Row) };
  } catch (err) {
    return fail(err as { message?: string }, 'Could not save the report.');
  }
}

export async function deleteQqReport(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_qq_reports').delete().eq('id', id);
    if (res.error) return fail(res.error, 'Could not delete the report.');
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err as { message?: string }, 'Could not delete the report.');
  }
}

/** Rates admins set on endorsements (row key → rate); the rest use the default. */
export async function fetchQqRates(): Promise<RepoResult<Record<string, number>>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_qq_rates').select('row_key, rate');
    if (res.error) return fail(res.error, 'Could not load the rates.');
    return { ok: true, data: Object.fromEntries(((res.data ?? []) as { row_key: string; rate: number | string }[]).map((r) => [r.row_key, Number(r.rate)])) };
  } catch (err) {
    return fail(err as { message?: string }, 'Could not load the rates.');
  }
}

/** Sets an endorsement's rate, or (null) goes back to the default. */
export async function setQqRate(agencyId: string, rowKey: string, rate: number | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res =
      rate === null
        ? await supabase.from('agency_qq_rates').delete().eq('row_key', rowKey)
        : await supabase.from('agency_qq_rates').upsert({ agency_id: agencyId, row_key: rowKey, rate }, { onConflict: 'agency_id,row_key' });
    if (res.error) return fail(res.error, 'Could not save the rate.');
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err as { message?: string }, 'Could not save the rate.');
  }
}

/** Links an admin set from a QQCatalyst agent name (its key) to a RenewalIQ agent (0094). */
export async function fetchQqAgentLinks(): Promise<RepoResult<Record<string, string>>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_qq_agent_links').select('qq_name, user_id');
    if (res.error) return { ok: false, message: res.error.message };
    return { ok: true, data: Object.fromEntries(((res.data ?? []) as { qq_name: string; user_id: string }[]).map((r) => [r.qq_name, r.user_id])) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Links a QQCatalyst agent name to an agent, or (null) removes the link. */
export async function setQqAgentLink(agencyId: string, qqName: string, userId: string | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res =
      userId === null
        ? await supabase.from('agency_qq_agent_links').delete().eq('qq_name', qqName)
        : await supabase.from('agency_qq_agent_links').upsert({ agency_id: agencyId, qq_name: qqName, user_id: userId }, { onConflict: 'agency_id,qq_name' });
    if (res.error) {
      const missing = res.error.code === '42P01' || res.error.code === 'PGRST205' || /agency_qq_agent_links/.test(res.error.message);
      return { ok: false, message: missing ? 'Linking agents needs database migration 0094_qq_agent_links.sql.' : res.error.message };
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Annual premiums admins entered for cancelled policies (row key → cents, 0095). */
export async function fetchQqPremiums(): Promise<RepoResult<Record<string, number>>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('agency_qq_premiums').select('row_key, premium_cents');
    if (res.error) return { ok: false, message: res.error.message };
    return { ok: true, data: Object.fromEntries(((res.data ?? []) as { row_key: string; premium_cents: number | string }[]).map((r) => [r.row_key, Number(r.premium_cents)])) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Enters or corrects a cancelled policy's premium, or (null) goes back to the one from RenewalIQ. */
export async function setQqPremium(agencyId: string, rowKey: string, cents: number | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res =
      cents === null
        ? await supabase.from('agency_qq_premiums').delete().eq('row_key', rowKey)
        : await supabase.from('agency_qq_premiums').upsert({ agency_id: agencyId, row_key: rowKey, premium_cents: cents }, { onConflict: 'agency_id,row_key' });
    if (res.error) {
      const missing = res.error.code === '42P01' || res.error.code === 'PGRST205' || /agency_qq_premiums/.test(res.error.message);
      return { ok: false, message: missing ? 'Entering premiums needs database migration 0095_qq_cancellation_premiums.sql.' : res.error.message };
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
