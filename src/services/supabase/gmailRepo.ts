import { supabase } from './client';
import type { RepoResult } from './commissionRepo';
import type { EmailAccountLink, EmailThreadMeta, LinkSuggestion } from '../relatedEmails/relatedEmails';

/**
 * Related Emails (0068 + the `gmail` function): the signed-in broker's own Gmail connection, threads and
 * links. The database shows each broker only their own; tokens never reach the browser.
 */

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST202' || e.code === 'PGRST205' || /(gmail_connections|email_threads|email_account_links|email_link_act|email_link_manual|email_suggest_link)/i.test(e.message ?? '');
function fail(e: unknown, fallback: string): RepoResult<never> {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (isMissing(err)) return { ok: false, message: 'Related Emails needs database migration 0068.', missingMigration: true };
  return { ok: false, message: err.message || fallback };
}

export interface GmailConnection {
  emailAddress: string;
  status: 'connected' | 'reconnect_needed' | 'disconnected';
  lastSyncedAt: string | null;
}

export async function fetchGmailConnection(): Promise<RepoResult<GmailConnection | null>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('gmail_connections').select('email_address,status,last_synced_at').maybeSingle();
  if (error) return fail(error, 'Could not load your Gmail connection.');
  return { ok: true, data: data ? { emailAddress: data.email_address, status: data.status, lastSyncedAt: data.last_synced_at } : null };
}

async function invoke<T>(body: Record<string, unknown>, fallback: string): Promise<RepoResult<T>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.functions.invoke('gmail', { body });
  if (error) {
    let message = fallback;
    try {
      message = (await (error as { context?: Response }).context?.json())?.error ?? fallback;
    } catch { /* keep the fallback */ }
    return { ok: false, message };
  }
  return { ok: true, data: data as T };
}

/** Google's consent page for this broker; Google sends them back to `returnTo` with ?gmail=connected. */
export const startGmailConnect = (returnTo: string) => invoke<{ url: string }>({ action: 'start', returnTo }, 'Gmail couldn’t be connected.');
export const disconnectGmail = () => invoke<{ status: string }>({ action: 'disconnect' }, 'Gmail couldn’t be disconnected.');

export interface SyncedThread extends EmailThreadMeta {
  /** Gmail's short preview, for matching only — never stored. */
  snippet: string;
}
export const syncGmail = () => invoke<{ status: 'ok' | 'reconnect_needed' | 'not_connected'; threads: SyncedThread[]; truncated?: boolean }>({ action: 'refresh' }, 'Gmail couldn’t be refreshed.');

const toThread = (r: Record<string, unknown>): EmailThreadMeta => ({
  id: String(r.id),
  gmailThreadId: String(r.gmail_thread_id),
  subject: String(r.subject ?? ''),
  fromName: (r.from_name as string) ?? null,
  fromEmail: (r.from_email as string) ?? null,
  lastMessageId: String(r.last_message_id),
  lastMessageAt: String(r.last_message_at),
  messageCount: Number(r.message_count ?? 1),
});

export interface AccountEmailLink extends EmailAccountLink {
  reviewedAt: string | null;
}

/** This broker's links for one account (all statuses), with their threads. */
export async function fetchAccountEmails(accountId: string): Promise<RepoResult<{ links: AccountEmailLink[]; threads: EmailThreadMeta[] }>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase
    .from('email_account_links')
    .select('id,submission_id,thread_id,match_status,review_status,reasons,reviewed_at,email_threads(*)')
    .eq('submission_id', accountId);
  if (error) return fail(error, 'Could not load related emails.');
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: {
      links: rows.map((r) => ({
        id: String(r.id), accountId: String(r.submission_id), threadId: String(r.thread_id), matchStatus: r.match_status as AccountEmailLink['matchStatus'],
        reviewStatus: r.review_status as AccountEmailLink['reviewStatus'], reasons: Array.isArray(r.reasons) ? (r.reasons as AccountEmailLink['reasons']) : [], reviewedAt: (r.reviewed_at as string) ?? null,
      })),
      threads: rows.filter((r) => r.email_threads).map((r) => toThread(r.email_threads as Record<string, unknown>)),
    },
  };
}

/** Accounts already linked to each of these threads (any status), so they aren't suggested again. */
export async function fetchLinkedAccounts(threadIds: string[]): Promise<RepoResult<Record<string, string[]>>> {
  if (!supabase) return NOT_CONFIGURED;
  if (!threadIds.length) return { ok: true, data: {} };
  const { data, error } = await supabase.from('email_account_links').select('thread_id,submission_id').in('thread_id', threadIds);
  if (error) return fail(error, 'Could not load related emails.');
  const out: Record<string, string[]> = {};
  for (const r of data ?? []) (out[r.thread_id] ??= []).push(r.submission_id);
  return { ok: true, data: out };
}

/** The broker's recent synced threads, for linking one to an account by hand (newest first). */
export async function searchMyThreads(query: string, limit = 25): Promise<RepoResult<EmailThreadMeta[]>> {
  if (!supabase) return NOT_CONFIGURED;
  let q = supabase.from('email_threads').select('*').order('last_message_at', { ascending: false }).limit(limit);
  const term = query.trim().replace(/[%,()]/g, ' ');
  if (term) q = q.or(`subject.ilike.%${term}%,from_email.ilike.%${term}%,from_name.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) return fail(error, 'Could not search your emails.');
  return { ok: true, data: (data ?? []).map(toThread) };
}

export async function suggestLink(threadId: string, s: LinkSuggestion): Promise<RepoResult<null>> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('email_suggest_link', { p_thread: threadId, p_submission_id: s.accountId, p_reasons: s.reasons });
  return error ? fail(error, 'Could not save a suggestion.') : { ok: true, data: null };
}

export type LinkAction = 'confirm' | 'reviewed' | 'undo_reviewed' | 'not_related' | 'restore';
export async function actOnLink(linkId: string, action: LinkAction): Promise<RepoResult<null>> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('email_link_act', { p_link: linkId, p_action: action });
  return error ? fail(error, 'That couldn’t be saved.') : { ok: true, data: null };
}

export async function linkManually(threadId: string, accountId: string): Promise<RepoResult<null>> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('email_link_manual', { p_thread: threadId, p_submission_id: accountId });
  return error ? fail(error, 'That email couldn’t be linked.') : { ok: true, data: null };
}
